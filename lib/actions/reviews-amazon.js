import { hasPermission, hasStoreAccess } from '../permissions.js';
import { getStore } from '../store-context.js';
import { rateLimit } from '../rate-limit.js';
import { supabase, validateImageBuffer, uploadReviewImage, dropExistingDuplicates } from './reviews-shared.js';

const MAX_REVIEWS = 200;

// Import-time prioritization: photo reviews first, then by rating DESC.
// Best-effort — if not enough photo reviews exist, fill the rest with the
// highest-rated non-photo reviews. Never drops the batch below what quality is available.
// Result: (photo, 5-star) → (photo, 4-star) → ... → (no-photo, 5-star) → (no-photo, 1-star).
function prioritizeReviews(reviews) {
  const photoCount = (r) => (Array.isArray(r.photo_urls) ? r.photo_urls.length : 0);
  const rating = (r) => (Number.isFinite(r.rating) ? r.rating : 0);
  return [...reviews].sort((a, b) => {
    // Photo reviews first; more photos beats fewer. Then rating DESC. Worst drops
    // off the tail when the cap applies.
    const pa = photoCount(a);
    const pb = photoCount(b);
    if (pa !== pb) return pb - pa;
    return rating(b) - rating(a);
  });
}
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Amazon CDN host allow-list for photo downloads (I-3 SSRF fix). photo_urls are
// supplied by the client (userscript or scrape preview) — without this gate a
// holder of any api_token with products:edit could point _photo_url at an
// internal address (e.g. 169.254.169.254 cloud metadata, localhost) and make
// this serverless function issue the request on their behalf.
// Photo host allow-list — must include every CDN domain used by any registered scraper source.
// Amazon: media-amazon.com, ssl-images-amazon.com, images-amazon.com
// Temu (feature-05):   rewimg-eu.kwcdn.com (EU region — .com dp/ pages serve EU CDN)
//                      rewimg-us.kwcdn.com (US region, defensive add — same pattern)
// Cupshe: cdn-review.cupshe.com (customer review images), media.cupshe.com (product/general)
const ALLOWED_PHOTO_HOSTS = /^(?:[\w-]+\.)?media-amazon\.com$|^(?:[\w-]+\.)?ssl-images-amazon\.com$|^(?:[\w-]+\.)?images-amazon\.com$|^rewimg-(?:eu|us)\.kwcdn\.com$|^cdn-review\.cupshe\.com$|^media\.cupshe\.com$/;

function featureEnabled() {
  return process.env.FEATURE_AMAZON_REVIEWS_SCRAPER === 'true';
}

// "John Smith" -> "John S." ; single-token/emoji-only/empty -> "Anonymous".
// Titan-side copy (D-07) — the scraper VPS also anonymizes before it ever leaves
// the VPS; this is defense-in-depth in case a raw name slips through.
function anonymizeAuthor(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Anonymous';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Anonymous';
  if (trimmed.length === 1 || !/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

function parseAmazonDate(raw) {
  // Amazon: "Reviewed in the United States on November 15, 2024"
  // Temu:   "in Czech Republic on 20 Apr 2024"
  // Both share the "on <date>" tail — try month-first (Amazon) then day-first (Temu).
  const s = String(raw || '');
  const monthFirst = s.match(/on ([A-Z][a-z]+ \d{1,2},? \d{4})/);
  const dayFirst   = s.match(/on (\d{1,2} [A-Z][a-z]+ \d{4})/);
  const candidate = monthFirst?.[1] || dayFirst?.[1];
  if (!candidate) return new Date().toISOString().slice(0, 10);
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

export async function scrape_amazon_preview(req, res) {
  if (!featureEnabled()) return res.status(503).json({ error: 'feature disabled' });

  const { store_id, product_id, amazon_url, max_reviews } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!amazon_url || typeof amazon_url !== 'string') return res.status(400).json({ error: 'amazon_url required' });
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  if (!(await rateLimit(`amazon_scrape:${req.user.user_id || req.user.username || 'master'}`, 10, 3_600_000))) {
    return res.status(429).json({ error: 'Rate limit — max 10 Amazon scrapes per hour' });
  }

  const scraperUrl = process.env.AMAZON_SCRAPER_URL;
  const scraperToken = process.env.AMAZON_SCRAPER_TOKEN;
  if (!scraperUrl || !scraperToken) {
    console.error('[reviews-amazon] AMAZON_SCRAPER_URL/AMAZON_SCRAPER_TOKEN not configured');
    return res.status(500).json({ error: 'Amazon scraper not configured' });
  }

  const cappedMax = Math.min(Math.max(1, parseInt(max_reviews, 10) || 10), MAX_REVIEWS);

  let r;
  try {
    r = await fetch(`${scraperUrl}/scrape-amazon`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${scraperToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amazon_url, max_reviews: cappedMax }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (err) {
    console.error('[reviews-amazon] scraper unreachable:', err.message);
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'AMAZON_SCRAPER', level: 'warn',
      message: `Scrape attempt failed — TC scraper VPS unreachable`,
      metadata: { amazon_url, user_id: req.user.user_id, error: err.message },
    });
    return res.status(502).json({ error: 'Scraper unavailable', hint: 'check TC scraper VPS is running (37.27.189.60:3100)' });
  }

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('[reviews-amazon] scraper error:', { status: r.status, errText });
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'AMAZON_SCRAPER', level: 'warn',
      message: `Scrape attempt failed — scraper returned ${r.status}`,
      metadata: { amazon_url, user_id: req.user.user_id, status: r.status },
    });
    return res.status(502).json({
      error: 'Scraper unavailable',
      hint: r.status === 401 ? 'check AMAZON_SCRAPER_TOKEN' : 'check TC scraper VPS logs',
    });
  }

  const { reviews, product } = await r.json();

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'AMAZON_SCRAPER', level: 'info',
    message: `Scraped ${reviews?.length || 0} reviews for ASIN ${product?.asin || '?'}`,
    metadata: { amazon_url, user_id: req.user.user_id, count: reviews?.length || 0 },
  });

  return res.status(200).json({ reviews: reviews || [], product: product || null });
}

const ALLOWED_SOURCES = new Set(['amazon', 'temu', 'cupshe']);

// F11: userscript client-side dedup pre-check. Given a list of author+body-first-100-chars
// keys, returns the set of keys that ALREADY exist in DB for this product. Userscript then
// oversamples the source (scrapes more than MAX_REVIEWS raw candidates) and drops the dupes
// client-side before POSTing to import_amazon_reviews. Net result: import gets 200 UNIQUE
// reviews instead of 200 candidates where 30 might collide with existing DB rows.
export async function check_review_duplicates(req, res) {
  const { store_id, product_id, keys } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!Array.isArray(keys) || keys.length === 0) return res.status(400).json({ error: 'keys[] required' });
  if (keys.length > 500) return res.status(400).json({ error: 'max 500 keys per check' });

  // Fetch ALL existing author+body pairs for this product, build key set matching
  // userscript's client-side format (author|body-first-100-chars).
  const { data: existing } = await supabase.from('product_reviews')
    .select('author, body')
    .eq('store_id', store_id)
    .eq('product_id', product_id);
  const existingKeys = new Set((existing || []).map((r) => `${r.author}|${(r.body || '').slice(0, 100)}`));

  const duplicates = keys.filter((k) => existingKeys.has(k));
  return res.status(200).json({ duplicates, existingCount: existing?.length || 0 });
}

export async function import_amazon_reviews(req, res) {
  if (!featureEnabled()) return res.status(503).json({ error: 'feature disabled' });

  const { store_id, product_id, reviews, source: reqSource } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: 'reviews[] required' });
  if (reviews.length > MAX_REVIEWS) return res.status(400).json({ error: `max ${MAX_REVIEWS} reviews per import` });
  // Source: defaults to 'amazon' for backward compat with the F04 userscript that predates
  // multi-domain scrapers. Feature-05 adds 'temu'. Rejects anything not on the allow-list.
  const source = reqSource || 'amazon';
  if (!ALLOWED_SOURCES.has(source)) return res.status(400).json({ error: `source must be one of: ${[...ALLOWED_SOURCES].join(', ')}` });

  const store = await getStore(store_id);
  if (!store) return res.status(400).json({ error: 'store not found' });

  // Prioritize inside the incoming batch (photo-first, then rating DESC) before turning
  // into DB candidates. Userscript already client-side prioritizes, but backend re-does it
  // as belt-and-suspenders in case of older clients or hand-crafted API calls.
  const prioritizedInput = prioritizeReviews(reviews);

  // Multi-photo (F08): up to 10 photos per review. Also enforce global cap on
  // total photos across the whole batch — 50 reviews × 10 photos × ~2s parallel
  // download would still finish under 60s Vercel timeout, but batch above
  // MAX_TOTAL_PHOTOS starts risking. Trim per-review before that cap hits.
  const MAX_PHOTOS_PER_REVIEW = 10;
  const MAX_TOTAL_PHOTOS = 150;
  let totalPhotoBudget = MAX_TOTAL_PHOTOS;

  const candidates = prioritizedInput.map((rv) => {
    const inputPhotos = Array.isArray(rv.photo_urls) ? rv.photo_urls : [];
    const perReview = inputPhotos.slice(0, MAX_PHOTOS_PER_REVIEW);
    const allowed = perReview.slice(0, totalPhotoBudget);
    totalPhotoBudget -= allowed.length;
    return {
      store_id, product_id,
      author: anonymizeAuthor(rv.author),
      rating: rv.rating,
      title: (rv.title || '').slice(0, 200),
      body: (rv.body || '').slice(0, 2000),
      verified: !!rv.verified,
      review_date: parseAmazonDate(rv.review_date),
      helpful_count: Number.isFinite(rv.helpful_count) ? rv.helpful_count : 0,
      status: 'pending',
      source,
      _input_photo_urls: allowed,
    };
  });

  const deduped = await dropExistingDuplicates(supabase, store_id, product_id, candidates);
  const duplicates = candidates.length - deduped.length;

  let inserted = 0;
  let skipped = 0;

  // Filter invalid ratings first so photo work only runs for keepers.
  const kept = deduped.filter((c) => {
    if (!Number.isFinite(c.rating) || c.rating < 1 || c.rating > 5) {
      console.warn('[reviews-amazon] skipping review with invalid rating', { author: c.author });
      skipped += 1;
      return false;
    }
    return true;
  });

  // Download + validate + upload photos in parallel. Preserves SSRF gate (I-3),
  // per-photo error isolation, and 8 MB size cap. Multi-photo (F08): each review
  // may have up to 10 photos; each is processed independently, failed ones drop
  // out of the resulting photo_urls array.
  async function downloadAndUploadPhoto(rawUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (err) {
      console.warn('[reviews-amazon] invalid photo URL, skipping:', { url: rawUrl, error: err.message });
      return null;
    }
    if (!ALLOWED_PHOTO_HOSTS.test(parsedUrl.hostname)) {
      console.warn('[reviews-amazon] photo host not allowed, skipping:', parsedUrl.hostname);
      return null;
    }
    try {
      const imgResp = await fetch(parsedUrl.href, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TitanCommerce/1.0)' } });
      if (!imgResp.ok) {
        console.warn('[reviews-amazon] photo download failed:', { status: imgResp.status, url: parsedUrl.href });
        return null;
      }
      const buf = Buffer.from(await imgResp.arrayBuffer());
      const validated = validateImageBuffer(buf, MAX_PHOTO_BYTES);
      if (validated.error) {
        console.warn('[reviews-amazon] photo validation failed:', validated.error);
        return null;
      }
      return await uploadReviewImage(store.slug || store.name, product_id, validated.buf, validated.ext, validated.contentType);
    } catch (err) {
      console.error('[reviews-amazon] photo download/upload error:', err.message);
      return null;
    }
  }

  const rowsToInsert = await Promise.all(kept.map(async (c) => {
    const uploadedUrls = c._input_photo_urls.length
      ? (await Promise.all(c._input_photo_urls.map(downloadAndUploadPhoto))).filter(Boolean)
      : [];
    const { _input_photo_urls, ...row } = c;
    return {
      ...row,
      // Keep legacy photo_url column populated with the first uploaded photo for
      // backward compat with older reviews-push metafield renders + any code that
      // reads single photo_url. photo_urls JSONB holds the full list.
      photo_url: uploadedUrls[0] || null,
      photo_urls: uploadedUrls.length ? uploadedUrls : null,
    };
  }));

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from('product_reviews').insert(rowsToInsert);
    if (error) {
      console.error('[reviews-amazon] insert failed:', error);
      return res.status(500).json({ error: 'failed to import reviews' });
    }
    inserted = rowsToInsert.length;
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'AMAZON_SCRAPER', level: 'info',
    message: `Imported ${inserted} Amazon reviews for product ${product_id} (${duplicates} duplicate, ${skipped} skipped)`,
    metadata: { product_id, user_id: req.user.user_id, inserted, duplicates, skipped },
  });

  return res.status(200).json({ inserted, skipped, duplicates });
}

import { hasPermission, hasStoreAccess } from '../permissions.js';
import { getStore } from '../store-context.js';
import { rateLimit } from '../rate-limit.js';
import { supabase, validateImageBuffer, uploadReviewImage, dropExistingDuplicates } from './reviews-shared.js';

const MAX_REVIEWS = 10;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Amazon CDN host allow-list for photo downloads (I-3 SSRF fix). photo_urls are
// supplied by the client (userscript or scrape preview) — without this gate a
// holder of any api_token with products:edit could point _photo_url at an
// internal address (e.g. 169.254.169.254 cloud metadata, localhost) and make
// this serverless function issue the request on their behalf.
const ALLOWED_PHOTO_HOSTS = /^(?:[\w-]+\.)?media-amazon\.com$|^(?:[\w-]+\.)?ssl-images-amazon\.com$|^(?:[\w-]+\.)?images-amazon\.com$/;

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
  // "Reviewed in the United States on November 15, 2024"
  const m = String(raw || '').match(/on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const d = new Date(m[1]);
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

export async function import_amazon_reviews(req, res) {
  if (!featureEnabled()) return res.status(503).json({ error: 'feature disabled' });

  const { store_id, product_id, reviews } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: 'reviews[] required' });
  if (reviews.length > MAX_REVIEWS) return res.status(400).json({ error: `max ${MAX_REVIEWS} reviews per import` });

  const store = await getStore(store_id);
  if (!store) return res.status(400).json({ error: 'store not found' });

  const candidates = reviews.map((rv) => ({
    store_id, product_id,
    author: anonymizeAuthor(rv.author),
    rating: rv.rating,
    title: (rv.title || '').slice(0, 200),
    body: (rv.body || '').slice(0, 2000),
    verified: !!rv.verified,
    review_date: parseAmazonDate(rv.review_date),
    helpful_count: Number.isFinite(rv.helpful_count) ? rv.helpful_count : 0,
    status: 'pending',
    source: 'amazon',
    _photo_url: rv.photo_urls?.[0] || null,
  }));

  const deduped = await dropExistingDuplicates(supabase, store_id, product_id, candidates);
  const duplicates = candidates.length - deduped.length;

  let inserted = 0;
  let skipped = 0;
  const rowsToInsert = [];

  for (const c of deduped) {
    if (!Number.isFinite(c.rating) || c.rating < 1 || c.rating > 5) {
      console.warn('[reviews-amazon] skipping review with invalid rating', { author: c.author });
      skipped += 1;
      continue;
    }

    let photo_url = null;
    if (c._photo_url) {
      let parsedUrl;
      try {
        parsedUrl = new URL(c._photo_url);
      } catch (err) {
        console.warn('[reviews-amazon] invalid photo URL, skipping:', { url: c._photo_url, error: err.message });
        parsedUrl = null;
      }

      if (parsedUrl && !ALLOWED_PHOTO_HOSTS.test(parsedUrl.hostname)) {
        console.warn('[reviews-amazon] photo host not allowed, skipping:', parsedUrl.hostname);
        parsedUrl = null;
      }

      if (parsedUrl) {
        try {
          const imgResp = await fetch(parsedUrl.href, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TitanCommerce/1.0)' } });
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer());
            const validated = validateImageBuffer(buf, MAX_PHOTO_BYTES);
            if (!validated.error) {
              photo_url = await uploadReviewImage(store.slug || store.name, product_id, validated.buf, validated.ext, validated.contentType);
            } else {
              console.warn('[reviews-amazon] photo validation failed, importing without photo:', validated.error);
            }
          } else {
            console.warn('[reviews-amazon] photo download failed, importing without photo:', { status: imgResp.status, url: parsedUrl.href });
          }
        } catch (err) {
          console.error('[reviews-amazon] photo download/upload error, importing without photo:', err.message);
        }
      }
    }

    const { _photo_url, ...row } = c;
    rowsToInsert.push({ ...row, photo_url });
  }

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

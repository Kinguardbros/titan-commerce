import { rateLimit } from '../rate-limit.js';
import { getStore } from '../store-context.js';
import { supabase, decodeAndValidateImage, uploadReviewImage } from './reviews-shared.js';

// PUBLIC (unauthenticated) — storefront visitors submit a review (+ optional photo).
// Always inserts as pending/source='web' (moderated in dashboard before it can reach the
// web). Protected by IP rate-limit + honeypot + length caps + HTML stripping; photos are
// magic-byte + size validated. Reached via the PUBLIC_ACTIONS allow-list in lib/auth.js.

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
const MAX_PUBLIC_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB hard cap for visitor uploads

// Trustworthy client IP for rate-limiting. Vercel sets `x-real-ip` itself (single value,
// not client-spoofable) — unlike `x-forwarded-for`, whose first token a client can forge.
function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim()
    || (req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim()
    || (req.headers['x-forwarded-for'] || '').split(',').pop().trim() // last hop = Vercel-appended
    || 'unknown';
}

// POST: submit_review_public
// { shop_domain, shopify_product_id, author, rating, title?, body, email?, company?, photo_base64? }
// `company` is a honeypot (hidden field) — bots fill it; humans leave it empty.
export async function submit_review_public(req, res) {
  const { shopify_product_id, author, rating, title, body, email, company, photo_base64 } = req.body || {};

  // Honeypot: pretend success, insert nothing.
  if (company) return res.status(200).json({ ok: true });

  // Per-IP (5/hr) AND global (200/hr across all IPs) caps — the global ceiling bounds
  // storage/DB cost when an attacker rotates IPs (per-IP alone is rotatable to infinity).
  const ip = clientIp(req);
  if (!await rateLimit(`review_submit:${ip}`, 5, 3600000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later' });
  }
  if (!await rateLimit('review_submit_global', 200, 3600000)) {
    return res.status(429).json({ error: 'Reviews are temporarily busy — please try again later' });
  }

  // Required fields + rating range. (shop_domain is accepted by the form but ignored — we
  // derive the store from the product's globally-unique Shopify id instead.)
  if (!shopify_product_id || !author || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ratingInt = parseInt(rating, 10);
  if (!(ratingInt >= 1 && ratingInt <= 5)) return res.status(400).json({ error: 'rating must be 1–5' });

  // Map Shopify product id → TC product + its store (visitor never sees TC UUIDs).
  const { data: product } = await supabase.from('products')
    .select('id, store_id').eq('shopify_id', String(shopify_product_id)).single();
  if (!product) return res.status(400).json({ error: 'Unknown product' });
  const store = { id: product.store_id };

  // Sanitize (rendered on the storefront later) + cap lengths.
  const cleanAuthor = stripTags(author).slice(0, 80);
  const cleanTitle = stripTags(title).slice(0, 120) || null;
  const cleanBody = stripTags(body).slice(0, 2000);
  const cleanEmail = stripTags(email).slice(0, 160) || null;
  if (!cleanAuthor || !cleanBody) return res.status(400).json({ error: 'Missing required fields' });

  // Duplicate check BEFORE any photo upload — avoids orphaning a Storage object when the
  // unique dedup index would reject the insert, and lets us answer gracefully (not a 500).
  const { data: dupe } = await supabase.from('product_reviews')
    .select('id').eq('store_id', store.id).eq('product_id', product.id)
    .eq('author', cleanAuthor).eq('body', cleanBody).limit(1).maybeSingle();
  if (dupe) return res.status(200).json({ ok: true, duplicate: true });

  // Optional photo — validated (magic byte + size) only after the cheap checks + dedup pass.
  let photo_url = null;
  if (photo_base64) {
    const img = decodeAndValidateImage(photo_base64, MAX_PUBLIC_PHOTO_BYTES);
    if (img.error) return res.status(400).json({ error: img.error });
    const store_row = await getStore(store.id);
    const storeName = store_row?.slug || store_row?.name || 'store';
    photo_url = await uploadReviewImage(storeName, product.id, img.buf, img.ext, img.contentType);
  }

  const { error } = await supabase.from('product_reviews').insert({
    store_id: store.id,
    product_id: product.id,
    author: cleanAuthor,
    rating: ratingInt,
    title: cleanTitle,
    body: cleanBody,
    email: cleanEmail,
    photo_url,
    review_date: new Date().toISOString().slice(0, 10),
    source: 'web',
    status: 'pending',
    verified: false,
  });
  if (error) {
    // Lost a race to the dedup index → treat as already-submitted, not a hard error.
    if (error.code === '23505') return res.status(200).json({ ok: true, duplicate: true });
    throw error;
  }

  await supabase.from('pipeline_log').insert({
    store_id: store.id, agent: 'REVIEWS', level: 'info',
    message: `Web review submitted by "${cleanAuthor}" (${ratingInt}★${photo_url ? ', +photo' : ''}) — pending`,
    // Public unauthenticated storefront submission — a real human visitor, not a TC
    // dashboard user, so no req.user to attribute to.
    user_id: null, initiator: 'user',
  });

  return res.status(200).json({ ok: true });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST: vote_review_helpful (PUBLIC) — { review_id } → +1 helpful_count (atomic RPC).
// Anti-abuse (defence in depth): one vote per IP+review per day (server-side dedup, so
// the same IP can't repeatedly inflate one review), plus a per-IP burst cap and a global
// ceiling. Client localStorage is the first line; these are the real ceilings.
export async function vote_review_helpful(req, res) {
  const { review_id } = req.body || {};
  if (!review_id || !UUID_RE.test(review_id)) return res.status(400).json({ error: 'valid review_id required' });

  const ip = clientIp(req);
  // One vote per IP per review per 24h — blocks repeat-voting the same review by IP.
  if (!await rateLimit(`helpful_one:${ip}:${review_id}`, 1, 86400000)) {
    return res.status(200).json({ ok: true, already_voted: true });
  }
  if (!await rateLimit(`helpful_vote:${ip}`, 30, 3600000)) {
    return res.status(429).json({ error: 'Too many votes — try again later' });
  }
  if (!await rateLimit('helpful_vote_global', 500, 3600000)) {
    return res.status(429).json({ error: 'Voting is temporarily busy — try again later' });
  }

  const { data, error } = await supabase.rpc('increment_review_helpful', { p_review_id: review_id });
  if (error) throw error;
  if (data === null) return res.status(404).json({ error: 'Review not found' }); // unknown id

  return res.status(200).json({ ok: true, helpful_count: data });
}

// GET: review_helpful_counts (PUBLIC) — { shopify_product_id } → [{ id, helpful_count }]
// for approved+published reviews, so the storefront can show live counts (the metafield
// snapshot may be stale between pushes).
export async function review_helpful_counts(req, res) {
  const shopifyProductId = req.query.shopify_product_id;
  if (!shopifyProductId) return res.status(400).json({ error: 'shopify_product_id required' });

  const { data: product } = await supabase.from('products')
    .select('id').eq('shopify_id', String(shopifyProductId)).single();
  if (!product) return res.status(200).json({ counts: [] }); // unknown product — empty, not an error

  const { data, error } = await supabase.from('product_reviews')
    .select('id, helpful_count')
    .eq('product_id', product.id)
    .in('status', ['approved', 'published']);
  if (error) throw error;

  return res.status(200).json({ counts: data || [] });
}

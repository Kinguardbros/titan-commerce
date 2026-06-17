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
  });

  return res.status(200).json({ ok: true });
}

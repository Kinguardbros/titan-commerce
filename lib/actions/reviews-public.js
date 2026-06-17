import { rateLimit } from '../rate-limit.js';
import { getStore } from '../store-context.js';
import { supabase, decodeAndValidateImage, uploadReviewImage } from './reviews-shared.js';

// PUBLIC (unauthenticated) — storefront visitors submit a review (+ optional photo).
// Always inserts as pending/source='web' (moderated in dashboard before it can reach the
// web). Protected by IP rate-limit + honeypot + length caps + HTML stripping; photos are
// magic-byte + size validated. Reached via the PUBLIC_ACTIONS allow-list in lib/auth.js.

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
const MAX_PUBLIC_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB hard cap for visitor uploads

// POST: submit_review_public
// { shop_domain, shopify_product_id, author, rating, title?, body, email?, company?, photo_base64? }
// `company` is a honeypot (hidden field) — bots fill it; humans leave it empty.
export async function submit_review_public(req, res) {
  const { shop_domain, shopify_product_id, author, rating, title, body, email, company, photo_base64 } = req.body || {};

  // Honeypot: pretend success, insert nothing.
  if (company) return res.status(200).json({ ok: true });

  // IP rate-limit (5 / hour / IP). x-forwarded-for is set by Vercel.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!await rateLimit(`review_submit:${ip}`, 5, 3600000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later' });
  }

  // Required fields + rating range. (shop_domain is accepted but not relied on —
  // a store's stores.shopify_url is its internal myshopify handle, which differs
  // from the storefront's shop.permanent_domain. We derive the store from the
  // product's globally-unique Shopify id instead.)
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

  // Optional photo — validated (magic byte + size) AFTER the cheap checks above so a bot
  // can't make us decode/upload before rate-limit/honeypot/validation reject it.
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
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id: store.id, agent: 'REVIEWS', level: 'info',
    message: `Web review submitted by "${cleanAuthor}" (${ratingInt}★${photo_url ? ', +photo' : ''}) — pending`,
  });

  return res.status(200).json({ ok: true });
}

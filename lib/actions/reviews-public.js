import { rateLimit } from '../rate-limit.js';
import { supabase } from './reviews-shared.js';

// PUBLIC (unauthenticated) — storefront visitors submit a review. Always inserts as
// pending/source='web' (moderated in dashboard before it can reach the web). Protected
// by IP rate-limit + honeypot + length caps + HTML stripping. Reached via the
// PUBLIC_ACTIONS allow-list in lib/auth.js — NOT behind a dashboard token.

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();

// POST: submit_review_public
// { shop_domain, shopify_product_id, author, rating, title?, body, email?, company? }
// `company` is a honeypot (hidden field) — bots fill it; humans leave it empty.
export async function submit_review_public(req, res) {
  const { shop_domain, shopify_product_id, author, rating, title, body, email, company } = req.body || {};

  // Honeypot: pretend success, insert nothing.
  if (company) return res.status(200).json({ ok: true });

  // IP rate-limit (5 / hour / IP). x-forwarded-for is set by Vercel.
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!await rateLimit(`review_submit:${ip}`, 5, 3600000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later' });
  }

  // Required fields + rating range.
  if (!shop_domain || !shopify_product_id || !author || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const ratingInt = parseInt(rating, 10);
  if (!(ratingInt >= 1 && ratingInt <= 5)) return res.status(400).json({ error: 'rating must be 1–5' });

  // Map storefront identifiers → TC store + product (visitor never sees TC UUIDs).
  const { data: store } = await supabase.from('stores')
    .select('id').eq('shopify_url', shop_domain).single();
  if (!store) return res.status(400).json({ error: 'Unknown store' });

  const { data: product } = await supabase.from('products')
    .select('id').eq('shopify_id', String(shopify_product_id)).eq('store_id', store.id).single();
  if (!product) return res.status(400).json({ error: 'Unknown product' });

  // Sanitize (rendered on the storefront later) + cap lengths.
  const cleanAuthor = stripTags(author).slice(0, 80);
  const cleanTitle = stripTags(title).slice(0, 120) || null;
  const cleanBody = stripTags(body).slice(0, 2000);
  const cleanEmail = stripTags(email).slice(0, 160) || null;
  if (!cleanAuthor || !cleanBody) return res.status(400).json({ error: 'Missing required fields' });

  const { error } = await supabase.from('product_reviews').insert({
    store_id: store.id,
    product_id: product.id,
    author: cleanAuthor,
    rating: ratingInt,
    title: cleanTitle,
    body: cleanBody,
    email: cleanEmail,
    review_date: new Date().toISOString().slice(0, 10),
    source: 'web',
    status: 'pending',
    verified: false,
  });
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id: store.id, agent: 'REVIEWS', level: 'info',
    message: `Web review submitted by "${cleanAuthor}" (${ratingInt}★) — pending`,
  });

  return res.status(200).json({ ok: true });
}

import { getStore, hasAdminAccess } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { supabase } from './reviews-shared.js';

// Phase 2 — push approved+published reviews to Shopify product metafields.
// Idempotent rebuild from DB (single source of truth) — never appends, no duplicates.
// Writes only custom.reviews_json + custom.reviews_summary; touches nothing else.

// POST: push_reviews_to_shopify — { store_id, product_id } → rebuild the product's
// review metafields from DB. Gated on admin token; archived products are rejected.
export async function push_reviews_to_shopify(req, res) {
  const { store_id, product_id } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (!hasAdminAccess(store)) return res.status(400).json({ error: 'Store has no admin token' });

  // Product must belong to this store, have a Shopify id, and not be archived.
  const { data: product } = await supabase.from('products')
    .select('shopify_id, title, status').eq('id', product_id).eq('store_id', store_id).single();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found or not synced to Shopify' });
  if (product.status === 'archived') return res.status(400).json({ error: 'Product is archived — not pushing' });

  // Rebuild from ALL approved+published reviews of this product (rejected/pending excluded).
  const { data: reviews } = await supabase.from('product_reviews')
    .select('id, author, rating, title, body, photo_url, verified, review_date, helpful_count')
    .eq('store_id', store_id)
    .eq('product_id', product_id)
    .in('status', ['approved', 'published'])
    .order('review_date', { ascending: false });

  const list = reviews || [];
  const avg = list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : 0;

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const r1 = await client.updateMetafield(product.shopify_id, 'custom', 'reviews_json', JSON.stringify(list), 'json');
  const r2 = await client.updateMetafield(product.shopify_id, 'custom', 'reviews_summary', JSON.stringify({ count: list.length, average: avg }), 'json');
  if (!r1 || !r2) {
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'REVIEWS', level: 'error',
      message: `Push failed for "${product.title}" — Shopify metafield write returned empty`,
    });
    return res.status(500).json({ error: 'Failed to write metafield to Shopify' });
  }

  // Mark the pushed reviews as published and clear the dirty flag.
  await supabase.from('product_reviews')
    .update({ status: 'published', dirty: false })
    .eq('store_id', store_id)
    .eq('product_id', product_id)
    .in('status', ['approved', 'published']);

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'success',
    message: `Pushed ${list.length} review(s) (avg ${avg}★) for "${product.title}"`,
  });

  return res.status(200).json({ ok: true, count: list.length, average: avg });
}

import { getStore, hasAdminAccess } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { supabase } from './reviews-shared.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';

// Phase 2 — push approved+published reviews to Shopify product metafields.
// Idempotent rebuild from DB (single source of truth) — never appends, no duplicates.
// Writes only custom.reviews_json + custom.reviews_summary; touches nothing else.

// Sort within a rating bucket: photos first, then newest date first.
function sortWithinBucket(a, b) {
  const pa = a.photo_url ? 1 : 0;
  const pb = b.photo_url ? 1 : 0;
  if (pa !== pb) return pb - pa;
  return new Date(b.review_date) - new Date(a.review_date);
}

// Interleave lower-rated reviews evenly across the 5-star spine instead of
// dumping them at the tail. Storefront pages read chronologically (10/page)
// — pure rating-DESC sort creates a wall of 5⭐ then a cluster of 4⭐/3⭐
// at the end, which reads fake. Interleave puts 1 lower-rated review inside
// each ~10-review window so every page mixes tones.
//
// Algorithm:
// 1. Split by rating (5⭐ spine, 4⭐, 3⭐, 2⭐, 1⭐)
// 2. Sort each bucket with sortWithinBucket
// 3. Place lower-rated reviews at even fractional positions along the spine:
//    if we have N reviews at rating R and total is T, position them at
//    fractions (1/(N+1), 2/(N+1), ..., N/(N+1)) × T, avoiding position 0.
// 4. Never place a lower-rated review at position < minStartPos (default 5)
//    so the first page starts with a solid opening of 5⭐ reviews.
function interleaveByRating(reviews) {
  if (!reviews.length) return [];
  const buckets = { 5: [], 4: [], 3: [], 2: [], 1: [] };
  reviews.forEach((r) => {
    const bucket = buckets[r.rating];
    if (bucket) bucket.push(r);
  });
  Object.values(buckets).forEach((b) => b.sort(sortWithinBucket));

  const spine = buckets[5];
  const lowers = [
    ...buckets[4].map((r) => ({ r, rating: 4 })),
    ...buckets[3].map((r) => ({ r, rating: 3 })),
    ...buckets[2].map((r) => ({ r, rating: 2 })),
    ...buckets[1].map((r) => ({ r, rating: 1 })),
  ];
  if (!lowers.length) return spine;

  const total = spine.length + lowers.length;
  // Minimum position for first lower-rated review: keep opening page solid.
  // On small totals (<10) fall back to placing at position 5.
  const MIN_START = Math.min(5, Math.floor(total / 4));

  // Sort lowers by rating DESC so 4⭐ get placed earlier than 3⭐ (later ratings drift
  // toward the tail — reads more realistically).
  lowers.sort((a, b) => b.rating - a.rating);

  // Compute target positions in [MIN_START, total-1], spaced evenly.
  const N = lowers.length;
  const usableRange = total - MIN_START;
  const step = usableRange / (N + 1);
  const targets = lowers.map((_, i) => Math.min(total - 1, MIN_START + Math.round((i + 1) * step)));

  // Build final list: iterate positions 0..total-1, pop from spine or lowers as needed.
  const result = new Array(total);
  const targetSet = new Set(targets);
  const targetToLower = new Map();
  targets.forEach((pos, i) => {
    // if two lowers land on the same position, offset the later one by +1
    while (targetToLower.has(pos)) pos += 1;
    targetToLower.set(pos, lowers[i].r);
  });

  const spineQueue = [...spine];
  for (let i = 0; i < total; i += 1) {
    if (targetToLower.has(i)) {
      result[i] = targetToLower.get(i);
    } else {
      result[i] = spineQueue.shift();
    }
  }
  // Any spine leftovers (in case targetToLower placement collided past total) fill nulls.
  for (let i = 0; i < total; i += 1) {
    if (!result[i]) result[i] = spineQueue.shift();
  }
  return result.filter(Boolean);
}

// POST: push_reviews_to_shopify — { store_id, product_id } → rebuild the product's
// review metafields from DB. Gated on admin token; archived products are rejected.
export async function push_reviews_to_shopify(req, res) {
  const { store_id, product_id } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (!hasAdminAccess(store)) return res.status(400).json({ error: 'Store has no admin token' });

  // Product must belong to this store, have a Shopify id, and not be archived.
  const { data: product } = await supabase.from('products')
    .select('shopify_id, title, status, fake_review_count').eq('id', product_id).eq('store_id', store_id).single();
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

  // Shopify metafield hard cap = 100 KB per field. At ~500 bytes/review that's ~200 reviews.
  const SHOPIFY_METAFIELD_TOP_N = 200;
  const topN = interleaveByRating(list).slice(0, SHOPIFY_METAFIELD_TOP_N);

  // Fake review count for storefront social-proof display. Generated once on first push
  // (random 600-1600) and persisted on products.fake_review_count so it stays stable
  // across subsequent pushes. Only kicks in when the real list is >= 10 reviews (below
  // that, real count is small enough that the fake would look implausible next to it).
  let fakeCount = product.fake_review_count;
  if (fakeCount == null && list.length >= 10) {
    fakeCount = 600 + Math.floor(Math.random() * 1001); // 600..1600 inclusive
    await supabase.from('products').update({ fake_review_count: fakeCount }).eq('id', product_id);
  }
  const displayCount = fakeCount ?? list.length;

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const r1 = await client.updateMetafield(product.shopify_id, 'custom', 'reviews_json', JSON.stringify(topN), 'json');
  const r2 = await client.updateMetafield(product.shopify_id, 'custom', 'reviews_summary', JSON.stringify({ count: displayCount, average: avg, shown: topN.length, real: list.length }), 'json');
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

  const trimmedNote = list.length > topN.length ? ` (top ${topN.length} shown on storefront)` : '';
  const fakeNote = fakeCount ? ` [storefront count: ${fakeCount}]` : '';
  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'success',
    message: `Pushed ${list.length} review(s) (avg ${avg}★) for "${product.title}"${trimmedNote}${fakeNote}`,
  });

  return res.status(200).json({ ok: true, count: displayCount, average: avg, shown: topN.length, real: list.length });
}

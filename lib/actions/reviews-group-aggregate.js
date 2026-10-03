import { getStore, hasAdminAccess } from '../store-context.js';
import { makeAdminFetch } from '../shopify-token.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';
import { supabase } from './reviews-shared.js';

// Review totals for a group of collections, written to a shop-level Shopify metafield so the
// storefront can show one shared number (e.g. Isola's camis + bras under the product title).
//
// A store opts in through brand_config.review_group_aggregates:
//   [{ "key": "reviews_camis_bras", "collections": ["Camis & Tanks", "Bras"] }]
// key        → the metafield custom.<key>, written as json {count, average, updated_at}
// collections → collection titles as products.tags holds them (set by full sync)
//
// Only `published` reviews count: that is the set the per-product push has put on the
// storefront, so the shared number never runs ahead of what shoppers can read.

const KEY_RE = /^[a-z0-9_]{1,64}$/;
const PRODUCT_PAGE = 1000; // PostgREST returns at most 1000 rows per request

// products.tags holds the product's collection titles, as a JSON string or an array.
export function parseCollections(tags) {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Valid groups from the store config. A malformed entry is skipped, never guessed at: the key
// becomes a metafield name on a live store.
export function reviewGroups(store) {
  const raw = store?.brand_config?.review_group_aggregates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((g) => g && KEY_RE.test(g.key || '')
    && Array.isArray(g.collections) && g.collections.length
    && g.collections.every((c) => typeof c === 'string' && c.trim()));
}

export function groupsForCollections(groups, collections) {
  return groups.filter((g) => g.collections.some((c) => collections.includes(c)));
}

async function groupProductIds(storeId, collections) {
  const ids = [];
  for (let from = 0; ; from += PRODUCT_PAGE) {
    const { data, error } = await supabase.from('products')
      .select('id, tags, status')
      .eq('store_id', storeId)
      .order('id', { ascending: true })
      .range(from, from + PRODUCT_PAGE - 1);
    if (error) throw error;
    for (const p of data || []) {
      if (p.status === 'archived') continue;
      if (parseCollections(p.tags).some((c) => collections.includes(c))) ids.push(p.id);
    }
    if (!data || data.length < PRODUCT_PAGE) break;
  }
  return ids;
}

// Exact per-star counts (head requests carry no rows, so the 1000-row cap does not apply).
async function ratingCounts(storeId, productIds) {
  const counts = {};
  for (const rating of [1, 2, 3, 4, 5]) {
    const { count, error } = await supabase.from('product_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'published')
      .in('product_id', productIds)
      .eq('rating', rating);
    if (error) throw error;
    counts[rating] = count || 0;
  }
  return counts;
}

export function summarize(counts) {
  const count = Object.values(counts).reduce((s, n) => s + n, 0);
  const sum = Object.entries(counts).reduce((s, [rating, n]) => s + Number(rating) * n, 0);
  const average = count ? Math.round((sum / count) * 100) / 100 : 0;
  return { count, average };
}

async function writeShopMetafield(store, key, value) {
  const url = `https://${store.shopify_url}/admin/api/2024-01/metafields.json`;
  const resp = await makeAdminFetch(store.id, store.admin_token)(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metafield: { namespace: 'custom', key, type: 'json', value: JSON.stringify(value) } }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`shop metafield custom.${key} write failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

// Recompute and write every configured group, or only those touching `collections` (the pushed
// product's collections). Returns one result per group written.
export async function refreshReviewGroupAggregates(store, storeId, { collections = null, userId = null } = {}) {
  let groups = reviewGroups(store);
  if (collections) groups = groupsForCollections(groups, collections);
  const results = [];
  for (const group of groups) {
    const productIds = await groupProductIds(storeId, group.collections);
    // No products would make `.in()` an empty list; write zeros rather than skip, so a group
    // whose collections were emptied does not keep showing an old number.
    const counts = productIds.length ? await ratingCounts(storeId, productIds) : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const { count, average } = summarize(counts);
    await writeShopMetafield(store, group.key, {
      count, average, collections: group.collections, updated_at: new Date().toISOString(),
    });
    await supabase.from('pipeline_log').insert({
      store_id: storeId, agent: 'REVIEWS', level: 'info',
      message: `Review group custom.${group.key} updated: ${count} reviews, avg ${average}★ (${group.collections.join(' + ')}, ${productIds.length} products)`,
      user_id: userId, initiator: 'user',
    });
    results.push({ key: group.key, count, average, products: productIds.length });
  }
  return results;
}

// POST: refresh_review_group_aggregates — { store_id } → recompute every configured group now.
// For the first write after configuring a group, and for manual checks.
export async function refresh_review_group_aggregates(req, res) {
  const { store_id } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (!hasAdminAccess(store)) return res.status(400).json({ error: 'Store has no admin token' });
  if (!reviewGroups(store).length) return res.status(400).json({ error: 'No review groups configured (brand_config.review_group_aggregates)' });

  const groups = await refreshReviewGroupAggregates(store, store_id, { userId: req.user?.user_id || null });
  return res.status(200).json({ ok: true, groups });
}

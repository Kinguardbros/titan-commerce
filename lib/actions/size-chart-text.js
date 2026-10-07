// Per-product plain-text size chart in custom.size_chart_text (CSV: header row + one row per size).
// Isola's theme renders this metafield in its size guide drawer (snippets/size-guide-drawer.liquid);
// Clara Atelier's theme reads the size_chart metaobject instead (see size-chart.js). The dashboard
// shows this editor only for stores with brand_config.features.size_chart_text === true.
// Restored 2026-10-07 from cb00331 after the 2026-09-22 metaobject rewrite (d4b2763) removed it for
// every store, leaving Isola without a way to set its charts. has_size_chart is not written here:
// since d4b2763 it means "references a size_chart metaobject".
import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';
import { shopifyFailure } from '../shopify-failure.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET: read_size_chart — { store_id, product_id } → { size_chart_text }
export async function read_size_chart(req, res) {
  const storeId = req.query.store_id;
  const productId = req.query.product_id;
  if (!storeId || !productId) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(storeId);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const { data: product } = await supabase.from('products').select('shopify_id')
    .eq('id', productId).eq('store_id', storeId).maybeSingle();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const metafield = await client.getMetafield(product.shopify_id, 'custom', 'size_chart_text');
  return res.status(200).json({ size_chart_text: metafield?.value || null });
}

// POST: save_size_chart — { store_id, product_id, size_chart_text } → writes custom.size_chart_text
export async function save_size_chart(req, res) {
  const { store_id, product_id, size_chart_text } = req.body || {};
  if (!store_id || !product_id || !size_chart_text) {
    return res.status(400).json({ error: 'store_id, product_id, and size_chart_text required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const { data: product } = await supabase.from('products').select('shopify_id, title')
    .eq('id', product_id).eq('store_id', store_id).maybeSingle();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const result = await client.updateMetafield(product.shopify_id, 'custom', 'size_chart_text', size_chart_text);
  if (!result) return res.status(500).json(shopifyFailure(client, 'Failed to save the size chart to Shopify'));

  const { error: logErr } = await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: 'info',
    message: `Updated size chart (text) for "${product.title}"`,
    user_id: req.user?.user_id || null, initiator: 'user',
  });
  if (logErr) console.error('[SizeChartText] pipeline_log insert failed:', { store_id, product_id, logErr });

  return res.status(200).json({ ok: true });
}

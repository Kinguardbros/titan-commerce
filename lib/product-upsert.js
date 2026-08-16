import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Upsert a single Shopify product into the products table.
 * Shared between full sync (lib/actions/sync.js) and webhook handlers (lib/shopify-webhook-handlers.js).
 *
 * NOTE: Does NOT set `tags` (collections) — Shopify webhook payload does not include collection
 * memberships. Full sync sets tags separately. On webhook update we preserve the existing tags value.
 */
export async function upsertProductFromShopify(storeId, storeUrl, p) {
  const images = (p.images || []).map((img) => img.src);
  const upsertData = {
    shopify_id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.variants?.[0]?.price || null,
    description: (p.body_html || '').replace(/<[^>]*>/g, '').slice(0, 2000),
    image_url: images[0] || null,
    images: JSON.stringify(images),
    product_url: `https://${storeUrl}/products/${p.handle}`,
    product_type: p.product_type || null,
    vendor: p.vendor || null,
    status: p.status || 'active',
    synced_at: new Date().toISOString(),
    store_id: storeId,
  };
  // Composite conflict target (P0-4, Docs/AUDIT-2026-08.md): shopify_id/handle are no
  // longer globally unique — scoped per store (sql/fix-products-composite-unique.sql /
  // sql/add-stores.sql). A global 'shopify_id' target here would stop matching existing
  // rows once the DB constraint changes, causing duplicate-insert errors instead of updates.
  const { error } = await supabase.from('products').upsert(upsertData, { onConflict: 'store_id,shopify_id' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
  return { shopify_id: p.id, handle: p.handle };
}

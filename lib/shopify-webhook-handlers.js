import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from './product-upsert.js';
import { ensureCompareAtFallback } from './compare-at-fallback.js';
import { makeAdminFetch } from './shopify-token.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Defense-in-depth (P1-23, AUDIT-2026-08): the sole caller (api/webhooks/shopify.js)
// already rejects requests with no matching `store` row before invoking any handler
// below, but a falsy `store` here previously surfaced as an opaque TypeError
// ("Cannot read properties of null/undefined") deep inside upsertProductFromShopify /
// the Supabase query builder. A future caller (another webhook route, a script, a
// test) that skips that pre-check now gets an explicit, attributable error instead.
function assertStore(store, fnName) {
  if (!store) throw new Error(`${fnName}: missing store`);
}

// Struck-price fallback (lib/compare-at-fallback.js): stores that opt in get
// custom.source_compare_at_cents filled from the variants' compare-at price. Never fails the
// webhook: a Shopify error is logged and the product upsert above still counts.
async function syncCompareAtFallback(store, p) {
  try {
    const res = await ensureCompareAtFallback(store, p, makeAdminFetch(store.id, store.admin_token));
    if (res.action === 'set') {
      await supabase.from('pipeline_log').insert({
        store_id: store.id, agent: 'SCRAPER', level: 'info',
        message: `Struck price set for "${p.title || p.handle}": ${(res.cents / 100).toFixed(2)} (custom.source_compare_at_cents, was ${res.previous ?? 'empty'})`,
        metadata: { shopify_id: p.id, handle: p.handle, ...res },
        user_id: null, initiator: 'webhook',
      });
    }
    return res;
  } catch (err) {
    console.error('[webhook] compare-at fallback failed:', { shopify_id: p?.id, error: err.message });
    return { action: 'error', error: err.message };
  }
}

export async function handleProductCreate(store, p) {
  assertStore(store, 'handleProductCreate');
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  const compare_at = await syncCompareAtFallback(store, p);
  // Look up the DB product_id for the notification link
  const { data: dbProduct } = await supabase.from('products').select('id').eq('shopify_id', String(p.id)).single();
  return { action: 'created', shopify_id: p.id, title: p.title, product_id: dbProduct?.id || null, compare_at };
}

export async function handleProductUpdate(store, p) {
  assertStore(store, 'handleProductUpdate');
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  const compare_at = await syncCompareAtFallback(store, p);
  const { data: dbProduct } = await supabase.from('products').select('id').eq('shopify_id', String(p.id)).single();
  return { action: 'updated', shopify_id: p.id, title: p.title, product_id: dbProduct?.id || null, compare_at };
}

export async function handleProductDelete(store, p) {
  assertStore(store, 'handleProductDelete');
  const { error } = await supabase.from('products')
    .update({ status: 'archived', synced_at: new Date().toISOString() })
    .eq('store_id', store.id).eq('shopify_id', String(p.id));
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { action: 'archived', shopify_id: p.id };
}

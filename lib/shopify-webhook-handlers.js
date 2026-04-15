import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from './product-upsert.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function handleProductCreate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  return { action: 'created', shopify_id: p.id };
}

export async function handleProductUpdate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  return { action: 'updated', shopify_id: p.id };
}

export async function handleProductDelete(store, p) {
  const { error } = await supabase.from('products')
    .update({ status: 'archived', synced_at: new Date().toISOString() })
    .eq('store_id', store.id).eq('shopify_id', String(p.id));
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { action: 'archived', shopify_id: p.id };
}

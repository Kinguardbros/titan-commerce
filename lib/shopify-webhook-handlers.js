import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from './product-upsert.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function handleProductCreate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  // Look up the DB product_id for the notification link
  const { data: dbProduct } = await supabase.from('products').select('id').eq('shopify_id', String(p.id)).single();
  return { action: 'created', shopify_id: p.id, title: p.title, product_id: dbProduct?.id || null };
}

export async function handleProductUpdate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  const { data: dbProduct } = await supabase.from('products').select('id').eq('shopify_id', String(p.id)).single();
  return { action: 'updated', shopify_id: p.id, title: p.title, product_id: dbProduct?.id || null };
}

export async function handleProductDelete(store, p) {
  const { error } = await supabase.from('products')
    .update({ status: 'archived', synced_at: new Date().toISOString() })
    .eq('store_id', store.id).eq('shopify_id', String(p.id));
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { action: 'archived', shopify_id: p.id };
}

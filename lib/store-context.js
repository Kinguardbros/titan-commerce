import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function getStore(storeId) {
  const { data } = await supabase.from('stores').select('*').eq('id', storeId).single();
  return data;
}

export async function getStoreBySlug(slug) {
  const { data } = await supabase.from('stores').select('*').eq('slug', slug).single();
  return data;
}

export async function getAllStores() {
  const { data } = await supabase.from('stores').select('id, name, slug, currency, shopify_url, is_active, admin_token').eq('is_active', true).order('name');
  return data || [];
}

export function hasAdminAccess(store) {
  return !!(store?.admin_token);
}

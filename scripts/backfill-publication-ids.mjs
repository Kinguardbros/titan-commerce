#!/usr/bin/env node
// One-shot: populate stores.online_store_publication_id for every store with an admin_token.
// Run AFTER merchants have reauthorized the Shopify app with the new scopes.
// Usage: node scripts/backfill-publication-ids.mjs
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { createShopifyClient } from '../lib/shopify-admin.js';
import { getOnlineStorePublicationId } from '../lib/shopify-publications.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: stores, error } = await supabase
  .from('stores')
  .select('id, name, shopify_url, admin_token, online_store_publication_id');

if (error) {
  console.error('Failed to load stores:', error);
  process.exit(1);
}

for (const store of stores || []) {
  if (!store.admin_token) {
    console.log(`[skip] ${store.name}: no admin_token`);
    continue;
  }
  if (store.online_store_publication_id) {
    console.log(`[skip] ${store.name}: already has publication_id (${store.online_store_publication_id})`);
    continue;
  }
  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const pubId = await getOnlineStorePublicationId(client);
  if (!pubId) {
    console.error(`[fail] ${store.name}: could not resolve Online Store publication (reauthorize with new scopes?)`);
    continue;
  }
  const { error: updErr } = await supabase
    .from('stores')
    .update({ online_store_publication_id: pubId })
    .eq('id', store.id);
  if (updErr) {
    console.error(`[fail] ${store.name}: DB update failed`, updErr);
    continue;
  }
  console.log(`[ok] ${store.name}: ${pubId}`);
}

console.log('Done.');

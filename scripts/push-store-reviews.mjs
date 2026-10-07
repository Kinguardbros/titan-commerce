#!/usr/bin/env node
// Re-push the review metafields of every product of one store that has review rows, after an
// optional bulk reject. Goes through the deployed Titan API (the same push_reviews_to_shopify the
// dashboard button calls), so the storefront ends up exactly as the dashboard would leave it, and
// the store-wide badge + review groups refresh along the way.
//
// Dry run by default: prints what it would do and writes nothing.
//
//   node --env-file=<titan-commerce>/.env.local scripts/push-store-reviews.mjs \
//     --store <store_id> [--reject-file reject.txt] [--live]
//
// --reject-file: one review id per line (# comments allowed) → set_review_status 'rejected'
//                before the pushes. Rejected rows stay in the DB.
// Needs: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read-only use: listing products), a bearer
// api_token in ~/.titan-api-token, TITAN_API (default https://titan-commerce.vercel.app).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const storeId = opt('--store');
const rejectFile = opt('--reject-file');
const live = args.includes('--live');
const api = (process.env.TITAN_API || 'https://titan-commerce.vercel.app') + '/api/system';
if (!storeId) { console.error('--store <store_id> required'); process.exit(1); }

const token = readFileSync(`${homedir()}/.titan-api-token`, 'utf8').trim();
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function call(action, body) {
  const resp = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`${action} HTTP ${resp.status}: ${json.error || ''} ${json.hint || ''}`.trim());
  return json;
}

// 1. Optional bulk reject.
const rejectIds = rejectFile
  ? readFileSync(rejectFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
  : [];
if (rejectIds.length) {
  console.log(`${live ? 'Rejecting' : '[dry run] would reject'} ${rejectIds.length} review(s)`);
  if (live) console.log('  ', await call('set_review_status', { store_id: storeId, ids: rejectIds, status: 'rejected' }));
}

// 2. Every non-archived, synced product of the store that has at least one review row (any
//    status): a product whose reviews were all rejected still needs a push to clear its metafield.
const withReviews = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('product_reviews').select('product_id')
    .eq('store_id', storeId).order('id').range(from, from + 999);
  if (error) throw error;
  data.forEach((r) => withReviews.add(r.product_id));
  if (data.length < 1000) break;
}
const { data: products, error } = await db.from('products')
  .select('id, title, status, shopify_id').eq('store_id', storeId).in('id', [...withReviews]);
if (error) throw error;
const targets = products.filter((p) => p.status !== 'archived' && p.shopify_id)
  .sort((a, b) => a.title.localeCompare(b.title));
console.log(`${live ? 'Pushing' : '[dry run] would push'} ${targets.length} product(s)`);

// 3. Sequential pushes: one product at a time keeps Shopify and the API well inside limits.
let ok = 0;
const failed = [];
for (const p of targets) {
  if (!live) { console.log('  -', p.title); continue; }
  try {
    const r = await call('push_reviews_to_shopify', { store_id: storeId, product_id: p.id });
    ok += 1;
    console.log(`  ✓ ${p.title}: ${r.real} review(s), avg ${r.average}${r.trimmed ? `, ${r.trimmed} trimmed for size` : ''}`);
  } catch (err) {
    failed.push(p.title);
    console.log(`  ✗ ${p.title}: ${err.message}`);
  }
}
if (live) {
  console.log(`\nDone: ${ok} pushed, ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}`);
  process.exit(failed.length ? 2 : 0);
}

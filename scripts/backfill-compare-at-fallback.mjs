// One-off: apply the struck-price fallback (lib/compare-at-fallback.js) to every product of a
// store, for products created before the webhook did it. Dry run by default.
//
//   node --env-file=.env.local scripts/backfill-compare-at-fallback.mjs --store clara-atelier
//   node --env-file=.env.local scripts/backfill-compare-at-fallback.mjs --store clara-atelier --live
//
// Same rules as the webhook: fill when empty, follow a shared compare-at, never overwrite when
// the variants' compare-at prices differ. Requires brand_config.features.compare_at_fallback_metafield.
import { createClient } from '@supabase/supabase-js';
import { makeAdminFetch, API_VERSION } from '../lib/shopify-token.js';
import {
  fallbackCompareCents, decideFallbackWrite, fallbackEnabled, ensureCompareAtFallback,
  FALLBACK_NAMESPACE, FALLBACK_KEY,
} from '../lib/compare-at-fallback.js';

const args = process.argv.slice(2);
const slug = args[args.indexOf('--store') + 1];
const live = args.includes('--live');
if (!slug || args.indexOf('--store') === -1) {
  console.error('usage: --store <slug> [--live]');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: store, error } = await supabase.from('stores')
  .select('id, name, shopify_url, admin_token, brand_config').eq('slug', slug).single();
if (error || !store) { console.error('store not found:', slug); process.exit(1); }
if (!fallbackEnabled(store)) { console.error(`${slug}: brand_config.features.compare_at_fallback_metafield is not true`); process.exit(1); }

const adminFetch = makeAdminFetch(store.id, store.admin_token);
const url = `https://${store.shopify_url}/admin/api/${API_VERSION}/graphql.json`;
const query = `query($c: String) { products(first: 100, after: $c) { pageInfo { hasNextPage endCursor }
  nodes { id handle title variants(first: 100) { nodes { price compareAtPrice } }
  metafield(namespace: "${FALLBACK_NAMESPACE}", key: "${FALLBACK_KEY}") { value } } } }`;

const plan = [];
let cursor = null;
do {
  const resp = await adminFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { c: cursor } }) });
  const { data, errors } = await resp.json();
  if (errors) { console.error(JSON.stringify(errors)); process.exit(1); }
  for (const p of data.products.nodes) {
    const variants = p.variants.nodes.map((v) => ({ price: v.price, compare_at_price: v.compareAtPrice }));
    const want = fallbackCompareCents(variants);
    const current = p.metafield ? Number(p.metafield.value) : null;
    const decision = decideFallbackWrite(current, want);
    if (decision === 'set') plan.push({ id: p.id.split('/').pop(), handle: p.handle, title: p.title, variants, current, cents: want.cents });
  }
  cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
} while (cursor);

console.log(`${store.name}: ${plan.length} product(s) to update${live ? '' : ' (dry run)'}`);
for (const p of plan) console.log(`  ${p.handle}: ${p.current ?? 'empty'} -> ${p.cents}`);
if (!live) process.exit(0);

let done = 0;
for (const p of plan) {
  const res = await ensureCompareAtFallback(store, { id: p.id, variants: p.variants }, adminFetch);
  if (res.action === 'set') done++;
  await supabase.from('pipeline_log').insert({
    store_id: store.id, agent: 'SCRAPER', level: 'info',
    message: `Struck price set for "${p.title}": ${(p.cents / 100).toFixed(2)} (custom.source_compare_at_cents, backfill, was ${p.current ?? 'empty'})`,
    metadata: { handle: p.handle, shopify_id: p.id, ...res }, user_id: null, initiator: 'system',
  });
}
console.log(`written: ${done}`);

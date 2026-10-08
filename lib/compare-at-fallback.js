import { API_VERSION } from './shopify-token.js';

// Struck-price fallback for stores whose theme cannot rely on the variant compare-at price.
//
// Shopify hides variant compare-at prices from buyers in EU countries (checked on Clara Atelier
// 2026-10-07: contextualPricing returns compareAtPrice null for DE/AT/CZ and the real value for
// CH/US). Clara's theme therefore prints the struck price from the product metafield
// custom.source_compare_at_cents (integer cents), and a freshly imported product without that
// metafield showed no sale price at all. Dan chose (2026-10-08) to have Titan fill it from the
// variants on every products/create and products/update webhook, aware of the EU price-reduction
// rules (Omnibus, § 11 PAngV) that Shopify enforces by hiding the price.
//
// Opt-in per store: brand_config.features.compare_at_fallback_metafield === true.
//
// Rules (from the 2026-10-07 catalogue check: 374 of 396 products already matched the variants,
// one product with different variant prices did not):
// - only variants whose compare-at is above their own price count;
// - one shared compare-at across all variants → the metafield follows it (filled or corrected);
// - compare-at prices that differ between variants → filled once with the lowest, never overwritten;
// - no qualifying compare-at → nothing is touched (an existing metafield stays).

export const FALLBACK_NAMESPACE = 'custom';
export const FALLBACK_KEY = 'source_compare_at_cents';

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * What the metafield should hold for these variants (REST webhook shape:
 * `{ price: "59.95", compare_at_price: "129.95" | null }`).
 * @returns {{ cents: number, uniform: boolean } | null}
 */
export function fallbackCompareCents(variants) {
  const list = Array.isArray(variants) ? variants : [];
  const qualifying = [];
  for (const v of list) {
    const price = toNumber(v?.price);
    const compare = toNumber(v?.compare_at_price ?? v?.compareAtPrice);
    if (price !== null && compare !== null && compare > price) qualifying.push(compare);
  }
  if (qualifying.length === 0) return null;
  const allCompares = list.map((v) => toNumber(v?.compare_at_price ?? v?.compareAtPrice));
  const uniform = qualifying.length === list.length && allCompares.every((c) => c === allCompares[0]);
  return { cents: Math.round(Math.min(...qualifying) * 100), uniform };
}

/**
 * Whether to write, given the metafield's current value (number or null).
 * @returns {'set' | 'kept' | 'none'}
 */
export function decideFallbackWrite(current, plan) {
  if (!plan) return 'none';
  if (current === null || current === undefined) return 'set';
  if (plan.uniform && Number(current) !== plan.cents) return 'set';
  return 'kept';
}

export function fallbackEnabled(store) {
  return store?.brand_config?.features?.compare_at_fallback_metafield === true;
}

/**
 * Fill or correct custom.source_compare_at_cents for one product.
 * @param {object} store — needs id, shopify_url, brand_config
 * @param {object} product — Shopify REST product (webhook payload): id, variants[]
 * @param {Function} adminFetch — from makeAdminFetch(store.id, store.admin_token)
 * @returns {Promise<{action: 'off'|'none'|'kept'|'set', cents?: number, previous?: number|null}>}
 */
export async function ensureCompareAtFallback(store, product, adminFetch) {
  if (!fallbackEnabled(store)) return { action: 'off' };
  const plan = fallbackCompareCents(product?.variants);
  if (!plan) return { action: 'none' };

  const gid = `gid://shopify/Product/${product.id}`;
  const url = `https://${store.shopify_url}/admin/api/${API_VERSION}/graphql.json`;
  const post = async (query, variables) => {
    const resp = await adminFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const data = await resp.json();
    if (data.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors).slice(0, 200)}`);
    return data.data;
  };

  const read = await post(
    `query($id: ID!) { product(id: $id) { metafield(namespace: "${FALLBACK_NAMESPACE}", key: "${FALLBACK_KEY}") { value } } }`,
    { id: gid },
  );
  const raw = read?.product?.metafield?.value;
  const previous = raw === undefined || raw === null ? null : Number(raw);

  const decision = decideFallbackWrite(previous, plan);
  if (decision !== 'set') return { action: decision, cents: plan.cents, previous };

  const written = await post(
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    { m: [{ ownerId: gid, namespace: FALLBACK_NAMESPACE, key: FALLBACK_KEY, type: 'number_integer', value: String(plan.cents) }] },
  );
  const errs = written?.metafieldsSet?.userErrors || [];
  if (errs.length) throw new Error(`metafieldsSet: ${errs.map((e) => e.message).join('; ')}`);
  return { action: 'set', cents: plan.cents, previous };
}

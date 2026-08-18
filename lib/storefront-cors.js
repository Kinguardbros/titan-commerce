import { createClient } from '@supabase/supabase-js';

// Per-store CORS origin resolution for public storefront actions (P1-10,
// AUDIT-2026-08; preflight fix P1-A, AUDIT-2026-08-B). Extracted out of
// api/system.js to keep the router thin and to isolate the DB lookup +
// fail-open fallback logic in one testable place.
//
// Background: submit_review_public / vote_review_helpful / review_helpful_counts
// are unauthenticated (called directly by a storefront visitor's browser) —
// the CORS check runs BEFORE auth/rate-limit/dispatch, on every request
// including abuse traffic. This module must NEVER throw; any DB error falls
// back to the legacy global allow-list instead of 500ing an unauth request.
//
// P1-A fix (AUDIT-2026-08-B): a CORS preflight OPTIONS request never carries a
// body, so resolveStoreId() (below) — which infers the target store from
// shopify_product_id/review_id in the body/query — returns null on EVERY
// preflight unless the request URL happens to carry ?store_id=. That made the
// legacy STOREFRONT_URL fallback the *only* path preflight ever took, which is
// hardcoded Isola-only. The fix is two mechanisms, both implemented here:
//   1. Origin-based resolution (primary, resolveStoreIdByOrigin below) — match
//      the request's Origin header (always present, even on preflight) against
//      every store's storefront_origins. Works for every store with zero
//      storefront widget changes.
//   2. ?store_id= query param (belt) — resolveStoreId's `explicit` branch
//      already honors this; a preflight carries the same query string as the
//      real request, so a widget that appends ?store_id= to its fetch URL
//      resolves via the cheap direct-lookup path instead. See the widget
//      guidance in reviews-public.js and Docs/RUNBOOK-new-store.md section 4.

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Legacy global fallback — genuinely a last resort now that origin-based
// resolution (below) covers the preflight case that used to make this the
// only path taken. Kept for burn-in: a request whose Origin doesn't match ANY
// store's storefront_origins (new store not yet backfilled, or a stale/typo'd
// origin) still needs to fail open rather than 500 or silently drop CORS
// entirely. Every fallback hit is console.warn'd so it's visible which
// store/action is still relying on it.
// TODO(P1-10 follow-up, now actually satisfiable post-P1-A): delete this
// function + the STOREFRONT_URL env var once logs confirm nothing has hit the
// fallback for a full deploy cycle.
function legacyStorefrontOrigins() {
  return (process.env.STOREFRONT_URL || 'https://isolaswim.com,https://swimwear-brand.myshopify.com')
    .split(',').map((o) => o.trim()).filter(Boolean);
}

// Best-effort in-memory cache, scoped to one warm serverless container. A CORS
// preflight (OPTIONS) is immediately followed by the real request — same
// container more often than not on Vercel — so this avoids re-querying the
// same store's origins twice in quick succession. Purely a perf nicety: a
// cold start or a different container just re-queries, never a correctness
// issue (fail-open on miss).
const CACHE_TTL_MS = 60_000;
const originsCache = new Map(); // store_id -> { origins, expires }

async function getStorefrontOrigins(storeId) {
  const cached = originsCache.get(storeId);
  if (cached && cached.expires > Date.now()) return cached.origins;

  const { data, error } = await supabase.from('stores')
    .select('storefront_origins').eq('id', storeId).single();
  if (error || !data) return null;

  const origins = Array.isArray(data.storefront_origins) ? data.storefront_origins : [];
  originsCache.set(storeId, { origins, expires: Date.now() + CACHE_TTL_MS });
  return origins;
}

// Origin -> store_id reverse index (P1-A, AUDIT-2026-08-B) — the PRIMARY
// resolution path when resolveStoreId can't determine a target store, which
// is every CORS preflight OPTIONS request (no body) unless the widget also
// appends ?store_id= to the URL. A preflight always carries the browser's
// real Origin header though, so matching it against every store's
// storefront_origins resolves the store correctly with zero widget changes.
// Built from one `select id, storefront_origins from stores` query (there's
// no other field to filter by — we don't know the store yet, that's the
// point) and cached the same way as getStorefrontOrigins above.
// Vercel cold-start note: a fresh serverless container starts with an empty
// cache and pays one extra `stores` query on its first preflight; the 60s TTL
// then absorbs the rest of that container's traffic. Never a correctness
// issue — a cache miss just re-queries.
let originIndexCache = { map: null, expires: 0 };

async function getOriginIndex() {
  if (originIndexCache.map && originIndexCache.expires > Date.now()) return originIndexCache.map;

  const { data, error } = await supabase.from('stores').select('id, storefront_origins');
  if (error || !data) return null;

  const map = new Map();
  for (const row of data) {
    for (const origin of (Array.isArray(row.storefront_origins) ? row.storefront_origins : [])) {
      map.set(origin, row.id);
    }
  }
  originIndexCache = { map, expires: Date.now() + CACHE_TTL_MS };
  return map;
}

// Resolve a store from the request's Origin header alone. Returns null (not
// an unmatched-origin signal by itself — callers still fall back to the
// legacy list) when the origin belongs to no store, or on any DB error.
async function resolveStoreIdByOrigin(origin) {
  if (!origin) return null;
  const map = await getOriginIndex();
  return map ? (map.get(origin) || null) : null;
}

// Resolve which store a public storefront action targets, from whatever
// identifying field that action's payload already carries (none of these
// actions REQUIRE a store_id — inferring it keeps the storefront's existing
// request shape unchanged, no coordinated theme-repo deploy forced). Returns
// null when it can't be resolved from body/query alone (always true for a
// CORS preflight OPTIONS request, which never carries a body) — callers fall
// back to origin-based resolution first, then the legacy global allow-list.
async function resolveStoreId(req, action) {
  const body = req.body || {};
  const query = req.query || {};

  // Belt mechanism (P1-A, AUDIT-2026-08-B): if the widget appends ?store_id=
  // to its fetch URL, a preflight carries it too (browsers include the query
  // string on preflight), so this resolves without any DB round-trip at all —
  // the cheapest and most robust path when available. Recommended but not
  // required; origin-based resolution (resolveStoreIdByOrigin, called from
  // getPerStoreOrigins when this returns null) covers stores that haven't
  // adopted the query param yet. See reviews-public.js and
  // Docs/RUNBOOK-new-store.md section 4 for the widget-side guidance.
  const explicit = body.store_id || query.store_id;
  if (explicit) return explicit;

  if (action === 'submit_review_public') {
    const shopifyProductId = body.shopify_product_id;
    if (!shopifyProductId) return null;
    const { data } = await supabase.from('products')
      .select('store_id').eq('shopify_id', String(shopifyProductId)).single();
    return data?.store_id || null;
  }
  if (action === 'review_helpful_counts') {
    const shopifyProductId = query.shopify_product_id;
    if (!shopifyProductId) return null;
    const { data } = await supabase.from('products')
      .select('store_id').eq('shopify_id', String(shopifyProductId)).single();
    return data?.store_id || null;
  }
  if (action === 'vote_review_helpful') {
    const reviewId = body.review_id;
    if (!reviewId) return null;
    const { data } = await supabase.from('product_reviews')
      .select('store_id').eq('id', reviewId).single();
    return data?.store_id || null;
  }
  return null;
}

// Public entry point — returns the CORS allow-list origins for a per-store
// public action. Never throws: any failure resolves to the legacy global list.
export async function getPerStoreOrigins(req, action) {
  let storeId = null;
  try {
    storeId = await resolveStoreId(req, action);
  } catch (err) {
    console.error('[CORS] resolveStoreId failed:', { action, error: err.message });
  }

  // Primary mechanism (P1-A, AUDIT-2026-08-B): resolveStoreId returns null on
  // every preflight (no body) unless ?store_id= is on the URL. Fall back to
  // matching the request's Origin header against every store's
  // storefront_origins before giving up to the legacy list — this is what
  // makes preflight resolve correctly for every store, not just Isola.
  if (!storeId) {
    try {
      storeId = await resolveStoreIdByOrigin(req.headers?.origin);
    } catch (err) {
      console.error('[CORS] resolveStoreIdByOrigin failed:', { action, error: err.message });
    }
  }

  if (!storeId) {
    console.warn(`[CORS] using legacy STOREFRONT_URL fallback for action '${action}' (store unresolved by body/query/origin — likely a preflight from an origin not yet in any store's storefront_origins)`);
    return legacyStorefrontOrigins();
  }

  let origins = null;
  try {
    origins = await getStorefrontOrigins(storeId);
  } catch (err) {
    console.error('[CORS] getStorefrontOrigins failed:', { storeId, action, error: err.message });
  }

  if (!origins || origins.length === 0) {
    console.warn(`[CORS] using legacy STOREFRONT_URL fallback for store ${storeId} (storefront_origins empty or unset)`);
    return legacyStorefrontOrigins();
  }
  return origins;
}

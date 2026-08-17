import { createClient } from '@supabase/supabase-js';

// Per-store CORS origin resolution for public storefront actions (P1-10,
// AUDIT-2026-08). Extracted out of api/system.js to keep the router thin and
// to isolate the DB lookup + fail-open fallback logic in one testable place.
//
// Background: submit_review_public / vote_review_helpful / review_helpful_counts
// are unauthenticated (called directly by a storefront visitor's browser) —
// the CORS check runs BEFORE auth/rate-limit/dispatch, on every request
// including abuse traffic. This module must NEVER throw; any DB error falls
// back to the legacy global allow-list instead of 500ing an unauth request.

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Legacy global fallback — kept for one deploy cycle after stores.storefront_origins
// landed. Used when (a) the request's target store can't be resolved (e.g. a CORS
// preflight OPTIONS carries no body for a POST action, so there's nothing to look a
// store up by), or (b) the resolved store's storefront_origins is still empty
// (not backfilled). Every fallback hit is console.warn'd so it's visible which
// store/action is still relying on it.
// TODO(P1-10 follow-up): delete this function + the STOREFRONT_URL env var once
// logs confirm nothing has hit the fallback for a full deploy cycle.
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

// Resolve which store a public storefront action targets, from whatever
// identifying field that action's payload already carries (none of these
// actions accept a store_id today — inferring it keeps the storefront's
// existing request shape unchanged, no coordinated theme-repo deploy needed).
// Returns null when it can't be resolved (most commonly: a CORS preflight
// OPTIONS request, which never carries a body) — callers fall back to the
// legacy global allow-list in that case.
async function resolveStoreId(req, action) {
  const body = req.body || {};
  const query = req.query || {};

  // Forward-compatible: if a caller ever starts sending store_id directly, use it.
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

  if (!storeId) {
    console.warn(`[CORS] using legacy STOREFRONT_URL fallback for action '${action}' (store unresolved — likely a preflight with no body)`);
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

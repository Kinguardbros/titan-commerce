import { createClient } from '@supabase/supabase-js';

// Built on first use, not at import time. Several call sites import this module purely for
// makeAdminFetch, and an eager createClient() throws "supabaseUrl is required" the moment the
// module is imported in a context without those env vars — turning a missing env var into an
// import-time crash for code that never touches the DB.
let _supabase = null;
function db() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _supabase;
}

const API_VERSION = '2024-01';

// Shopify hands back `expires_in` seconds. Persist the expiry a minute early so a token that
// is about to die on the wire is already considered dead here.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

// One store's token expiring takes out every in-flight request against that store at once, so
// without this they would all mint their own replacement and the last write would win. Keyed by
// store id; the entry is dropped as soon as the exchange settles.
const inFlight = new Map();

/**
 * Mint a fresh Admin API token for a store from its stored OAuth app credentials and persist it.
 *
 * Only ever call this REACTIVELY, after Shopify has actually rejected the current token with a
 * 401. Stores can hold a long-lived `shpat_` token AND client_id/client_secret at the same time
 * (Isola does), and minting there would swap a working permanent token for a 24h one.
 *
 * @returns {Promise<string|null>} the new token, or null when the store cannot be refreshed
 *   (no OAuth credentials stored, or Shopify refused the exchange).
 */
export async function refreshAdminToken(storeId) {
  if (!storeId) return null;
  if (inFlight.has(storeId)) return inFlight.get(storeId);

  const run = (async () => {
    const { data: store } = await db()
      .from('stores')
      .select('id, shopify_url, client_id, client_secret')
      .eq('id', storeId)
      .single();

    if (!store?.client_id || !store?.client_secret) {
      // Not an error: a store with a hand-pasted permanent token has nothing to refresh from.
      console.error('[shopify-token] no OAuth credentials stored, cannot refresh:', { storeId });
      return null;
    }

    let payload;
    try {
      const res = await fetch(`https://${store.shopify_url}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: store.client_id,
          client_secret: store.client_secret,
          grant_type: 'client_credentials',
        }),
      });
      payload = res.ok ? await res.json() : null;
      if (!payload?.access_token) {
        console.error('[shopify-token] exchange rejected:', { storeId, status: res.status });
        return null;
      }
    } catch (e) {
      console.error('[shopify-token] exchange threw:', { storeId, message: e.message });
      return null;
    }

    const expiresAt = payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS).toISOString()
      : null;

    const { error } = await db()
      .from('stores')
      .update({ admin_token: payload.access_token, admin_token_expires_at: expiresAt })
      .eq('id', storeId);
    if (error) {
      // The token is valid but unsaved: this request can still use it, the next one re-mints.
      console.error('[shopify-token] minted but could not persist:', { storeId, message: error.message });
    }

    return payload.access_token;
  })().finally(() => inFlight.delete(storeId));

  inFlight.set(storeId, run);
  return run;
}

export { API_VERSION };

/**
 * A `fetch` that carries a store's Admin token and survives that token expiring.
 *
 * For the code paths that talk to Shopify with raw `fetch` instead of going through
 * `createShopifyClient` (sync, the creative image push, the shop-aggregate metafield write).
 * Retries a 401 exactly once, after a refresh, and remembers the new token for the rest of
 * the run so one expiry costs one exchange rather than one per request.
 *
 * @param {string|null} storeId — null disables recovery (nothing to refresh from)
 * @param {string} token — the store's current admin_token
 */
export function makeAdminFetch(storeId, token) {
  let current = token;
  return async function adminFetch(url, init = {}) {
    const withToken = (t) => ({
      ...init,
      headers: { ...(init.headers || {}), 'X-Shopify-Access-Token': t },
    });
    let resp = await fetch(url, withToken(current));
    if (resp.status === 401 && storeId) {
      const fresh = await refreshAdminToken(storeId);
      if (fresh) {
        current = fresh;
        resp = await fetch(url, withToken(current));
      }
    }
    return resp;
  };
}

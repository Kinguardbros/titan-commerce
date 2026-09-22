/**
 * Turn a failed Shopify client call into an error payload that says WHY.
 *
 * Every write went through `if (!result) return res.status(500).json({ error: 'Failed to
 * save X to Shopify' })`, so an expired store token, a rejected value and a deleted product
 * were indistinguishable in the UI. Dan hit the 401 case on a size chart and the toast could
 * only say "Failed to save metafield to Shopify" — see lib/shopify-token.js for the rest.
 *
 * Shopify's own body is NOT forwarded to the client: it echoes request detail and there is no
 * reason to widen what the dashboard leaks. It is already in the server log via rest().
 *
 * @param {{getLastError: () => ({status: number, body: string}|null)}} client
 * @param {string} fallback — the action-specific message, used when nothing better is known
 */
export function shopifyFailure(client, fallback) {
  const err = client?.getLastError?.() || null;

  if (err?.status === 401) {
    // The client already tried to refresh and retry before giving up, so reaching here means
    // the store genuinely cannot authenticate right now.
    return {
      error: 'Shopify rejected this store\'s access token',
      hint: 'The token is expired or revoked and could not be renewed. Reconnect the store\'s Shopify app.',
    };
  }
  if (err?.status === 404) {
    return { error: fallback, hint: 'Shopify does not have this product — it may have been deleted there. Run a sync.' };
  }
  if (err?.status === 422) {
    return { error: fallback, hint: 'Shopify rejected the value as invalid. Check the field length and format.' };
  }
  if (err?.status === 429) {
    return { error: fallback, hint: 'Shopify is rate-limiting this store. Try again shortly.' };
  }
  return err?.status
    ? { error: fallback, hint: `Shopify returned HTTP ${err.status}.` }
    : { error: fallback };
}

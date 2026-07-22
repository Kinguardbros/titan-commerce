// Shopify Publications API helpers — see docs/superpowers/plans/2026-07-23-publications-manager.md
// One-shot lookup: cache the returned GID in stores.online_store_publication_id.

const PUBLICATIONS_QUERY = `{
  publications(first: 20) {
    edges {
      node { id name }
    }
  }
}`;

/**
 * Return the GraphQL global ID of the "Online Store" publication for this shop.
 * @param {{graphql: (q: string, v?: object) => Promise<object|null>}} client — createShopifyClient()
 * @returns {Promise<string|null>} GID (e.g. "gid://shopify/Publication/12345") or null when missing
 */
export async function getOnlineStorePublicationId(client) {
  if (!client?.graphql) return null;
  const resp = await client.graphql(PUBLICATIONS_QUERY);
  if (!resp || resp.errors) {
    console.error('[publications] Failed to load publications list', { errors: resp?.errors });
    return null;
  }
  const edges = resp.data?.publications?.edges || [];
  const online = edges.find((e) => e.node?.name === 'Online Store');
  return online?.node?.id || null;
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

describe('createShopifyClient — graphql()', () => {
  let createShopifyClient;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    globalThis.fetch = fetchMock;
    fetchMock.mockReset();
    const mod = await import('../lib/shopify-admin.js');
    createShopifyClient = mod.createShopifyClient;
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  it('POSTs GraphQL query with correct headers and returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { publications: { edges: [] } } }),
    });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    const result = await client.graphql('{ publications(first: 1) { edges { node { id } } } }');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shop.myshopify.com/admin/api/2024-01/graphql.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Shopify-Access-Token': 'tok_123',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain('publications');
    expect(body.variables).toEqual({});
    expect(result).toEqual({ data: { publications: { edges: [] } } });
  });

  it('passes variables through', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    await client.graphql('mutation X($id: ID!) { x(id: $id) { id } }', { id: 'gid://x/1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: 'gid://x/1' });
  });

  it('returns null when token is missing', async () => {
    const client = createShopifyClient('shop.myshopify.com', null);
    const result = await client.graphql('{ __typename }');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when fetch response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    await expect(client.graphql('{ __typename }')).rejects.toThrow(/500/);
  });
});

describe('getOnlineStorePublicationId', () => {
  let getOnlineStorePublicationId;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/shopify-publications.js');
    getOnlineStorePublicationId = mod.getOnlineStorePublicationId;
  });

  it('returns the GID of the publication named "Online Store"', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({
        data: {
          publications: {
            edges: [
              { node: { id: 'gid://shopify/Publication/1', name: 'Point of Sale' } },
              { node: { id: 'gid://shopify/Publication/2', name: 'Online Store' } },
              { node: { id: 'gid://shopify/Publication/3', name: 'Shop' } },
            ],
          },
        },
      }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBe('gid://shopify/Publication/2');
    expect(client.graphql).toHaveBeenCalledWith(expect.stringContaining('publications(first:'));
  });

  it('returns null when there is no Online Store publication', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({
        data: { publications: { edges: [{ node: { id: 'gid://x/1', name: 'POS' } }] } },
      }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBeNull();
  });

  it('returns null when GraphQL returns errors', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({ errors: [{ message: 'nope' }] }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBeNull();
  });
});

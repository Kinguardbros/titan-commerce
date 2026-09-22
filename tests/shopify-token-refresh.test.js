import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Clara Atelier's Shopify app issues client_credentials tokens that expire after 24h, and
// nothing refreshed them — so ~24h after someone last pasted a token by hand, EVERY Shopify
// write on that store started failing: size charts, the product editor, optimizer pushes,
// publications, sync, review pushes. All of it surfaced as the same generic message, because
// rest() threw away Shopify's status and body and returned null.
//
// The refresh has to be REACTIVE (only after a 401), never proactive on a schedule. Isola also
// has client_id/client_secret stored but its token currently works; minting there would replace
// a working long-lived token with a 24h one and make Isola depend on the refresh path too.
//
// `stores` rows in these tests:
//   s-clara    — client_id + client_secret, token expired  -> refreshable
//   s-eleganz  — no OAuth credentials at all               -> NOT refreshable, must not call out

const state = { stores: {}, updates: [] };

function resetStores() {
  state.stores = {
    's-clara': {
      id: 's-clara', shopify_url: 'clara.myshopify.com',
      admin_token: 'expired-token', client_id: 'cid', client_secret: 'csecret',
    },
    's-eleganz': {
      id: 's-eleganz', shopify_url: 'eleganz.myshopify.com',
      admin_token: 'working-token', client_id: null, client_secret: null,
    },
  };
  state.updates = [];
}

const fromMock = vi.fn((table) => {
  if (table === 'stores') {
    return {
      select: () => ({ eq: (_c, id) => ({ single: async () => ({ data: state.stores[id] || null, error: null }) }) }),
      update: (row) => ({
        eq: async (_c, id) => {
          state.updates.push({ id, row });
          Object.assign(state.stores[id], row);
          return { error: null };
        },
      }),
    };
  }
  return { select: () => ({ eq: () => ({}) }) };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fromMock }) }));

const OAUTH = 'https://clara.myshopify.com/admin/oauth/access_token';

// Minimal Response stand-in — only the surface rest()/graphql()/refresh use.
const reply = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let fetchMock;

beforeEach(() => {
  resetStores();
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshAdminToken', () => {
  it('exchanges client_credentials and persists the token plus its expiry', async () => {
    const { refreshAdminToken } = await import('../lib/shopify-token.js');
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'fresh-token', expires_in: 86399 }));

    const token = await refreshAdminToken('s-clara');

    expect(token).toBe('fresh-token');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(OAUTH);
    expect(JSON.parse(opts.body)).toMatchObject({
      client_id: 'cid', client_secret: 'csecret', grant_type: 'client_credentials',
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].row.admin_token).toBe('fresh-token');
    // Expiry is persisted so a later change can refresh before the token dies rather than
    // after a user already hit a failure.
    const expiry = new Date(state.updates[0].row.admin_token_expires_at).getTime();
    expect(expiry).toBeGreaterThan(Date.now());
  });

  it('returns null and calls nothing for a store with no OAuth credentials', async () => {
    const { refreshAdminToken } = await import('../lib/shopify-token.js');

    expect(await refreshAdminToken('s-eleganz')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it('returns null when Shopify rejects the exchange, leaving the stored token alone', async () => {
    const { refreshAdminToken } = await import('../lib/shopify-token.js');
    fetchMock.mockResolvedValueOnce(reply(400, { error: 'invalid_client' }));

    expect(await refreshAdminToken('s-clara')).toBeNull();
    expect(state.updates).toHaveLength(0);
    expect(state.stores['s-clara'].admin_token).toBe('expired-token');
  });

  it('collapses concurrent refreshes for one store into a single exchange', async () => {
    const { refreshAdminToken } = await import('../lib/shopify-token.js');
    fetchMock.mockResolvedValue(reply(200, { access_token: 'fresh-token', expires_in: 86399 }));

    // Every in-flight Shopify call on a store hits 401 at the same moment, so without
    // single-flight one expiry produces a burst of identical exchanges.
    const all = await Promise.all([1, 2, 3].map(() => refreshAdminToken('s-clara')));

    expect(all).toEqual(['fresh-token', 'fresh-token', 'fresh-token']);
    expect(fetchMock.mock.calls.filter(([u]) => u === OAUTH)).toHaveLength(1);
  });
});

describe('createShopifyClient — 401 recovery', () => {
  // The exact flow Dan hit: Save on a size chart. updateMetafield looks the metafield up
  // first, so the expired token bites on that GET before the write is ever attempted.
  it('refreshes once and retries the request with the new token', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock
      .mockResolvedValueOnce(reply(401, { errors: '[API] Invalid API key or access token' }))
      .mockResolvedValueOnce(reply(200, { access_token: 'fresh-token', expires_in: 86399 }))
      .mockResolvedValueOnce(reply(200, { metafields: [] }))
      .mockResolvedValueOnce(reply(200, { metafield: { id: 7 } }));

    const client = createShopifyClient('clara.myshopify.com', 'expired-token', { storeId: 's-clara' });
    const result = await client.updateMetafield(123, 'custom', 'size_chart_text', 'S,M,L');

    expect(result).toEqual({ metafield: { id: 7 } });
    // Both the retried lookup and the write that follows it use the refreshed token — the
    // new token has to stick on the client, not just be used for the one retried call.
    for (const call of fetchMock.mock.calls.slice(2)) {
      expect(call[1].headers['X-Shopify-Access-Token']).toBe('fresh-token');
    }
  });

  it('does not retry a non-401 failure', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock.mockResolvedValueOnce(reply(422, { errors: { type: 'is invalid' } }));

    const client = createShopifyClient('clara.myshopify.com', 'tok', { storeId: 's-clara' });

    expect(await client.updateProductStatus(1, 'active')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after one refresh instead of looping on a still-401 store', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock
      .mockResolvedValueOnce(reply(401, {}))
      .mockResolvedValueOnce(reply(200, { access_token: 'fresh-token', expires_in: 86399 }))
      .mockResolvedValueOnce(reply(401, {}));

    const client = createShopifyClient('clara.myshopify.com', 'expired-token', { storeId: 's-clara' });

    expect(await client.updateProductStatus(1, 'active')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('leaves a 401 alone when no storeId was supplied (nothing to refresh from)', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock.mockResolvedValueOnce(reply(401, {}));

    const client = createShopifyClient('clara.myshopify.com', 'expired-token');

    expect(await client.updateProductStatus(1, 'active')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createShopifyClient — error reporting', () => {
  it('exposes the status and body so callers can say WHY, not just that it failed', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock
      .mockResolvedValueOnce(reply(200, { metafields: [] }))
      .mockResolvedValueOnce(reply(422, { errors: { value: 'is too long' } }));

    const client = createShopifyClient('clara.myshopify.com', 'tok');
    await client.updateMetafield(1, 'custom', 'size_chart_text', 'x');

    const err = client.getLastError();
    expect(err.status).toBe(422);
    expect(err.body).toContain('is too long');
  });

  it('reports an expired token as an auth failure after the refresh could not save it', async () => {
    const { createShopifyClient } = await import('../lib/shopify-admin.js');
    fetchMock
      .mockResolvedValueOnce(reply(401, { errors: '[API] Invalid API key or access token' }))
      .mockResolvedValueOnce(reply(400, { error: 'invalid_client' }));

    const client = createShopifyClient('clara.myshopify.com', 'expired-token', { storeId: 's-clara' });
    await client.updateProductStatus(1, 'active');

    expect(client.getLastError().status).toBe(401);
  });
});

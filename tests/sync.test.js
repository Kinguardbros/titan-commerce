import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-4 (Docs/AUDIT-2026-08.md): per-product sync failures (e.g. a handle collision
// with another store, now possible since shopify_id/handle became composite-unique
// per store) used to only console.error — invisible to Dan. This suite verifies the
// failure now lands in pipeline_log (level=warn, agent=SCRAPER) instead of being
// silently swallowed, and that a pipeline_log write failure itself can't crash the
// sync request (the "catch(e){}" forbidden rule — both layers must log or re-throw).

const state = { pipelineLogs: [] };

const pipelineLogInsertMock = vi.fn(async (row) => {
  state.pipelineLogs.push(row);
  return { error: null };
});

const fromMock = vi.fn((table) => {
  if (table === 'stores') {
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({
            // client_id/client_secret present = this store CAN be refreshed, which is what
            // the expired-token cases below exercise through the real lib/shopify-token.js.
            data: {
              id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok123',
              client_id: 'cid', client_secret: 'csecret',
            },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
  }
  if (table === 'pipeline_log') {
    return { insert: pipelineLogInsertMock };
  }
  if (table === 'products') {
    return {
      select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
  }
  return { select: () => ({ eq: () => ({}) }) };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}));

const upsertProductFromShopifyMock = vi.fn();
vi.mock('../lib/product-upsert.js', () => ({
  upsertProductFromShopify: upsertProductFromShopifyMock,
}));

function mockReqRes(body) {
  const req = { body, user: { role: 'admin' } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

function stubShopifyFetch() {
  // Products are paged via the Link header (sync.js::fetchAllAdminPages), so every
  // stubbed response carries one — an empty header means "this was the last page".
  const noNextPage = { get: () => null };
  const fetchMock = vi.fn(async (url) => {
    if (url.includes('custom_collections.json')) return { headers: noNextPage, json: async () => ({ custom_collections: [] }) };
    if (url.includes('smart_collections.json')) return { headers: noNextPage, json: async () => ({ smart_collections: [] }) };
    if (url.includes('products.json')) {
      return {
        headers: noNextPage,
        json: async () => ({
          products: [
            {
              id: 999, handle: 'black-dress', title: 'Black Dress',
              variants: [{ price: '49.00' }], images: [], body_html: '',
            },
          ],
        }),
      };
    }
    return { headers: noNextPage, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sync_products — per-product failure logging (P0-4, AUDIT-2026-08)', () => {
  let sync_products;

  beforeEach(async () => {
    vi.resetModules();
    state.pipelineLogs = [];
    pipelineLogInsertMock.mockClear();
    upsertProductFromShopifyMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    stubShopifyFetch();
    const mod = await import('../lib/actions/sync.js');
    sync_products = mod.sync_products;
  });

  it('writes a pipeline_log warn entry (agent=SCRAPER) when a product upsert fails, instead of only console.error', async () => {
    upsertProductFromShopifyMock.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "products_handle_key"')
    );
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { req, res } = mockReqRes({ store_id: 's1' });
    await sync_products(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    const failureLog = state.pipelineLogs.find((l) => l.level === 'warn');
    expect(failureLog).toBeTruthy();
    expect(failureLog.agent).toBe('SCRAPER');
    expect(failureLog.store_id).toBe('s1');
    expect(failureLog.metadata).toMatchObject({ handle: 'black-dress', shopify_id: 999 });
    expect(failureLog.message).toContain('black-dress');
    expect(consoleErrSpy).toHaveBeenCalled();

    consoleErrSpy.mockRestore();
  });

  it('does not write a warn pipeline_log entry when upsert succeeds (only the info-level sync summary)', async () => {
    upsertProductFromShopifyMock.mockResolvedValue({ shopify_id: 999, handle: 'black-dress' });

    const { req, res } = mockReqRes({ store_id: 's1' });
    await sync_products(req, res);

    const warnLogs = state.pipelineLogs.filter((l) => l.level === 'warn');
    expect(warnLogs).toHaveLength(0);
    const infoLog = state.pipelineLogs.find((l) => l.level === 'info');
    expect(infoLog).toBeTruthy();
    expect(infoLog.agent).toBe('SCRAPER');
  });

  it('a pipeline_log write failure inside the catch handler does not crash the sync request (nested try/catch, no bare catch(e){})', async () => {
    upsertProductFromShopifyMock.mockRejectedValue(new Error('boom'));
    pipelineLogInsertMock.mockRejectedValueOnce(new Error('network blip'));
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { req, res } = mockReqRes({ store_id: 's1' });
    await expect(sync_products(req, res)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(200);
    // Both the upsert failure AND the pipeline_log failure got logged — neither
    // was swallowed by a bare catch(e){}.
    expect(consoleErrSpy.mock.calls.some((c) => String(c[0]).includes('Failed to upsert'))).toBe(true);
    expect(consoleErrSpy.mock.calls.some((c) => String(c[0]).includes('Failed to write pipeline_log'))).toBe(true);

    consoleErrSpy.mockRestore();
  });
});

// Sync does not go through createShopifyClient — it drives Shopify with its own fetch
// helpers, so it needs its own 401 recovery (lib/actions/sync.js::makeAdminFetch). Without
// it, a store on a short-lived token syncs fine one day and silently archives its entire
// catalog the next, because every product page comes back 401 and the product list is empty.
describe('sync_products — expired admin token recovery', () => {
  let sync_products;

  beforeEach(async () => {
    vi.resetModules();
    state.pipelineLogs = [];
    pipelineLogInsertMock.mockClear();
    upsertProductFromShopifyMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/sync.js');
    sync_products = mod.sync_products;
  });

  const noNextPage = { get: () => null };

  it('refreshes the token on a 401 and completes the sync with the new one', async () => {
    const seen = [];
    const fetchMock = vi.fn(async (url, init) => {
      const token = init?.headers?.['X-Shopify-Access-Token'];
      seen.push({ url, token });
      if (url.includes('/admin/oauth/access_token')) {
        return { ok: true, status: 200, headers: noNextPage, json: async () => ({ access_token: 'fresh-token', expires_in: 86399 }) };
      }
      if (token === 'tok123') return { ok: false, status: 401, headers: noNextPage, json: async () => ({}) };
      if (url.includes('products.json')) {
        return {
          ok: true, status: 200, headers: noNextPage,
          json: async () => ({ products: [{ id: 999, handle: 'black-dress', title: 'Black Dress', variants: [{ price: '49.00' }], images: [], body_html: '' }] }),
        };
      }
      return { ok: true, status: 200, headers: noNextPage, json: async () => ({ custom_collections: [], smart_collections: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = mockReqRes({ store_id: 's1' });
    await sync_products(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(seen.some((c) => c.url.includes('/admin/oauth/access_token'))).toBe(true);
    // The product actually landed — a sync that 401s its way to an empty list would
    // otherwise look like a success that archives the whole catalog.
    expect(upsertProductFromShopifyMock).toHaveBeenCalled();
    expect(seen.some((c) => c.token === 'fresh-token')).toBe(true);
  });

  it('one expiry costs one exchange, not one per request', async () => {
    let exchanges = 0;
    const fetchMock = vi.fn(async (url, init) => {
      const token = init?.headers?.['X-Shopify-Access-Token'];
      if (url.includes('/admin/oauth/access_token')) {
        exchanges++;
        return { ok: true, status: 200, headers: noNextPage, json: async () => ({ access_token: 'fresh-token', expires_in: 86399 }) };
      }
      if (token === 'tok123') return { ok: false, status: 401, headers: noNextPage, json: async () => ({}) };
      if (url.includes('products.json')) return { ok: true, status: 200, headers: noNextPage, json: async () => ({ products: [] }) };
      return { ok: true, status: 200, headers: noNextPage, json: async () => ({ custom_collections: [], smart_collections: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { req, res } = mockReqRes({ store_id: 's1' });
    await sync_products(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Two collection calls fire concurrently via Promise.all and both 401 — single-flight
    // in refreshAdminToken has to collapse them, and the refreshed token is then reused by
    // the products call rather than triggering a third exchange.
    expect(exchanges).toBe(1);
  });

  it('does not retry forever when the store cannot be refreshed', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/admin/oauth/access_token')) {
        return { ok: false, status: 400, headers: noNextPage, json: async () => ({ error: 'invalid_client' }) };
      }
      return { ok: false, status: 401, headers: noNextPage, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { req, res } = mockReqRes({ store_id: 's1' });
    await expect(sync_products(req, res)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(200);
    // 3 Shopify calls (2 collections + products), each attempted once, plus the exchanges
    // they triggered. What matters is that it terminates rather than looping on 401.
    expect(fetchMock.mock.calls.length).toBeLessThan(10);

    consoleErrSpy.mockRestore();
  });
});

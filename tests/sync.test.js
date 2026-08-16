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
            data: { id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok123' },
            error: null,
          }),
        }),
      }),
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
  const fetchMock = vi.fn(async (url) => {
    if (url.includes('custom_collections.json')) return { json: async () => ({ custom_collections: [] }) };
    if (url.includes('smart_collections.json')) return { json: async () => ({ smart_collections: [] }) };
    if (url.includes('products.json')) {
      return {
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
    return { json: async () => ({}) };
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

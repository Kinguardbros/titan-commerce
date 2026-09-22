import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the transport boundary is mocked (Supabase REST + the Shopify client's graphql()
// call + rate-limit + store lookup) — lib/size-chart-shopify.js and
// lib/size-chart-validate.js run for real, so these tests exercise the actual query
// shapes, batching, and validation rules, not a restatement of them.

const state = {
  productsSelect: { data: [], error: null },
  // Separate from productsSelect: an UPDATE on 'products' resolves through this instead, so
  // a test can simulate a cache-update failure (Supabase resolves { error }, never throws)
  // without disturbing the SELECT-based product lookups the actions also run.
  productsUpdate: { error: null },
  updates: [], inserts: [],
};

function makeChain(table) {
  const chain = {};
  let isUpdate = false;
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.update = vi.fn((patch) => { isUpdate = true; state.updates.push({ table, patch }); return chain; });
  chain.insert = vi.fn(async (row) => { state.inserts.push({ table, row }); return { error: null }; });
  // Makes `await supabase.from(x).select(...).eq(...).in(...)` resolve without a terminal
  // call — mirrors how the real supabase-js query builder is itself thenable.
  chain.then = (resolve) => resolve(
    table !== 'products' ? { data: [], error: null } : (isUpdate ? state.productsUpdate : state.productsSelect),
  );
  return chain;
}

const supabaseFromMock = vi.fn((table) => makeChain(table));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const graphqlMock = vi.fn();
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({ graphql: graphqlMock }),
}));

const ADMIN = { role: 'admin', permissions: [], store_access: [], user_id: 'u1' };
const READ_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };
const EDITOR = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-1'] };
const EDITOR_OTHER_STORE = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-2'] };

const STORE = { id: 'store-1', shopify_url: 'shop.myshopify.com', admin_token: 'tok' };

function mockReqRes({ body = {}, query = {}, user = ADMIN } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

function metaobjectsResponse(nodes = []) {
  return { data: { metaobjects: { nodes } } };
}
function productsPageResponse(nodes = [], hasNextPage = false) {
  return { data: { products: { pageInfo: { hasNextPage, endCursor: null }, nodes } } };
}
function productNode({ id, title = 'P', handle = 'p', options = [], chartGid = null, legacyText = null }) {
  return {
    id, title, handle, options,
    chart: chartGid ? { value: chartGid } : null,
    legacyText: legacyText ? { value: legacyText } : null,
  };
}

let mod;

beforeEach(async () => {
  vi.resetModules();
  state.productsSelect = { data: [], error: null };
  state.productsUpdate = { error: null };
  state.updates = [];
  state.inserts = [];
  getStoreMock.mockReset().mockResolvedValue(STORE);
  rateLimitMock.mockReset().mockResolvedValue(true);
  graphqlMock.mockReset();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  mod = await import('../lib/actions/size-chart.js');
});

describe('permission gating', () => {
  it('size_charts_list: 403 without products:read', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1' }, user: { role: 'member', permissions: [], store_access: ['store-1'] } });
    await mod.size_charts_list(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('size_charts_list: 403 without store access', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1' }, user: EDITOR_OTHER_STORE });
    await mod.size_charts_list(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('create_size_chart: 403 for a read-only user', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', name: 'N', columns: ['A'], rows: [['1']] }, user: READ_ONLY });
    await mod.create_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it('assign_size_chart_products: 403 for a user without products:edit', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', chart_id: 'gid://x/1', product_ids: ['p1'] }, user: READ_ONLY });
    await mod.assign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('size_charts_list', () => {
  it('reports product_count per chart and legacy_text_count, without leaking the metaobject list into a second call per chart', async () => {
    graphqlMock
      .mockResolvedValueOnce(metaobjectsResponse([
        { id: 'gid://x/1', handle: 'a', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Chart A' }, { key: 'columns', value: '["Größe"]' }, { key: 'rows', value: '[["S"]]' }] },
        { id: 'gid://x/2', handle: 'b', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Chart B' }, { key: 'columns', value: '["Größe"]' }, { key: 'rows', value: '[["S"]]' }] },
      ]))
      .mockResolvedValueOnce(productsPageResponse([
        productNode({ id: 'gid://shopify/Product/1', chartGid: 'gid://x/1' }),
        productNode({ id: 'gid://shopify/Product/2', chartGid: 'gid://x/1' }),
        productNode({ id: 'gid://shopify/Product/3', chartGid: null, legacyText: 'old text' }),
      ]));
    const { req, res } = mockReqRes({ query: { store_id: 'store-1' } });
    await mod.size_charts_list(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    const a = body.charts.find((c) => c.handle === 'a');
    const b = body.charts.find((c) => c.handle === 'b');
    expect(a.product_count).toBe(2);
    expect(b.product_count).toBe(0);
    expect(body.legacy_text_count).toBe(1);
  });

  it('400 when the store has no admin token', async () => {
    getStoreMock.mockResolvedValue({ id: 'store-1', shopify_url: 'x', admin_token: null });
    const { req, res } = mockReqRes({ query: { store_id: 'store-1' } });
    await mod.size_charts_list(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('create_size_chart', () => {
  it('blocks on a shape error before calling Shopify at all', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', name: 'N', columns: ['A', 'B'], rows: [['1']] } });
    await mod.create_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it('disambiguates a handle collision and upserts with capabilities ACTIVE', async () => {
    graphqlMock
      .mockResolvedValueOnce(metaobjectsResponse([{ id: 'gid://x/1', handle: 'damen-hosen', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [] }]))
      .mockResolvedValueOnce({ data: { metaobjectUpsert: { metaobject: { id: 'gid://x/2', handle: 'damen-hosen-2', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Damen Hosen' }, { key: 'columns', value: '["Größe"]' }, { key: 'rows', value: '[["S"]]' }] }, userErrors: [] } } });
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', name: 'Damen Hosen', columns: ['Größe'], rows: [['S']] } });
    await mod.create_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [, upsertVars] = graphqlMock.mock.calls[1];
    expect(upsertVars.handle).toEqual({ type: 'size_chart', handle: 'damen-hosen-2' });
    expect(state.inserts.some((i) => i.table === 'pipeline_log' && i.row.agent === 'SIZE_CHART')).toBe(true);
  });

  it('surfaces a rejected upsert as a 400 with Shopify userErrors, still logs nothing', async () => {
    graphqlMock
      .mockResolvedValueOnce(metaobjectsResponse([]))
      .mockResolvedValueOnce({ data: { metaobjectUpsert: { metaobject: null, userErrors: [{ message: 'Handle already exists' }] } } });
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', name: 'N', columns: ['A'], rows: [['1']] } });
    await mod.create_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state.inserts.some((i) => i.table === 'pipeline_log')).toBe(false);
  });
});

describe('assign_size_chart_products / unassign_size_chart_products', () => {
  it('assign: batches metafieldsSet at 25 and caches has_size_chart=true + chart id/name on the DB rows', async () => {
    state.productsSelect = { data: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, shopify_id: String(1000 + i) })), error: null };
    graphqlMock
      .mockResolvedValueOnce({ data: { metafieldsSet: { metafields: Array.from({ length: 25 }, () => ({ id: 'm' })) } } })
      .mockResolvedValueOnce({ data: { metafieldsSet: { metafields: Array.from({ length: 5 }, () => ({ id: 'm' })) } } })
      .mockResolvedValueOnce({ data: { metaobject: { id: 'gid://x/1', handle: 'a', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Chart A' }, { key: 'columns', value: '[]' }, { key: 'rows', value: '[]' }] } } });
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', chart_id: 'gid://x/1', product_ids: Array.from({ length: 30 }, (_, i) => `p${i}`) } });
    await mod.assign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].updated).toBe(30);
    const cacheUpdate = state.updates.find((u) => u.table === 'products' && u.patch.has_size_chart === true);
    expect(cacheUpdate.patch).toEqual({ has_size_chart: true, size_chart_id: 'gid://x/1', size_chart_name: 'Chart A' });
  });

  it('assign: 400 when the rate limit is exceeded', async () => {
    state.productsSelect = { data: [{ id: 'p1', shopify_id: '1' }], error: null };
    rateLimitMock.mockResolvedValue(false);
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', chart_id: 'gid://x/1', product_ids: ['p1'] } });
    await mod.assign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it('unassign: clears the cached chart columns to null/false', async () => {
    state.productsSelect = { data: [{ id: 'p1', shopify_id: '1' }], error: null };
    graphqlMock.mockResolvedValueOnce({ data: { metafieldsDelete: { deletedMetafields: [{ key: 'size_chart' }] } } });
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_ids: ['p1'] } });
    await mod.unassign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const cacheUpdate = state.updates.find((u) => u.table === 'products' && u.patch.has_size_chart === false);
    expect(cacheUpdate.patch).toEqual({ has_size_chart: false, size_chart_id: null, size_chart_name: null });
  });

  // Regression: Supabase-js resolves { data: null, error } on a query failure rather than
  // throwing, so a bare try/catch around the cache-update call never sees it — this caught
  // a real bug where a genuine failure (e.g. the size_chart_id/size_chart_name migration not
  // yet applied) was silently swallowed on a live store during verification.
  it('assign: a cache-update failure (Supabase resolves { error }, does not throw) is logged, response still 200', async () => {
    state.productsSelect = { data: [{ id: 'p1', shopify_id: '1' }], error: null };
    state.productsUpdate = { error: { message: 'column products.size_chart_id does not exist' } };
    graphqlMock
      .mockResolvedValueOnce({ data: { metafieldsSet: { metafields: [{ id: 'm' }] } } })
      .mockResolvedValueOnce({ data: { metaobject: { id: 'gid://x/1', handle: 'a', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Chart A' }] } } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', chart_id: 'gid://x/1', product_ids: ['p1'] } });
    await mod.assign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(200); // Shopify write succeeded; the cache is best-effort
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cache update after assign failed'), expect.objectContaining({ message: expect.stringContaining('does not exist') }));
    errSpy.mockRestore();
  });

  it('unassign: a cache-update failure is logged too, not silently dropped', async () => {
    state.productsSelect = { data: [{ id: 'p1', shopify_id: '1' }], error: null };
    state.productsUpdate = { error: { message: 'column products.size_chart_id does not exist' } };
    graphqlMock.mockResolvedValueOnce({ data: { metafieldsDelete: { deletedMetafields: [{ key: 'size_chart' }] } } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_ids: ['p1'] } });
    await mod.unassign_size_chart_products(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cache update after unassign failed'), expect.anything());
    errSpy.mockRestore();
  });
});

describe('refresh_has_size_chart', () => {
  it('counts legacy_text_count and with_size_chart correctly from a full scan', async () => {
    graphqlMock
      .mockResolvedValueOnce(productsPageResponse([
        productNode({ id: 'gid://shopify/Product/1', chartGid: 'gid://x/1' }),
        productNode({ id: 'gid://shopify/Product/2', chartGid: null, legacyText: 'old' }),
        productNode({ id: 'gid://shopify/Product/3', chartGid: null }),
      ]))
      .mockResolvedValueOnce(metaobjectsResponse([{ id: 'gid://x/1', handle: 'a', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [{ key: 'name', value: 'Chart A' }] }]));
    const { req, res } = mockReqRes({ body: { store_id: 'store-1' } });
    await mod.refresh_has_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ total: 3, with_size_chart: 1, legacy_text_count: 1, cache_update_failures: 0 });
  });

  it('counts and logs (once) cache-update failures instead of silently dropping them', async () => {
    state.productsUpdate = { error: { message: 'column products.size_chart_id does not exist' } };
    graphqlMock
      .mockResolvedValueOnce(productsPageResponse([
        productNode({ id: 'gid://shopify/Product/1', chartGid: null }),
        productNode({ id: 'gid://shopify/Product/2', chartGid: null }),
      ]))
      .mockResolvedValueOnce(metaobjectsResponse([]));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { req, res } = mockReqRes({ body: { store_id: 'store-1' } });
    await mod.refresh_has_size_chart(req, res);
    expect(res.json.mock.calls[0][0].cache_update_failures).toBe(2);
    expect(errSpy).toHaveBeenCalledTimes(1); // logged once, not once per product
    errSpy.mockRestore();
  });
});

describe('validate_size_chart', () => {
  it('returns errors/warnings without touching Shopify when chart_id is omitted', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', columns: ['A', 'B'], rows: [['1']] } });
    await mod.validate_size_chart(req, res);
    expect(graphqlMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].valid).toBe(false);
  });

  it('checks label warnings against the chart_id\'s currently-assigned products when given', async () => {
    graphqlMock.mockResolvedValueOnce(productsPageResponse([
      productNode({ id: 'gid://shopify/Product/1', chartGid: 'gid://x/1', options: [{ name: 'Größe', values: ['S', 'XL'] }] }),
    ]));
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', chart_id: 'gid://x/1', columns: ['Größe'], rows: [['S']] } });
    await mod.validate_size_chart(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.valid).toBe(true);
    expect(body.warnings).toEqual([expect.stringContaining('missing from the chart: XL')]);
  });
});

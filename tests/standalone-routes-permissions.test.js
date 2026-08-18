import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P0-1 (Docs/AUDIT-2026-08.md): the 7 standalone Vercel routes below predate
// the RBAC system and were wrapped only in withAuth() (session check) — no
// hasPermission()/hasStoreAccess() call anywhere. This file proves each one
// now gates correctly: missing permission -> 403, wrong store_access -> 403,
// admin/permitted-member -> past the gate (not 403).
//
// `withAuth` is mocked to identity (same technique as tests/system-routing.js)
// so `req.user` is set directly by the test instead of going through a real
// session token — the object under test is the raw handler, matching how
// api/system.js's routing tests already work.
//
// Business-logic mocks are intentionally shallow: for routes with heavy
// external API surface (fal.ai/Higgsfield generation, video polling), the
// "passes the gate" assertion is `not.toHaveBeenCalledWith(403)` rather than
// a strict 200 — the same convention already used in
// tests/products-permissions.test.js ("200s for admin" tests) and
// tests/wave2-permissions.test.js. What's under test is the RBAC gate, not
// the downstream generation pipeline.
// ---------------------------------------------------------------------------

// ---- Generic configurable Supabase mock --------------------------------
// tableData[table] = { single: () => ({data, error}), list: () => ({data, error, count}),
//                      insert: (row) => ({data, error}) }
// Chain methods (select/eq/order/...) all return the same builder so any call
// sequence used by the route files works. The builder itself is thenable so
// `await supabase.from(x)...` (no `.single()`) resolves via `.list`.
let tableData = {};

function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    or: vi.fn(() => builder),
    not: vi.fn(() => builder),
    is: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: null, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single() : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list() : { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

const storageRemoveMock = vi.fn().mockResolvedValue({});
const storageUploadMock = vi.fn().mockResolvedValue({});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => makeBuilder(table),
    storage: {
      from: () => ({
        upload: storageUploadMock,
        remove: storageRemoveMock,
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage.test/x.png' } }),
      }),
    },
  }),
}));

vi.mock('../lib/auth.js', () => ({ withAuth: (handler) => handler }));
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }));

const getStoreMock = vi.fn().mockResolvedValue({ id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com', name: 'Test Store' });
vi.mock('../lib/store-context.js', () => ({ getStore: (...args) => getStoreMock(...args) }));

vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({
    getRevenueSummary: vi.fn().mockResolvedValue({}),
    getRevenueDelta: vi.fn().mockResolvedValue({}),
    getDailyRevenue: vi.fn().mockResolvedValue([]),
    getTrafficSources: vi.fn().mockResolvedValue([]),
    getTopProductsWithCreatives: vi.fn().mockResolvedValue([]),
    getRecentOrders: vi.fn().mockResolvedValue([]),
    getTopCustomers: vi.fn().mockResolvedValue([]),
    getPaymentFulfillmentStatus: vi.fn().mockResolvedValue(null),
    getCollectionCount: vi.fn().mockResolvedValue(0),
    getCustomerCount: vi.fn().mockResolvedValue(0),
    getProductCount: vi.fn().mockResolvedValue(0),
  }),
  getRevenueSummary: vi.fn().mockResolvedValue({}),
  getRevenueDelta: vi.fn().mockResolvedValue({}),
  getDailyRevenue: vi.fn().mockResolvedValue([]),
  getTrafficSources: vi.fn().mockResolvedValue([]),
  getTopProductsWithCreatives: vi.fn().mockResolvedValue([]),
  getRecentOrders: vi.fn().mockResolvedValue([]),
  isConnected: vi.fn().mockReturnValue(false),
}));

vi.mock('../lib/higgsfield.js', () => ({
  buildStyledPrompt: vi.fn().mockResolvedValue('prompt'),
  buildPrompt: vi.fn().mockReturnValue('prompt'),
  generateFluxKontext: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png' }),
  generateImage: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png', jobId: 'job1' }),
  generateVideo: vi.fn().mockResolvedValue({ url: 'https://vid.test/x.mp4', jobId: 'job1' }),
}));
vi.mock('../lib/fal.js', () => ({ submitFalJob: vi.fn().mockResolvedValue({ requestId: 'r1' }) }));
vi.mock('../lib/v4-prompt.js', () => ({ V4_PROMPT_BODY: 'v4' }));
vi.mock('../lib/v5-prompt.js', () => ({ V5_PROMPT_BODY: 'v5' }));
vi.mock('../lib/v6-prompt.js', () => ({ V6_PROMPT_BODY: 'v6' }));
vi.mock('../lib/v7-prompt.js', () => ({ V7_PROMPT_BODY: 'v7' }));
vi.mock('../lib/v8-prompt.js', () => ({
  V8_PROMPT_BODY_TEMPLATE: 'v8',
  detectV8ColorClass: vi.fn(() => 'print'),
  buildV8LightingBlock: vi.fn(() => ''),
  buildV8DoNotBlock: vi.fn(() => ''),
}));
vi.mock('../lib/v9-prompt.js', () => ({ V9_PROMPT_BODY: 'v9' }));
vi.mock('../lib/v10-prompt.js', () => ({ V10_PROMPT_BODY: 'v10' }));

// convert-to-video.js's submitVideoJob dynamically imports the raw Higgsfield
// client (separate from lib/higgsfield.js) — mock it so the "past the gate"
// tests don't make a real network call.
vi.mock('@higgsfield/client/v2', () => ({
  higgsfield: { subscribe: vi.fn().mockResolvedValue({ id: 'job1' }) },
}));

// Deterministic, instant fetch for the polling loops (Higgsfield status +
// storage-upload fetches) so tests don't wait on real network/timers.
function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({ status: 'completed', images: [{ url: 'https://img.test/x.png' }], video: { url: 'https://vid.test/x.mp4' } }),
  })));
}

function mockReqRes({ body = {}, query = {}, user, method } = {}) {
  const req = { body, query, headers: {}, user, method };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  storageRemoveMock.mockClear();
  storageUploadMock.mockClear();
  getStoreMock.mockClear().mockResolvedValue({ id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com', name: 'Test Store' });
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  installFetchMock();
});

// =========================================================================
// api/products/list.js — hasPermission('products:read') + hasStoreAccess
// =========================================================================
describe('api/products/list.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.products = { list: () => ({ data: [], error: null, count: 0 }) };
    tableData.creatives = { list: () => ({ data: [], error: null }) };
    const mod = await import('../api/products/list.js');
    handler = mod.default;
  });

  it('400s when store_id is missing', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {}, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('403s + hint for member missing products:read', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('products:read') }));
  });

  it('403s + hint for member with products:read but wrong store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('200s for admin', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200s for member with products:read + matching store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =========================================================================
// api/creatives/list.js — store_id now REQUIRED (was optional) + products:read
// =========================================================================
describe('api/creatives/list.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = { list: () => ({ data: [], error: null }) };
    const mod = await import('../api/creatives/list.js');
    handler = mod.default;
  });

  it('400s when store_id is missing (was previously optional — cross-store leak)', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {}, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('403s + hint for member missing products:read', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('products:read') }));
  });

  it('403s + hint for member with products:read but wrong store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('200s for admin', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200s for member with products:read + matching store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =========================================================================
// api/creatives/generate.js — hasPermission('creatives:generate') + hasStoreAccess
// 930-line file with heavy external AI-provider branching — "passes the gate"
// tests assert `not.toHaveBeenCalledWith(403)` rather than a strict 200 (see
// file header + tests/products-permissions.test.js convention).
// =========================================================================
describe('api/creatives/generate.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.products = { single: () => ({ data: { id: 'p1', title: 'T', images: '[]', store_id: 's1' }, error: null }) };
    tableData.stores = { single: () => ({ data: { shopify_url: 'x.myshopify.com', name: 'Test Store' }, error: null }) };
    const mod = await import('../api/creatives/generate.js');
    handler = mod.default;
  });

  it('403s + hint for member missing creatives:generate', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { product_id: 'p1', store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
  });

  it('403s + hint for member with creatives:generate but wrong store_access', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { product_id: 'p1', store_id: 's1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('403s for member with creatives:generate but no store_id at all', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { product_id: 'p1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes the gate for admin (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { product_id: 'p1', store_id: 's1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('passes the gate for member with creatives:generate + matching store_access (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { product_id: 'p1', store_id: 's1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

// =========================================================================
// api/creatives/regenerate.js — store_id resolved from the creatives row
// =========================================================================
describe('api/creatives/regenerate.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = {
      single: () => ({ data: { id: 'c1', store_id: 's1', format: 'video', variant_index: 0, brief_id: null, product_id: 'p1', metadata: JSON.stringify({ source_image_url: 'https://img.test/src.png' }) }, error: null }),
      insert: () => ({ data: null, error: null }),
    };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../api/creatives/regenerate.js');
    handler = mod.default;
  });

  it('404s when creative_id does not resolve (pre-existing validation, unaffected)', async () => {
    tableData.creatives.single = () => ({ data: null, error: { message: 'not found' } });
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'missing' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('403s + hint for member missing creatives:generate', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
  });

  it('403s + hint for member with creatives:generate but wrong store_access (creative belongs to a different store)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('passes the gate for admin (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('passes the gate for member with creatives:generate + matching store_access (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

// =========================================================================
// api/creatives/convert-to-video.js — store_id resolved from the source creative row
// =========================================================================
describe('api/creatives/convert-to-video.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = {
      single: () => ({ data: { id: 'c1', store_id: 's1', format: 'image', product_id: 'p1', style: 'ad_creative', file_url: 'https://img.test/src.png' }, error: null }),
      insert: () => ({ data: { id: 'c2' }, error: null }),
    };
    tableData.products = { single: () => ({ data: { handle: 'x', title: 'T' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../api/creatives/convert-to-video.js');
    handler = mod.default;
  });

  it('404s when creative_id does not resolve (pre-existing validation, unaffected)', async () => {
    tableData.creatives.single = () => ({ data: null, error: { message: 'not found' } });
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'missing' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('403s + hint for member missing creatives:generate', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
  });

  it('403s + hint for member with creatives:generate but wrong store_access (source creative belongs to a different store)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('passes the gate for admin (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('passes the gate for member with creatives:generate + matching store_access (not 403)', async () => {
    const { req, res } = mockReqRes({ method: 'POST', body: { creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

// =========================================================================
// api/ads/action.js — approve/reject by creative_id, pause by ad_id (joined
// to creatives for store_id, since `ads` has no direct store_id column)
// =========================================================================
describe('api/ads/action.js', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = {
      single: () => ({ data: { id: 'c1', store_id: 's1', status: 'pending', style: 'ad_creative', product_id: 'p1', storage_path: 'creatives/x.png' }, error: null }),
    };
    tableData.ads = {
      single: () => ({ data: { id: 'ad1', status: 'active', creative: { store_id: 's1' } }, error: null }),
    };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../api/ads/action.js');
    handler = mod.default;
  });

  describe('action=approve', () => {
    it('403s + hint for member missing creatives:generate', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'approve', creative_id: 'c1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
    });

    it('403s + hint for member with creatives:generate but wrong store_access', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'approve', creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
    });

    it('200s for admin', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'approve', creative_id: 'c1' }, user: ADMIN });
      await handler(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('200s for member with creatives:generate + matching store_access', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'approve', creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] } });
      await handler(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  describe('action=reject', () => {
    it('403s + hint for member missing creatives:generate', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'reject', creative_id: 'c1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
    });

    it('403s + hint for member with creatives:generate but wrong store_access (rejecting/deleting cross-store by guessed id)', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'reject', creative_id: 'c1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
      // Critical: the store gate must trip BEFORE any delete/storage-cleanup side effect.
      expect(storageRemoveMock).not.toHaveBeenCalled();
    });

    it('passes the gate for admin (not 403)', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'reject', creative_id: 'c1' }, user: ADMIN });
      await handler(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  describe('action=pause', () => {
    it('403s + hint for member missing creatives:generate', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'pause', ad_id: 'ad1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('creatives:generate') }));
    });

    it('403s + hint for member with creatives:generate but wrong store_access (resolved via ads -> creatives join)', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'pause', ad_id: 'ad1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
    });

    it('passes the gate for admin (not 403)', async () => {
      const { req, res } = mockReqRes({ method: 'POST', body: { action: 'pause', ad_id: 'ad1' }, user: ADMIN });
      await handler(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});

// =========================================================================
// api/shopify/overview.js — hasPermission('finance:read') (P0-5) + hasStoreAccess
// =========================================================================
describe('api/shopify/overview.js', () => {
  let handler;
  beforeEach(async () => {
    const mod = await import('../api/shopify/overview.js');
    handler = mod.default;
  });

  it('403s + hint for member missing finance:read', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('finance:read') }));
  });

  it('403s + hint for member with finance:read but wrong store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['finance:read'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('403s for non-admin caller with no store_id (would otherwise fall back to the global default store — cross-store leak)', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: {}, user: { role: 'member', permissions: ['finance:read'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('store_id required') }));
  });

  it('200s for admin', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: ADMIN });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200s for member with finance:read + matching store_access', async () => {
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: { role: 'member', permissions: ['finance:read'], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

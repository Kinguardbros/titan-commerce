import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-23 (Docs/AUDIT-2026-08.md): lib/actions/optimizations.js was only
// lightly covered (indirectly, via tests/rate-limit-per-tenant.test.js's
// per-tenant rate-limit-key check on optimize_product). This file adds the
// RBAC gates + happy-path coverage the audit flagged as missing: permission
// gate, store-access gate, the Claude-API-mocked happy path (pending
// optimization row inserted), and the 30/hr rate limit boundary.
//
// Mocking technique mirrors tests/rate-limit-per-tenant.test.js / tests/
// standalone-routes-permissions.test.js (generic configurable Supabase
// builder + module mocks for the Claude/Shopify surface).
// ---------------------------------------------------------------------------

let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: { id: 'new-id', ...row }, error: null };
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

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table) => makeBuilder(table) }) }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const optimizeProductMock = vi.fn().mockResolvedValue({ title: 'Optimized Title', description: 'Optimized description' });
vi.mock('../lib/claude.js', () => ({ optimizeProduct: (...args) => optimizeProductMock(...args) }));

const updateProductMock = vi.fn().mockResolvedValue({ product: { id: 123 } });
const updateVariantMock = vi.fn().mockResolvedValue({});
const updateProductOptionsMock = vi.fn().mockResolvedValue({});
const getProductVariantsMock = vi.fn().mockResolvedValue(null);
vi.mock('../lib/shopify-admin.js', () => ({
  updateProduct: (...args) => updateProductMock(...args),
  updateVariant: (...args) => updateVariantMock(...args),
  updateProductOptions: (...args) => updateProductOptionsMock(...args),
  getProductVariants: (...args) => getProductVariantsMock(...args),
}));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
const EDITOR_STORE1 = { role: 'member', user_id: 'm1', permissions: ['products:edit'], store_access: ['store-1'] };
const READ_ONLY_STORE1 = { role: 'member', user_id: 'm2', permissions: ['products:read'], store_access: ['store-1'] };
const EDITOR_STORE2 = { role: 'member', user_id: 'm3', permissions: ['products:edit'], store_access: ['store-2'] };

const SAMPLE_PRODUCT = {
  id: 'p1', title: 'Ocean Blue Swimsuit', description: 'A swimsuit', price: '49.00',
  product_type: 'Swimwear', tags: '["blue","summer"]', images: '["https://img.test/1.png"]',
  store_id: 'store-1', shopify_id: '123',
};

describe('lib/actions/optimizations.js', () => {
  let optimize_product;

  beforeEach(async () => {
    vi.resetModules();
    tableData = {};
    rateLimitMock.mockReset().mockResolvedValue(true);
    optimizeProductMock.mockClear().mockResolvedValue({ title: 'Optimized Title', description: 'Optimized description' });
    updateProductMock.mockClear();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

    tableData.products = { single: () => ({ data: SAMPLE_PRODUCT, error: null }) };
    tableData.product_optimizations = {
      single: () => ({ data: { id: 'opt1' }, error: null }),
      insert: (row) => ({ data: { id: 'opt1', ...row }, error: null }),
    };
    tableData.pipeline_log = { insert: () => ({ error: null }) };

    const mod = await import('../lib/actions/optimizations.js');
    optimize_product = mod.optimize_product;
  });

  it('403s when the caller lacks products:edit', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: READ_ONLY_STORE1 });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: expect.stringContaining('products:edit') }));
    expect(optimizeProductMock).not.toHaveBeenCalled();
  });

  it('403s when the caller has products:edit but the product belongs to a store outside their store_access', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: EDITOR_STORE2 });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
    expect(optimizeProductMock).not.toHaveBeenCalled();
  });

  it('400s when product_id is missing', async () => {
    const { req, res } = mockReqRes({ body: {}, user: ADMIN });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('404s when the product does not resolve', async () => {
    tableData.products.single = () => ({ data: null, error: { message: 'not found' } });
    const { req, res } = mockReqRes({ body: { product_id: 'missing' }, user: ADMIN });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('happy path: valid store + product calls the (mocked) Claude optimizer and inserts a pending optimization row', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1', brand_context: 'Friendly, upbeat' }, user: EDITOR_STORE1 });
    await optimize_product(req, res);
    expect(optimizeProductMock).toHaveBeenCalledTimes(1);
    const [productArg, brandContextArg, storeIdArg] = optimizeProductMock.mock.calls[0];
    expect(productArg).toMatchObject({ title: 'Ocean Blue Swimsuit', price: '49.00' });
    expect(brandContextArg).toBe('Friendly, upbeat');
    expect(storeIdArg).toBe('store-1');

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('pending');
    expect(body.optimized).toMatchObject({ title: 'Optimized Title' });
  });

  it('rate limit: the 31st call within the window is rejected with 429 (30/hr cap, P0-8 per-tenant)', async () => {
    rateLimitMock.mockResolvedValue(false); // simulates bucket already at 30/30 for this store+user
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: EDITOR_STORE1 });
    await optimize_product(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('optimize_product:store-1:m1', 30, 3600000);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(optimizeProductMock).not.toHaveBeenCalled();
  });

  it('rate-limit check runs AFTER the permission gate (a forbidden caller is rejected with 403, not 429)', async () => {
    rateLimitMock.mockResolvedValue(false);
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: READ_ONLY_STORE1 });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

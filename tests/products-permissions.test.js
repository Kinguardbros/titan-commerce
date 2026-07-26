import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseFromMock = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({ data: { id: 'p1', shopify_id: '123', title: 'T', store_id: 'store-1' }, error: null })),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn(async () => ({ error: null })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({
    getFullProduct: vi.fn().mockResolvedValue({ title: 'T', body_html: '', tags: '', status: 'active' }),
    getProductMetafields: vi.fn().mockResolvedValue([]),
    updateProduct: vi.fn().mockResolvedValue({ product: {} }),
    bulkUpdateVariantPrices: vi.fn().mockResolvedValue(2),
  }),
}));

vi.mock('../lib/claude.js', () => ({ optimizeProduct: vi.fn() }));
vi.mock('../lib/scraper-utils.js', () => ({ scrapeProduct: vi.fn(), scrapeCollectionUrls: vi.fn() }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
const READ_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };
const EDITOR_STORE1 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-1'] };
const EDITOR_STORE2 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-2'] };

describe('products.js permission checks', () => {
  let product_detail, update_product_full, bulk_price;

  beforeEach(async () => {
    vi.resetModules();
    getStoreMock.mockReset().mockResolvedValue({ id: 'store-1', admin_token: 't', shopify_url: 'x.myshopify.com' });
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/products.js');
    ({ product_detail, update_product_full, bulk_price } = mod);
  });

  it('product_detail: 403s without products:read', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: { role: 'member', permissions: [], store_access: ['store-1'] } });
    await product_detail(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('product_detail: 403s without store access', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['store-2'] } });
    await product_detail(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('product_detail: 200s for admin', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: ADMIN });
    await product_detail(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('update_product_full: 403s with only products:read', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: READ_ONLY });
    await update_product_full(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('update_product_full: 403s when store not in store_access', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: EDITOR_STORE2 });
    await update_product_full(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('update_product_full: 200s with products:edit + matching store_access', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: EDITOR_STORE1 });
    await update_product_full(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('bulk_price: 403s without products:edit', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_shopify_ids: ['123'], new_price: '10' }, user: READ_ONLY });
    await bulk_price(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('bulk_price: 200s for admin', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_shopify_ids: ['123'], new_price: '10' }, user: ADMIN });
    await bulk_price(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseState = { updated: [], logged: [], storeRow: null };
const supabaseFromMock = vi.fn(() => ({
  update: vi.fn((patch) => ({
    eq: vi.fn(async (_col, val) => {
      supabaseState.updated.push({ patch, shopify_id: val });
      return { error: null };
    }),
  })),
  insert: vi.fn(async (row) => {
    supabaseState.logged.push(row);
    return { error: null };
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: supabaseFromMock }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const graphqlMock = vi.fn();
const updateProductStatusMock = vi.fn();
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({
    graphql: graphqlMock,
    updateProductStatus: updateProductStatusMock,
  }),
}));

const ADMIN_USER = { role: 'admin', permissions: [], store_access: [] };

function mockReqRes(body, user = ADMIN_USER) {
  const req = { body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

describe('bulk_make_unlisted', () => {
  let bulk_make_unlisted;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.updated = [];
    supabaseState.logged = [];
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_unlisted = mod.bulk_make_unlisted;
  });

  it('400s when store_id is missing', async () => {
    const { req, res } = mockReqRes({ product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when product_shopify_ids is empty', async () => {
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when store has no admin_token', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', admin_token: null });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when store has no online_store_publication_id', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: null,
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('429s when rate limit trips', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    rateLimitMock.mockResolvedValue(false);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('413s when batch exceeds 500', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: ids });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('happy path: unlists all products and returns success', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock.mockResolvedValue({
      data: { publishableUnpublish: { userErrors: [] } },
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, updated: 2, failed: [] });
    // Two products × two mutations each (status + unpublish)
    expect(updateProductStatusMock).toHaveBeenCalledTimes(2);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
    // DB updated per product
    expect(supabaseState.updated).toHaveLength(2);
    expect(supabaseState.updated[0].patch).toMatchObject({
      status: 'active', publication_online_store: false,
    });
    // pipeline_log written
    expect(supabaseState.logged).toHaveLength(1);
    expect(supabaseState.logged[0]).toMatchObject({ agent: 'PUBLISHER', level: 'info' });
  });

  it('partial success: one product fails, batch continues', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock
      .mockResolvedValueOnce({ data: { publishableUnpublish: { userErrors: [] } } })
      .mockResolvedValueOnce({
        data: { publishableUnpublish: { userErrors: [{ field: ['id'], message: 'Not found' }] } },
      });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 20, error: expect.stringContaining('Not found') }]);
  });

  it('marks product failed when updateProductStatus throws', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockRejectedValueOnce(new Error('boom'));
    updateProductStatusMock.mockResolvedValueOnce({ product: {} });
    graphqlMock.mockResolvedValue({ data: { publishableUnpublish: { userErrors: [] } } });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 10, error: expect.stringContaining('boom') }]);
  });
});

describe('bulk_make_listed', () => {
  let bulk_make_listed;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.updated = [];
    supabaseState.logged = [];
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_listed = mod.bulk_make_listed;
  });

  it('happy path: publishes products and sets publication_online_store=true', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock.mockResolvedValue({
      data: { publishablePublish: { userErrors: [] } },
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_listed(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(supabaseState.updated).toHaveLength(2);
    expect(supabaseState.updated[0].patch).toMatchObject({
      status: 'active', publication_online_store: true,
    });
    expect(supabaseState.logged[0].message).toContain('listed');
  });

  it('partial success on publishablePublish userErrors', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock
      .mockResolvedValueOnce({ data: { publishablePublish: { userErrors: [] } } })
      .mockResolvedValueOnce({
        data: { publishablePublish: { userErrors: [{ message: 'archived' }] } },
      });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_listed(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 20, error: expect.stringContaining('archived') }]);
  });
});

describe('bulk_make_unlisted / bulk_make_listed — permission checks', () => {
  let bulk_make_unlisted;

  beforeEach(async () => {
    vi.resetModules();
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_unlisted = mod.bulk_make_unlisted;
  });

  it('403s without products:publications', async () => {
    const user = { role: 'member', permissions: ['products:edit'], store_access: ['s1'] };
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] }, user);
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403s when store not in store_access', async () => {
    const user = { role: 'member', permissions: ['products:publications'], store_access: ['s2'] };
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] }, user);
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes the permission gate for admin (falls through to existing 400 store-not-found logic)', async () => {
    getStoreMock.mockResolvedValue(null);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all backend dependencies
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}));

vi.mock('../lib/shopify-admin.js', () => ({
  getRevenueSummary: vi.fn(),
  getRecentOrders: vi.fn(),
  updateProduct: vi.fn(),
  updateVariant: vi.fn(),
  updateProductOptions: vi.fn(),
  getProductVariants: vi.fn(),
  createShopifyClient: vi.fn(() => ({})),
  isConnected: vi.fn(() => false),
  getTopProductsWithCreatives: vi.fn(),
}));

vi.mock('../lib/higgsfield.js', () => ({ buildStyledPrompt: vi.fn() }));
vi.mock('../lib/claude.js', () => ({ optimizeProduct: vi.fn() }));
vi.mock('../lib/auth.js', () => ({
  withAuth: (handler) => handler,
}));
vi.mock('../lib/rate-limit.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/store-context.js', () => ({
  getAllStores: vi.fn().mockResolvedValue([
    { id: '1', name: 'Test Store', slug: 'test', currency: 'EUR', is_active: true, admin_token: 'secret-123', client_id: 'cid' },
  ]),
  getStore: vi.fn(),
}));
vi.mock('../lib/scraper-utils.js', () => ({
  scrapeProduct: vi.fn(),
  scrapeCollectionUrls: vi.fn(),
}));
vi.mock('../lib/meta-api.js', () => ({
  isConnected: vi.fn(() => false),
  getAccountInsights: vi.fn(),
  getCampaigns: vi.fn(),
  getActiveAdsCount: vi.fn(),
}));
vi.mock('../lib/doc-processor.js', () => ({
  extractText: vi.fn(),
  classifyDocument: vi.fn(),
  extractInsights: vi.fn(),
  identifyProduct: vi.fn(),
}));

describe('system.js routing', () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('APP_SECRET', 'test-secret');
    const mod = await import('../api/system.js');
    handler = mod.default;
  });

  function mockReqRes(method, action, extra = {}) {
    const req = {
      method,
      query: { action, ...extra },
      body: { action, ...extra },
      headers: {},
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return { req, res };
  }

  it('returns 400 for unknown action', async () => {
    const { req, res } = mockReqRes('GET', 'nonexistent_action');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('stores_list does not return admin_token', async () => {
    const { req, res } = mockReqRes('GET', 'stores_list');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const responseData = res.json.mock.calls[0][0];
    expect(Array.isArray(responseData)).toBe(true);
    for (const store of responseData) {
      expect(store).not.toHaveProperty('admin_token');
      expect(store).toHaveProperty('has_admin');
    }
  });

  it('stores_list returns has_admin boolean', async () => {
    const { req, res } = mockReqRes('GET', 'stores_list');
    await handler(req, res);
    const responseData = res.json.mock.calls[0][0];
    expect(responseData[0].has_admin).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-5 (Docs/AUDIT-2026-08.md): kpi, meta_overview, insights were gated on
// products:read (the same permission the Products tab needs) — silently unlocking
// full revenue/ad-spend/pipeline visibility for any product-scoped VA/contractor.
// All three must now require the dedicated finance:read permission.

const supabaseFromMock = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  then: (resolve) => resolve({ data: [], error: null, count: 0 }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: vi.fn(() => ({})),
  isConnected: vi.fn(() => false),
  getTopProductsWithCreatives: vi.fn(async () => []),
}));

vi.mock('../lib/meta-api.js', () => ({
  isConnected: vi.fn(() => false),
  getAccountInsights: vi.fn(async () => ({})),
  getCampaigns: vi.fn(async () => []),
  getActiveAdsCount: vi.fn(async () => 0),
}));

vi.mock('../lib/store-context.js', () => ({ getStore: vi.fn(async () => null) }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
const PRODUCTS_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };
const FINANCE_READ = { role: 'member', permissions: ['finance:read'], store_access: ['store-1'] };

describe('analytics actions — finance:read gate (P0-5)', () => {
  let kpi, meta_overview, insights;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/analytics.js');
    ({ kpi, meta_overview, insights } = mod);
  });

  describe('kpi', () => {
    it('rejects a member with products:read but not finance:read (403)', async () => {
      const { req, res } = mockReqRes({ user: PRODUCTS_ONLY });
      await kpi(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows a member with finance:read', async () => {
      const { req, res } = mockReqRes({ user: FINANCE_READ });
      await kpi(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('allows admin regardless of permissions array', async () => {
      const { req, res } = mockReqRes({ user: ADMIN });
      await kpi(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  describe('meta_overview', () => {
    it('rejects a member with products:read but not finance:read (403)', async () => {
      const { req, res } = mockReqRes({ user: PRODUCTS_ONLY });
      await meta_overview(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows a member with finance:read', async () => {
      const { req, res } = mockReqRes({ user: FINANCE_READ });
      await meta_overview(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });

  describe('insights', () => {
    it('rejects a member with products:read but not finance:read (403)', async () => {
      const { req, res } = mockReqRes({ query: { store_id: 'store-1' }, user: PRODUCTS_ONLY });
      await insights(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows a member with finance:read and store access', async () => {
      const { req, res } = mockReqRes({ query: { store_id: 'store-1' }, user: FINANCE_READ });
      await insights(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('allows admin regardless of permissions array', async () => {
      const { req, res } = mockReqRes({ query: { store_id: 'store-1' }, user: ADMIN });
      await insights(req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});

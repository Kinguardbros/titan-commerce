import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseFromMock = vi.fn(() => ({
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({ data: { id: 'p1', store_id: 'store-1', cogs: 12.5 }, error: null })),
  upsert: vi.fn().mockReturnThis(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
const READ_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };
const EDITOR_STORE1 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-1'] };
const EDITOR_STORE2 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-2'] };

describe('pricing.js — update_cogs grant matrix (P1-9)', () => {
  let update_cogs;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/pricing.js');
    ({ update_cogs } = mod);
  });

  it('400s when store_id is missing', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1', cogs: 10 }, user: EDITOR_STORE1 });
    await update_cogs(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when product_id is missing', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', cogs: 10 }, user: EDITOR_STORE1 });
    await update_cogs(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('403s without products:edit permission', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', cogs: 10 }, user: READ_ONLY });
    await update_cogs(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403s with products:edit but WRONG store_access ("no access to this store")', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', cogs: 10 }, user: EDITOR_STORE2 });
    await update_cogs(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hint: 'no access to this store' }));
  });

  it('200s for member with products:edit + correct store_access', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', cogs: 10 }, user: EDITOR_STORE1 });
    await update_cogs(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200s for admin (bypasses permission + store checks)', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', cogs: 10 }, user: ADMIN });
    await update_cogs(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('filters the UPDATE by both id and store_id (defense-in-depth)', async () => {
    const eqMock = vi.fn().mockReturnThis();
    supabaseFromMock.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: eqMock,
      select: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { id: 'p1', store_id: 'store-1', cogs: 10 }, error: null })),
    });
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', cogs: 10 }, user: EDITOR_STORE1 });
    await update_cogs(req, res);
    expect(eqMock).toHaveBeenCalledWith('id', 'p1');
    expect(eqMock).toHaveBeenCalledWith('store_id', 'store-1');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [], error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn().mockReturnThis(),
    }),
  }),
}));
vi.mock('../lib/store-context.js', () => ({ getStore: vi.fn().mockResolvedValue({ id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com' }), getAllStores: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/shopify-admin.js', () => ({ createShopifyClient: () => ({}) }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const NO_PERMS = { role: 'member', permissions: [], store_access: ['s1'] };
const READER = { role: 'member', permissions: ['products:read'], store_access: ['s1'] };
const ADMIN = { role: 'admin', permissions: [], store_access: [] };

describe('Wave 2 — spot-check permission gates', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key'); });

  it('get_skills: 403s without products:read', async () => {
    const { get_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: NO_PERMS });
    await get_skills(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('get_skills: passes gate for reader with store access', async () => {
    const { get_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: READER });
    await get_skills(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('generate_skills: 403s without creatives:generate', async () => {
    const { generate_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await generate_skills(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sync_products: 403s for non-admin', async () => {
    const { sync_products } = await import('../lib/actions/sync.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await sync_products(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sync_products: passes gate for admin', async () => {
    const { sync_products } = await import('../lib/actions/sync.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: ADMIN });
    await sync_products(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('manual proposals scan_events: 403s for non-admin', async () => {
    const { scan_events } = await import('../lib/actions/proposals.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await scan_events(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // NOTE on stores_list shape: the brief's draft test expected { stores: [...] }, but the
  // response body is a bare array — confirmed against apps/dashboard/src/hooks/useActiveStore.jsx
  // (StoreProvider calls setStores(data || []) / data.find() directly on the fetch body) and the
  // pre-existing tests/system-routing.test.js ("stores_list does not return admin_token", which
  // asserts Array.isArray(responseData)). Wrapping the response would silently break the store
  // switcher, so the filtering is verified against the array shape instead.
  it('stores_list: member sees only their store_access, admin sees all', async () => {
    const { getAllStores } = await import('../lib/store-context.js');
    getAllStores.mockResolvedValue([
      { id: 's1', name: 'Isola' }, { id: 's2', name: 'Elegance House' },
    ]);
    const { stores_list } = await import('../lib/actions/stores.js');

    const { req: reqMember, res: resMember } = mockReqRes({ user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await stores_list(reqMember, resMember);
    const memberBody = resMember.json.mock.calls[0][0];
    expect(memberBody.map((s) => s.id)).toEqual(['s1']);

    const { req: reqAdmin, res: resAdmin } = mockReqRes({ user: ADMIN });
    await stores_list(reqAdmin, resAdmin);
    const adminBody = resAdmin.json.mock.calls[0][0];
    expect(adminBody.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  // Additional spot-checks beyond the brief's minimum 7 — covering admin-only gates on
  // creatives.js (poll_generations/cleanup_stale) and the docs.js store_name→store_id
  // resolution path, since those two files have non-standard structure vs the rest of Wave 2.

  it('poll_generations: 403s for non-admin', async () => {
    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: READER });
    await poll_generations(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('poll_generations: passes gate for admin', async () => {
    const { poll_generations } = await import('../lib/actions/creatives.js');
    // No store_id — takes the query-without-.eq() path, keeping the shared mock's chain simple.
    const { req, res } = mockReqRes({ query: {}, user: ADMIN });
    await poll_generations(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('profit_summary: 403s for non-admin caller with no store_id (would otherwise leak cross-store P&L)', async () => {
    const { profit_summary } = await import('../lib/actions/profit.js');
    const { req, res } = mockReqRes({ query: {}, user: READER });
    await profit_summary(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('upload_store_doc: 403s for non-admin', async () => {
    const { upload_store_doc } = await import('../lib/actions/docs.js');
    const { req, res } = mockReqRes({ body: { store_name: 'Isola', file_name: 'a.pdf', file_data: 'AA==' }, user: READER });
    await upload_store_doc(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

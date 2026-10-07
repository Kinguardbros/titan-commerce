import { describe, it, expect, vi, beforeEach } from 'vitest';

// Restored per-product text size chart (custom.size_chart_text) used by Isola's theme.

const state = { product: { shopify_id: '111', title: 'One-Piece' }, logged: [] };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      if (table === 'pipeline_log') return { insert: vi.fn(async (row) => { state.logged.push(row); return { error: null }; }) };
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: state.product, error: null }) };
      return b;
    },
  }),
}));
const getStore = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: (...a) => getStore(...a) }));
const client = { getMetafield: vi.fn(), updateMetafield: vi.fn(), getLastError: () => null };
vi.mock('../lib/shopify-admin.js', () => ({ createShopifyClient: () => client }));

const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
const VIEWER = { role: 'member', user_id: 'u2', permissions: ['products:read'], store_access: ['s1'] };
const mk = (over) => ({ req: { query: {}, body: {}, headers: {}, user: ADMIN, ...over }, res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } });

beforeEach(() => {
  state.product = { shopify_id: '111', title: 'One-Piece' }; state.logged = [];
  getStore.mockReset().mockResolvedValue({ id: 's1', shopify_url: 'x.myshopify.com', admin_token: 't' });
  client.getMetafield.mockReset(); client.updateMetafield.mockReset();
});

describe('size chart text', () => {
  it('reads custom.size_chart_text', async () => {
    client.getMetafield.mockResolvedValue({ value: 'Size,Bust\nS,34' });
    const { read_size_chart } = await import('../lib/actions/size-chart-text.js');
    const { req, res } = mk({ query: { store_id: 's1', product_id: 'p1' } });
    await read_size_chart(req, res);
    expect(client.getMetafield).toHaveBeenCalledWith('111', 'custom', 'size_chart_text');
    expect(res.json).toHaveBeenCalledWith({ size_chart_text: 'Size,Bust\nS,34' });
  });

  it('saves to custom.size_chart_text and logs', async () => {
    client.updateMetafield.mockResolvedValue({ id: 1 });
    const { save_size_chart } = await import('../lib/actions/size-chart-text.js');
    const { req, res } = mk({ body: { store_id: 's1', product_id: 'p1', size_chart_text: 'Size,Bust\nS,34' } });
    await save_size_chart(req, res);
    expect(client.updateMetafield).toHaveBeenCalledWith('111', 'custom', 'size_chart_text', 'Size,Bust\nS,34');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(state.logged[0].agent).toBe('SIZE_CHART');
  });

  it('save needs products:edit', async () => {
    const { save_size_chart } = await import('../lib/actions/size-chart-text.js');
    const { req, res } = mk({ user: VIEWER, body: { store_id: 's1', product_id: 'p1', size_chart_text: 'x' } });
    await save_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(client.updateMetafield).not.toHaveBeenCalled();
  });

  it('404 when the product is not in the store', async () => {
    state.product = null;
    const { read_size_chart } = await import('../lib/actions/size-chart-text.js');
    const { req, res } = mk({ query: { store_id: 's1', product_id: 'nope' } });
    await read_size_chart(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// The editor reads with GET (fetchJSON without a body) and saves with POST; api/system.js keeps
// separate GET/POST maps, so a read registered under POST answers "Unknown GET action" (f19dcb1).
import { readFileSync } from 'node:fs';
describe('size chart text routing', () => {
  const src = readFileSync(new URL('../api/system.js', import.meta.url), 'utf8');
  const block = (name) => src.slice(src.indexOf(`const ${name} = {`), src.indexOf('};', src.indexOf(`const ${name} = {`)));
  it('read_size_chart is a GET action, save_size_chart a POST action', () => {
    expect(block('GET_ACTIONS')).toMatch(/\bread_size_chart\b/);
    expect(block('POST_ACTIONS')).not.toMatch(/\bread_size_chart\b/);
    expect(block('POST_ACTIONS')).toMatch(/\bsave_size_chart\b/);
    expect(block('GET_ACTIONS')).not.toMatch(/\bsave_size_chart\b/);
  });
});

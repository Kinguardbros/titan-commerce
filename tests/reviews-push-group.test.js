import { describe, it, expect, vi, beforeEach } from 'vitest';

// After a product push, the shared collection-group totals (brand_config.review_group_aggregates,
// e.g. Isola's camis + bras number) are refreshed for the groups that product belongs to. The
// refresh is awaited but can never fail the push: the product's reviews are already live.

const supabaseState = { product: null, reviews: [], logged: [], updates: [] };

function makeBuilder(table) {
  const calls = { is: [] };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    is: vi.fn((col, val) => { calls.is.push([col, val]); return builder; }),
    order: vi.fn(() => builder),
    update: vi.fn((patch) => { supabaseState.updates.push({ table, patch, is: calls.is }); return builder; }),
    single: vi.fn(async () => ({ data: supabaseState.product, error: null })),
    then: (resolve, reject) => {
      if (table === 'product_reviews') return Promise.resolve({ data: supabaseState.reviews, error: null }).then(resolve, reject);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('../lib/actions/reviews-shared.js', () => ({
  withThumbnailPhotos: (r) => r,
  supabase: {
    from: (table) => {
      if (table === 'pipeline_log') {
        return { insert: vi.fn(async (row) => { supabaseState.logged.push(row); return { error: null }; }) };
      }
      return makeBuilder(table);
    },
  },
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({
  getStore: (...args) => getStoreMock(...args),
  hasAdminAccess: (store) => !!store?.admin_token,
}));

const updateMetafieldMock = vi.fn();
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({ updateMetafield: (...args) => updateMetafieldMock(...args) }),
}));

vi.mock('../lib/notify.js', () => ({ captureException: vi.fn() }));

const groupRefreshMock = vi.fn();
vi.mock('../lib/actions/reviews-group-aggregate.js', async (orig) => ({
  ...(await orig()),
  refreshReviewGroupAggregates: (...args) => groupRefreshMock(...args),
}));

const ADMIN_USER = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
function mockReqRes(body) {
  const req = { body, headers: {}, user: ADMIN_USER };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const OWN = { id: 'own1', author: 'Mary K.', rating: 5, title: 'Fits', body: 'Bought here', photo_url: null, photo_urls: null, verified: true, review_date: '2026-09-01', helpful_count: 0, origin_site: null };
const STORE = { id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: {} };

beforeEach(() => {
  vi.resetModules();
  supabaseState.product = { shopify_id: '111', title: 'Everyday Smoothing Tank', status: 'active', fake_review_count: null, tags: '["Shop All","Camis & Tanks"]' };
  supabaseState.reviews = [OWN];
  supabaseState.logged = [];
  supabaseState.updates = [];
  updateMetafieldMock.mockReset().mockResolvedValue({ id: 999 });
  groupRefreshMock.mockReset().mockResolvedValue([{ key: 'reviews_camis_bras', count: 2385, average: 4.75, products: 36 }]);
  getStoreMock.mockReset().mockResolvedValue(STORE);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
});

describe('push_reviews_to_shopify — review group totals', () => {
  it('refreshes the groups of the pushed product, after its reviews are marked published', async () => {
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(groupRefreshMock).toHaveBeenCalledTimes(1);
    const [store, storeId, opts] = groupRefreshMock.mock.calls[0];
    expect(store).toBe(STORE);
    expect(storeId).toBe('s1');
    expect(opts.collections).toEqual(['Shop All', 'Camis & Tanks']);
    expect(supabaseState.updates.some((u) => u.table === 'product_reviews' && u.patch.status === 'published')).toBe(true);
    expect(res.json.mock.calls[0][0].groups).toEqual([{ key: 'reviews_camis_bras', count: 2385, average: 4.75, products: 36 }]);
  });

  it('a failed group refresh does not fail the push', async () => {
    groupRefreshMock.mockRejectedValue(new Error('shop metafield custom.reviews_camis_bras write failed: HTTP 500'));
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ ok: true, groups: [] });
  });
});

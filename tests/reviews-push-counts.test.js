import { describe, it, expect, vi, beforeEach } from 'vitest';

// Storefront counts are real (2026-10-07): the product summary carries the number of reviews
// actually pushed, never products.fake_review_count, and the store-wide badge counts every
// published review with exact head counts instead of a row select capped at 1000.

const supabaseState = { product: null, reviews: [], logged: [], updates: [], headCounts: {} };

function makeBuilder(table) {
  const calls = { is: [] };
  const builder = {
    select: vi.fn((cols, opts) => { calls.head = !!opts?.head; return builder; }),
    eq: vi.fn((col, val) => { if (col === 'rating') calls.rating = val; return builder; }),
    in: vi.fn(() => builder),
    is: vi.fn((col, val) => { calls.is.push([col, val]); return builder; }),
    order: vi.fn(() => builder),
    update: vi.fn((patch) => { supabaseState.updates.push({ table, patch, is: calls.is }); return builder; }),
    single: vi.fn(async () => ({ data: supabaseState.product, error: null })),
    then: (resolve, reject) => {
      if (table === 'product_reviews' && calls.head) return Promise.resolve({ count: supabaseState.headCounts[calls.rating] ?? 0, error: null }).then(resolve, reject);
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

const review = (i, rating = 5) => ({ id: `r${i}`, author: 'A B.', rating, title: 't', body: 'b', photo_url: null, photo_urls: null, verified: true, review_date: '2026-09-01', helpful_count: 0, origin_site: null });
const STORE = { id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: {} };
function pushedSummary() {
  const call = updateMetafieldMock.mock.calls.find((c) => c[2] === 'reviews_summary');
  return JSON.parse(call[3]);
}

beforeEach(() => {
  vi.resetModules();
  supabaseState.product = { shopify_id: '111', title: 'Seamless Deep V Push-Up Wireless Bra', status: 'active', fake_review_count: 1223, tags: '["Bras"]' };
  supabaseState.reviews = Array.from({ length: 47 }, (_, i) => review(i));
  supabaseState.logged = [];
  supabaseState.updates = [];
  supabaseState.headCounts = {};
  updateMetafieldMock.mockReset().mockResolvedValue({ id: 999 });
  groupRefreshMock.mockReset().mockResolvedValue([]);
  getStoreMock.mockReset().mockResolvedValue(STORE);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
});

describe('push_reviews_to_shopify — real storefront count', () => {
  it('the summary count is the real number of reviews, even when a fake count is stored', async () => {
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(pushedSummary()).toMatchObject({ count: 47, real: 47, shown: 47 });
    expect(res.json.mock.calls[0][0].count).toBe(47);
    expect(supabaseState.updates.some((u) => u.table === 'products' && 'fake_review_count' in u.patch)).toBe(false);
    expect(supabaseState.logged.some((l) => /storefront count/.test(l.message || ''))).toBe(false);
  });

  it('never invents a count for a product without one', async () => {
    supabaseState.product = { ...supabaseState.product, fake_review_count: null };
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);
    expect(pushedSummary().count).toBe(47);
    expect(supabaseState.updates.some((u) => u.table === 'products')).toBe(false);
  });
});

describe('push_reviews_to_shopify — hand-set count (review_count_override)', () => {
  it('shows the override as the storefront count and keeps the real count beside it', async () => {
    supabaseState.product = { ...supabaseState.product, review_count_override: 320 };
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);
    expect(pushedSummary()).toMatchObject({ count: 320, real: 47, shown: 47 });
  });

  it('an override of 0 is respected, null falls back to the real count', async () => {
    supabaseState.product = { ...supabaseState.product, review_count_override: 0 };
    let mod = await import('../lib/actions/reviews-push.js');
    let { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await mod.push_reviews_to_shopify(req, res);
    expect(pushedSummary().count).toBe(0);

    updateMetafieldMock.mockClear();
    supabaseState.product = { ...supabaseState.product, review_count_override: null };
    vi.resetModules();
    mod = await import('../lib/actions/reviews-push.js');
    ({ req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' }));
    await mod.push_reviews_to_shopify(req, res);
    expect(pushedSummary().count).toBe(47);
  });
});

describe('refreshStoreReviewsAggregate — no 1000-row cap', () => {
  it('sums exact per-star counts of published reviews and writes custom.reviews_aggregate', async () => {
    supabaseState.headCounts = { 5: 3900, 4: 450, 3: 100, 2: 40, 1: 38 };
    const { refreshStoreReviewsAggregate } = await import('../lib/actions/reviews-push.js');
    const out = await refreshStoreReviewsAggregate(STORE, 's1');

    expect(out).toEqual({ count: 4528, average: 4.8 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://x.myshopify.com/admin/api/2024-01/metafields.json');
    const mf = JSON.parse(init.body).metafield;
    expect(mf).toMatchObject({ namespace: 'custom', key: 'reviews_aggregate', type: 'json' });
    expect(JSON.parse(mf.value)).toMatchObject({ count: 4528, average: 4.8 });
  });
});

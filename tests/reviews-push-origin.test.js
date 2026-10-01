import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reviews syndicated from another shop (origin_site set) may only reach the storefront where
// the theme renders that origin next to the review. A store opts in with
// brand_config.features.review_origin_label once its theme does; until then the push holds
// those reviews back entirely — out of the metafield, out of the average, and not marked
// published.

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

const ADMIN_USER = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
function mockReqRes(body) {
  const req = { body, headers: {}, user: ADMIN_USER };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const OWN = { id: 'own1', author: 'Mary K.', rating: 5, title: 'Fits', body: 'Bought here', photo_url: null, photo_urls: null, verified: true, review_date: '2026-09-01', helpful_count: 0, origin_site: null };
const SYNDICATED = { id: 'syn1', author: 'Johnnie H.', rating: 3, title: 'Ok', body: 'Bought on shapermint', photo_url: null, photo_urls: null, verified: true, review_date: '2026-09-29', helpful_count: 0, origin_site: 'shapermint.com' };

function pushedReviews() {
  const call = updateMetafieldMock.mock.calls.find((c) => c[2] === 'reviews_json');
  return JSON.parse(call[3]);
}
function pushedSummary() {
  const call = updateMetafieldMock.mock.calls.find((c) => c[2] === 'reviews_summary');
  return JSON.parse(call[3]);
}

beforeEach(() => {
  vi.resetModules();
  supabaseState.product = { shopify_id: '111', title: 'Everyday Scoop Neck Smoothing Cami', status: 'active', fake_review_count: null };
  supabaseState.reviews = [OWN, SYNDICATED];
  supabaseState.logged = [];
  supabaseState.updates = [];
  updateMetafieldMock.mockReset().mockResolvedValue({ id: 999 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
});

describe('push_reviews_to_shopify — syndicated (origin_site) reviews', () => {
  it('store without review_origin_label: holds syndicated reviews back from the metafield, the average and the published-marking', async () => {
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: {} });
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(pushedReviews().map((r) => r.id)).toEqual(['own1']);
    expect(pushedSummary()).toMatchObject({ average: 5, real: 1 });
    const publish = supabaseState.updates.find((u) => u.table === 'product_reviews' && u.patch.status === 'published');
    expect(publish.is).toContainEqual(['origin_site', null]);
    expect(res.json.mock.calls[0][0].held_back).toBe(1);
  });

  it('store with review_origin_label: pushes syndicated reviews with origin_site and never as verified', async () => {
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: { features: { review_origin_label: true } } });
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const pushed = pushedReviews();
    const syn = pushed.find((r) => r.id === 'syn1');
    const own = pushed.find((r) => r.id === 'own1');
    expect(syn).toMatchObject({ origin_site: 'shapermint.com', verified: false });
    expect(own).not.toHaveProperty('origin_site');
    expect(own.verified).toBe(true);
    const publish = supabaseState.updates.find((u) => u.table === 'product_reviews' && u.patch.status === 'published');
    expect(publish.is).toEqual([]);
  });

  it('does not overwrite the metafield when the review query fails', async () => {
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: {} });
    supabaseState.reviews = null;
    const { supabase } = await import('../lib/actions/reviews-shared.js');
    const realFrom = supabase.from;
    supabase.from = (table) => {
      const b = realFrom(table);
      if (table !== 'product_reviews') return b;
      b.then = (resolve, reject) => Promise.resolve({ data: null, error: { message: 'column product_reviews.origin_site does not exist' } }).then(resolve, reject);
      return b;
    };
    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);
    supabase.from = realFrom;

    expect(res.status).toHaveBeenCalledWith(500);
    expect(updateMetafieldMock).not.toHaveBeenCalled();
  });
});

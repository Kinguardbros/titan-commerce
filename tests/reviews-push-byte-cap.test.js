import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// AUDIT-2026-08 P2: push_reviews_to_shopify sliced the outgoing reviews array
// to a fixed top-200 and assumed ~500 B/review to stay under Shopify's 100 KB
// metafield cap. Multi-photo reviews (post-F04 multi-photo support,
// `photo_urls`) can run 1-2 KB each, so 200 of them can blow well past
// 90-100 KB. These tests prove the byte-size safeguard (trimToByteBudget,
// invoked from push_reviews_to_shopify) actually keeps the pushed JSON
// under budget and reports what it had to trim — and that a pathological
// case that's STILL over the hard cap after aggressive trimming is reported
// via Sentry rather than thrown.
// ---------------------------------------------------------------------------

const supabaseState = { product: null, reviews: [], logged: [] };

// Generic auto-chaining builder (same technique as tests/rate-limit-per-tenant.test.js)
// — every intermediate call (select/eq/in/order/update) returns the same builder;
// awaiting it directly resolves via `.then()`. Handles both push's own
// `.select().eq().eq().in().order()` review query and refreshStoreReviewsAggregate's
// shorter `.select().eq().in()` query with the same config.
function makeBuilder(table) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    update: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: supabaseState.product, error: null })),
    then: (resolve, reject) => {
      if (table === 'product_reviews') return Promise.resolve({ data: supabaseState.reviews, error: null }).then(resolve, reject);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('../lib/actions/reviews-shared.js', () => ({
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

const captureExceptionMock = vi.fn();
vi.mock('../lib/notify.js', () => ({ captureException: (...args) => captureExceptionMock(...args) }));

const ADMIN_USER = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
function mockReqRes(body) {
  const req = { body, headers: {}, user: ADMIN_USER };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

function makeReview(i, overrides = {}) {
  return {
    id: `r${i}`,
    author: `Author ${i}`,
    rating: (i % 5) + 1,
    title: `Title ${i}`,
    body: `Review body text number ${i}. `.repeat(5),
    photo_url: null,
    photo_urls: Array.from({ length: 5 }, (_, p) => `https://cdn.example.com/photos/review-${i}-photo-${p}.jpg`),
    verified: true,
    review_date: `2024-${String((i % 12) + 1).padStart(2, '0')}-01`,
    helpful_count: i % 10,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  supabaseState.product = null;
  supabaseState.reviews = [];
  supabaseState.logged = [];
  getStoreMock.mockReset().mockResolvedValue({ id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok' });
  updateMetafieldMock.mockReset().mockResolvedValue({ id: 999 }); // truthy = Shopify accepted the write
  captureExceptionMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' })); // refreshStoreReviewsAggregate (fire-and-forget)
});

describe('push_reviews_to_shopify — metafield byte-size safeguard', () => {
  it('small payload: no trim needed, all reviews pushed as-is', async () => {
    supabaseState.product = { shopify_id: '111', title: 'Small Product', status: 'active', fake_review_count: null };
    // All rating 5 — keeps interleaveByRating's spine non-empty (its collision handling
    // for a small all-non-5-star set is unrelated pre-existing behavior, not under test here).
    supabaseState.reviews = [
      makeReview(0, { rating: 5, photo_urls: [] }),
      makeReview(1, { rating: 5, photo_urls: [] }),
      makeReview(2, { rating: 5, photo_urls: [] }),
    ];

    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.trimmed).toBe(0);
    expect(body.photos_stripped).toBe(0);
    expect(body.shown).toBe(3);

    const [, , , pushedJson] = updateMetafieldMock.mock.calls.find((c) => c[2] === 'reviews_json');
    expect(Buffer.byteLength(pushedJson, 'utf8')).toBeLessThan(90_000);
    expect(JSON.parse(pushedJson)).toHaveLength(3);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    // No trim → no "Trimmed" warn log noise.
    expect(supabaseState.logged.some((l) => l.message?.includes('Trimmed'))).toBe(false);
  });

  it('large photo-heavy payload (500 reviews): trims to fit under 90 KB and reports the trimmed count', async () => {
    supabaseState.product = { shopify_id: '222', title: 'Popular Product', status: 'active', fake_review_count: 900 };
    supabaseState.reviews = Array.from({ length: 500 }, (_, i) => makeReview(i));

    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
    await push_reviews_to_shopify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.trimmed).toBeGreaterThan(0);
    expect(body.real).toBe(500); // real DB count is untouched — only the push payload was trimmed

    const [, , , pushedJson] = updateMetafieldMock.mock.calls.find((c) => c[2] === 'reviews_json');
    expect(Buffer.byteLength(pushedJson, 'utf8')).toBeLessThanOrEqual(90_000);
    // Trim actually happened and was logged for the audit trail (P1-16 initiator convention).
    const trimLog = supabaseState.logged.find((l) => l.message?.includes('Trimmed'));
    expect(trimLog).toBeTruthy();
    expect(trimLog.initiator).toBe('user');
    expect(captureExceptionMock).not.toHaveBeenCalled(); // trimming alone was enough — no pathological case
  });

  it('pathological case: still over the 100 KB hard cap after aggressive trim → Sentry-reported, push still attempted (not thrown)', async () => {
    supabaseState.product = { shopify_id: '333', title: 'Extreme Product', status: 'active', fake_review_count: null };
    supabaseState.reviews = [
      // Removed first (lowest rating, oldest) — no capacity to fix the size problem anyway.
      makeReview(0, { rating: 1, review_date: '2020-01-01', body: 'short', photo_urls: [] }),
      // Survives the drop-lowest-rated pass; body alone exceeds the 100 KB hard cap, and it
      // has no photo_urls to strip, so phase-2 stripping can't rescue it either.
      { id: 'huge', author: 'Huge Reviewer', rating: 5, title: 'Massive', body: 'x'.repeat(105_000), photo_url: null, photo_urls: [], verified: true, review_date: '2025-01-01', helpful_count: 0 },
    ];

    const { push_reviews_to_shopify } = await import('../lib/actions/reviews-push.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });

    await push_reviews_to_shopify(req, res); // must not throw — an await that rejects fails this test

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [err] = captureExceptionMock.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(res.status).toHaveBeenCalledWith(200); // push is still attempted — failure here is recoverable, not fatal
  });
});

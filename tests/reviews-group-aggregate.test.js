import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared review totals for a group of collections (brand_config.review_group_aggregates), written
// to a shop metafield custom.<key>. Isola uses it for one camis + bras number under the product
// title. Only published reviews count, per-star counts are exact (head requests), and the push
// refreshes only the groups its product belongs to.

const state = { products: [], counts: {}, countQueries: [], logged: [], countError: null };

function productsBuilder() {
  let from = 0;
  let to = 999;
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    order: vi.fn(() => b),
    range: vi.fn((f, t) => { from = f; to = t; return b; }),
    then: (resolve, reject) => Promise.resolve({ data: state.products.slice(from, to + 1), error: null }).then(resolve, reject),
  };
  return b;
}

function reviewsBuilder() {
  const q = { eq: {}, in: null, opts: null };
  const b = {
    select: vi.fn((cols, opts) => { q.opts = opts; return b; }),
    eq: vi.fn((col, val) => { q.eq[col] = val; return b; }),
    in: vi.fn((col, val) => { q.in = val; return b; }),
    then: (resolve, reject) => {
      state.countQueries.push(q);
      if (state.countError) return Promise.resolve({ count: null, error: state.countError }).then(resolve, reject);
      return Promise.resolve({ count: state.counts[q.eq.rating] ?? 0, error: null }).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('../lib/actions/reviews-shared.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'pipeline_log') return { insert: vi.fn(async (row) => { state.logged.push(row); return { error: null }; }) };
      if (table === 'products') return productsBuilder();
      return reviewsBuilder();
    },
  },
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({
  getStore: (...args) => getStoreMock(...args),
  hasAdminAccess: (store) => !!store?.admin_token,
}));

const tags = (...c) => JSON.stringify(c);
const GROUP = { key: 'reviews_camis_bras', collections: ['Camis & Tanks', 'Bras'] };
const STORE = { id: 's1', shopify_url: 'x.myshopify.com', admin_token: 'tok', brand_config: { review_group_aggregates: [GROUP] } };

function metafieldWrites() {
  return fetch.mock.calls.map(([url, init]) => ({ url, ...JSON.parse(init.body).metafield }));
}

beforeEach(() => {
  vi.resetModules();
  state.products = [
    { id: 'cami1', tags: tags('Shop All', 'Camis & Tanks'), status: 'active' },
    { id: 'bra1', tags: tags('Bras', 'Bra Bundles'), status: 'active' },
    { id: 'bundle', tags: tags('Bra Bundles'), status: 'active' },
    { id: 'old', tags: tags('Bras'), status: 'archived' },
    { id: 'bikini', tags: ['Bikinis'], status: 'active' },
  ];
  state.counts = { 5: 1800, 4: 400, 3: 100, 2: 50, 1: 34 };
  state.countQueries = [];
  state.logged = [];
  state.countError = null;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
});

describe('review group config and math', () => {
  it('keeps only well-formed groups: the key becomes a live metafield name', async () => {
    const { reviewGroups } = await import('../lib/actions/reviews-group-aggregate.js');
    const store = { brand_config: { review_group_aggregates: [
      GROUP,
      { key: 'Bad Key!', collections: ['Bras'] },
      { key: 'no_collections', collections: [] },
      { key: 'blank_collection', collections: ['  '] },
      null,
    ] } };
    expect(reviewGroups(store)).toEqual([GROUP]);
    expect(reviewGroups({ brand_config: {} })).toEqual([]);
  });

  it('reads collections from a JSON string or an array, and nothing from garbage', async () => {
    const { parseCollections } = await import('../lib/actions/reviews-group-aggregate.js');
    expect(parseCollections('["Bras","Bra Bundles"]')).toEqual(['Bras', 'Bra Bundles']);
    expect(parseCollections(['Bras'])).toEqual(['Bras']);
    expect(parseCollections('not json')).toEqual([]);
    expect(parseCollections(null)).toEqual([]);
  });

  it('sums per-star counts into a count and a two-decimal average', async () => {
    const { summarize } = await import('../lib/actions/reviews-group-aggregate.js');
    expect(summarize({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 })).toEqual({ count: 4, average: 4.75 });
    expect(summarize({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toEqual({ count: 0, average: 0 });
  });
});

describe('refreshReviewGroupAggregates', () => {
  it('counts published reviews of the group products only and writes custom.<key>', async () => {
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    const out = await refreshReviewGroupAggregates(STORE, 's1');

    expect(out).toEqual([{ key: 'reviews_camis_bras', count: 2384, average: 4.63, products: 2 }]);
    expect(state.countQueries).toHaveLength(5);
    for (const q of state.countQueries) {
      expect(q.eq.status).toBe('published');
      expect(q.eq.store_id).toBe('s1');
      expect(q.in).toEqual(['cami1', 'bra1']); // no archived product, no bundle-only, no bikini
      expect(q.opts).toEqual({ count: 'exact', head: true });
    }
    const [write] = metafieldWrites();
    expect(write.url).toBe('https://x.myshopify.com/admin/api/2024-01/metafields.json');
    expect(write).toMatchObject({ namespace: 'custom', key: 'reviews_camis_bras', type: 'json' });
    expect(JSON.parse(write.value)).toMatchObject({ count: 2384, average: 4.63, collections: ['Camis & Tanks', 'Bras'] });
    expect(state.logged[0].message).toContain('custom.reviews_camis_bras updated: 2384 reviews');
  });

  it('with a product\'s collections, refreshes only the groups that product belongs to', async () => {
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    expect(await refreshReviewGroupAggregates(STORE, 's1', { collections: ['Bikinis', 'Shop All'] })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await refreshReviewGroupAggregates(STORE, 's1', { collections: ['Bras'] })).toHaveLength(1);
  });

  it('reads every page of products, not only the first 1000', async () => {
    state.products = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, tags: tags('Shop All'), status: 'active' }));
    state.products.push({ id: 'late-bra', tags: tags('Bras'), status: 'active' });
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    await refreshReviewGroupAggregates(STORE, 's1');
    expect(state.countQueries[0].in).toEqual(['late-bra']);
  });

  it('writes zeros when the group has no products, so an old number does not linger', async () => {
    state.products = [];
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    const [out] = await refreshReviewGroupAggregates(STORE, 's1');
    expect(out).toMatchObject({ count: 0, average: 0, products: 0 });
    expect(state.countQueries).toHaveLength(0);
    expect(JSON.parse(metafieldWrites()[0].value)).toMatchObject({ count: 0, average: 0 });
  });

  it('a failed count read throws instead of writing a wrong number', async () => {
    state.countError = { message: 'boom' };
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    await expect(refreshReviewGroupAggregates(STORE, 's1')).rejects.toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a rejected Shopify write throws with the metafield name', async () => {
    fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' });
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    await expect(refreshReviewGroupAggregates(STORE, 's1')).rejects.toThrow(/custom\.reviews_camis_bras.*422/);
  });
});

describe('all-products group', () => {
  const ALL = { ...STORE, brand_config: { review_group_aggregates: [{ key: 'reviews_total', all: true }] } };

  it('is a valid group without collections', async () => {
    const { reviewGroups } = await import('../lib/actions/reviews-group-aggregate.js');
    expect(reviewGroups(ALL)).toEqual([{ key: 'reviews_total', all: true }]);
    expect(reviewGroups({ brand_config: { review_group_aggregates: [{ key: 'reviews_total', all: 'yes' }] } })).toEqual([]);
  });

  it('counts every non-archived product, whatever its collections', async () => {
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    const [out] = await refreshReviewGroupAggregates(ALL, 's1');
    expect(out).toMatchObject({ key: 'reviews_total', products: 4 });
    expect(state.countQueries[0].in).toEqual(['cami1', 'bra1', 'bundle', 'bikini']);
    expect(JSON.parse(metafieldWrites()[0].value)).toMatchObject({ count: 2384, collections: 'all' });
    expect(state.logged[0].message).toContain('(all products, 4 products)');
  });

  it('is refreshed by a push of any product', async () => {
    const { refreshReviewGroupAggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    expect(await refreshReviewGroupAggregates(ALL, 's1', { collections: ['Bikinis'] })).toHaveLength(1);
    expect(await refreshReviewGroupAggregates(ALL, 's1', { collections: [] })).toHaveLength(1);
  });
});

describe('refresh_review_group_aggregates action', () => {
  const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
  const call = async (body, user = ADMIN) => {
    const { refresh_review_group_aggregates } = await import('../lib/actions/reviews-group-aggregate.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await refresh_review_group_aggregates({ body, user, headers: {} }, res);
    return res;
  };

  it('refreshes every configured group', async () => {
    getStoreMock.mockResolvedValue(STORE);
    const res = await call({ store_id: 's1' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].groups[0]).toMatchObject({ key: 'reviews_camis_bras', count: 2384 });
  });

  it('refuses a store without groups, and a missing store_id', async () => {
    getStoreMock.mockResolvedValue({ ...STORE, brand_config: {} });
    expect((await call({ store_id: 's1' })).status).toHaveBeenCalledWith(400);
    expect((await call({})).status).toHaveBeenCalledWith(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});

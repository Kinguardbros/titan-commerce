import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-13 (Docs/AUDIT-2026-08.md): api/cron/detect-events.js iterated stores
// sequentially (`for (const store of stores)`), so wall-clock scaled O(N) with
// store count and risked the Vercel cron timeout once past 4-6 stores. Fixed
// by wrapping the per-store body in processStore() and driving it with
// Promise.allSettled(stores.map(processStore)) — wall-clock now caps at
// max(singleStoreTime), and one store throwing never aborts the others.
//
// These tests mock detectEventsForStore + createShopifyClient + poll_generations
// at the module boundary and drive the real handler with 3 stores, one of which
// throws, asserting the other 2 still complete and the failure is reported
// (not swallowed, not fatal to the whole cron run).
//
// Also covers the P1-20 follow-up fixed inline here: poll_generations is called
// with a synthesized SYSTEM admin req.user so it doesn't 403 silently.
// ---------------------------------------------------------------------------

let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: row, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    delete: vi.fn(() => builder),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single() : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list() : { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

let storageListMock;
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => makeBuilder(table),
    storage: {
      from: () => ({
        list: (...args) => storageListMock(...args),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
}));

vi.mock('../lib/sentry.js', () => ({
  initSentry: vi.fn(),
  captureException: vi.fn(),
}));

const getTopProductsMock = vi.fn();
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: vi.fn(() => ({ getTopProductsWithCreatives: getTopProductsMock })),
}));

const detectEventsForStoreMock = vi.fn();
vi.mock('../lib/event-detector.js', () => ({
  detectEventsForStore: (...args) => detectEventsForStoreMock(...args),
}));

const pollGenerationsMock = vi.fn();
vi.mock('../lib/actions/creatives.js', () => ({
  poll_generations: (...args) => pollGenerationsMock(...args),
}));

function mockReqRes({ headers = {} } = {}) {
  const req = { headers };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

function makeStore(overrides = {}) {
  return { id: 's1', name: 'Store 1', shopify_url: 'store1.myshopify.com', admin_token: 'tok1', ...overrides };
}

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  storageListMock = vi.fn().mockResolvedValue({ data: [] });
  getTopProductsMock.mockReset();
  detectEventsForStoreMock.mockReset();
  pollGenerationsMock.mockReset();
  pollGenerationsMock.mockImplementation(async (req, res) => {
    res.status(200).json({ checked: 0, completed: 0, failed: 0 });
  });
  delete process.env.CRON_SECRET;
});

describe('cron/detect-events — parallel store processing (P1-13)', () => {
  it('processes 3 stores concurrently and aggregates events/proposals', async () => {
    const stores = [makeStore({ id: 's1', name: 'Store 1' }), makeStore({ id: 's2', name: 'Store 2' }), makeStore({ id: 's3', name: 'Store 3' })];
    tableData.stores = { list: () => ({ data: stores, error: null }) };

    getTopProductsMock.mockResolvedValue([{ product_id: 'p1', units: 1, creative_count: 0, revenue: 10 }]);
    detectEventsForStoreMock.mockResolvedValue({ eventsCreated: 1, proposalsCreated: 1 });

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.events).toBe(3);
    expect(body.proposals).toBe(3);
    expect(body.failures).toEqual([]);
    expect(body.stores).toHaveLength(3);
    expect(detectEventsForStoreMock).toHaveBeenCalledTimes(3);
  });

  it('one store throwing does NOT abort the others (Promise.allSettled, not Promise.all)', async () => {
    const stores = [makeStore({ id: 's1', name: 'Good Store A' }), makeStore({ id: 's2', name: 'Bad Store' }), makeStore({ id: 's3', name: 'Good Store B' })];
    tableData.stores = { list: () => ({ data: stores, error: null }) };

    getTopProductsMock.mockImplementation(async (store) => {
      // createShopifyClient is mocked to return a fixed client regardless of args,
      // so route on call count instead: 2nd call = the failing store (Bad Store).
      return [{ product_id: 'p1', units: 1, creative_count: 0, revenue: 10 }];
    });

    let call = 0;
    detectEventsForStoreMock.mockImplementation(async (storeId) => {
      call++;
      if (storeId === 's2') throw new Error('Shopify API 500 for Bad Store');
      return { eventsCreated: 1, proposalsCreated: 1 };
    });

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    // the 2 good stores still completed
    expect(body.events).toBe(2);
    expect(body.proposals).toBe(2);
    // the failure is reported, not swallowed
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toMatch(/Bad Store/);
    expect(detectEventsForStoreMock).toHaveBeenCalledTimes(3);
  });

  it('a store with no admin_token is skipped, not counted as a failure', async () => {
    const stores = [makeStore({ id: 's1', name: 'No Token Store', admin_token: null })];
    tableData.stores = { list: () => ({ data: stores, error: null }) };

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.failures).toEqual([]);
    expect(body.events).toBe(0);
    expect(detectEventsForStoreMock).not.toHaveBeenCalled();
  });

  it('calls poll_generations with a synthesized admin req.user (P1-20 follow-up fix)', async () => {
    tableData.stores = { list: () => ({ data: [], error: null }) };

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(pollGenerationsMock).toHaveBeenCalledTimes(1);
    const [pollReq] = pollGenerationsMock.mock.calls[0];
    expect(pollReq.user).toBeDefined();
    expect(pollReq.user.role).toBe('admin');
  });

  it('respects CRON_SECRET auth check unchanged', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes({ headers: { authorization: 'Bearer wrong' } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(pollGenerationsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P1-13 follow-up: MAX_PARALLEL_STORES (=10) never triggers a second batch at
// the current 2-6 active-store count, so the batching branch of runInBatches()
// has zero coverage above. runInBatches() is a module-private helper (not
// exported) — driven here through the real handler with 12 synthetic stores,
// per the file's own header note on how this suite drives the parallel path.
// ---------------------------------------------------------------------------
describe('cron/detect-events — MAX_PARALLEL_STORES batching branch (P1-13 follow-up, synthetic 12-store test)', () => {
  it('batches 12 stores into groups of 10: batch 1 fully settles before batch 2 starts, all 12 stores are processed exactly once, and one rejection does not abort the others', async () => {
    const stores = Array.from({ length: 12 }, (_, i) => makeStore({ id: `s${i + 1}`, name: `Store ${i + 1}` }));
    tableData.stores = { list: () => ({ data: stores, error: null }) };
    getTopProductsMock.mockResolvedValue([{ product_id: 'p1', units: 1, creative_count: 0, revenue: 10 }]);

    const FAILING_STORE_ID = 's7'; // inside batch 1 (stores 1-10) — proves a mid-batch rejection
                                    // doesn't abort the rest of batch 1 or block batch 2 from starting.
    const timeline = [];
    detectEventsForStoreMock.mockImplementation(async (storeId) => {
      timeline.push({ storeId, event: 'start', t: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 10));
      timeline.push({ storeId, event: 'end', t: Date.now() });
      if (storeId === FAILING_STORE_ID) throw new Error(`[${storeId}] simulated failure`);
      return { eventsCreated: 1, proposalsCreated: 1 };
    });

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();

    const wallStart = Date.now();
    await handler(req, res);
    const wallDuration = Date.now() - wallStart;

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];

    // No drops: processStore (proxied here by detectEventsForStoreMock, called once per store
    // that reaches it) ran for all 12 stores, regardless of the one rejection.
    expect(detectEventsForStoreMock).toHaveBeenCalledTimes(12);

    // allSettled semantics: the 1 rejection is reported, not swallowed and not fatal — the
    // other 11 stores still completed and are reflected in the aggregated totals.
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]).toContain(FAILING_STORE_ID);
    expect(body.stores).toHaveLength(11);
    expect(body.events).toBe(11);
    expect(body.proposals).toBe(11);

    // Batching happened: batch 1 (the first 10 stores, MAX_PARALLEL_STORES) must fully settle
    // (all 10 'end' events) before batch 2 (stores 11-12) starts (their 'start' events) — this
    // is a structural guarantee of the `for` loop awaiting each batch's Promise.allSettled
    // before moving on, not a timing race.
    const batch1Ids = stores.slice(0, 10).map((s) => s.id);
    const batch2Ids = stores.slice(10).map((s) => s.id);
    const batch1EndTimes = timeline.filter((e) => batch1Ids.includes(e.storeId) && e.event === 'end').map((e) => e.t);
    const batch2StartTimes = timeline.filter((e) => batch2Ids.includes(e.storeId) && e.event === 'start').map((e) => e.t);
    expect(batch1EndTimes).toHaveLength(10);
    expect(batch2StartTimes).toHaveLength(2);
    expect(Math.min(...batch2StartTimes)).toBeGreaterThanOrEqual(Math.max(...batch1EndTimes));

    // Timing: 12 stores at ~10ms each, capped at 10 concurrent, is 2 sequential rounds (~20ms)
    // — not ~120ms, which is what the pre-P1-13 fully-sequential `for` loop would have taken.
    // Generous upper bound to absorb CI/test-runner scheduling jitter while still failing hard
    // on a regression back to unbounded-sequential behavior.
    expect(wallDuration).toBeLessThan(90);
  });
});

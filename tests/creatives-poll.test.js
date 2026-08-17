import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-20 (Docs/AUDIT-2026-08.md): poll_generations was SELECT-then-mutate — no
// row locking, no claim column. Two concurrent pollers (ProductWorkspace.jsx /
// Studio.jsx polling every 3s in separate browser tabs, or the daily admin
// cron) could both SELECT the same batch of 'generating' creatives and both
// trigger a duplicate fal.ai auto-retry resubmission for the same stuck job —
// wasted fal.ai credits + racing writes to the same row.
//
// Fix: claim_generating_creatives() Postgres RPC (sql/add-claim-generating-
// creatives-fn.sql — UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING) atomically
// flips 'generating' -> 'polling' before poll_generations ever sees a row.
//
// These tests mock the RPC boundary — they prove poll_generations (a) calls
// the RPC with the right limit/store scoping instead of a plain SELECT,
// (b) only ever processes rows the RPC handed it and never reprocesses a row
// a sibling call already claimed, (c) releases the claim (status back to
// 'generating') when the fal.ai job is still in progress or when processing
// throws mid-work, and (d) cleanup_stale resets orphaned 'polling' rows.
// The actual FOR UPDATE SKIP LOCKED atomicity is a DB-layer guarantee that
// can't be exercised by a single-process mock — same documented limitation
// as the P1-17 safe_update_user/safe_delete_user RPC tests (tests/users.test.js).
// ---------------------------------------------------------------------------

let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    filter: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: null, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single() : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const ctx = {
        wasUpdate: builder.update.mock.calls.length > 0,
        updateVals: builder.update.mock.calls[0]?.[0],
        eqCalls: builder.eq.mock.calls,
        hadLt: builder.lt.mock.calls.length > 0,
      };
      const result = c.list ? c.list(ctx) : { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

let rpcMock;
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => makeBuilder(table),
    rpc: (...args) => rpcMock(...args),
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage.test/x.png' } }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
}));

vi.mock('../lib/rate-limit.js', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/higgsfield.js', () => ({ buildStyledPrompt: vi.fn() }));
vi.mock('../lib/store-context.js', () => ({ getStore: vi.fn() }));
vi.mock('../lib/shopify-admin.js', () => ({ createShopifyClient: vi.fn() }));
const checkFalJobMock = vi.fn();
const submitFalJobMock = vi.fn();
vi.mock('../lib/fal.js', () => ({
  checkFalJob: (...args) => checkFalJobMock(...args),
  submitFalJob: (...args) => submitFalJobMock(...args),
}));
vi.mock('../lib/avatar-crop.js', () => ({ processCatalogImage: vi.fn(async (buf) => buf) }));
vi.mock('../lib/v3-beach-scenes.js', () => ({ buildV3BeachPrompt: vi.fn(() => '') }));

function mockReqRes({ query = {}, body = {}, user } = {}) {
  const req = { query, body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };

function claimedRow(overrides = {}) {
  return {
    id: 'c1', hf_job_id: 'job1', status: 'polling',
    metadata: { poll_base: 'https://fal.test/poll' },
    storage_path: null, created_at: new Date().toISOString(), style: 'lifestyle',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  rpcMock = vi.fn();
  checkFalJobMock.mockReset();
  submitFalJobMock.mockReset();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
});

describe('poll_generations — atomic claim via claim_generating_creatives RPC (P1-20)', () => {
  it('claims via RPC (limit + store scoping) instead of a plain SELECT', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await poll_generations(req, res);
    expect(rpcMock).toHaveBeenCalledWith('claim_generating_creatives', { p_limit: 20, p_store_id: 's1' });
    expect(res.json).toHaveBeenCalledWith({ checked: 0, completed: 0, failed: 0 });
  });

  it('admin call with no store_id claims across all stores (p_store_id: null)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: {}, user: ADMIN });
    await poll_generations(req, res);
    expect(rpcMock).toHaveBeenCalledWith('claim_generating_creatives', { p_limit: 20, p_store_id: null });
  });

  it('processes a row the RPC claimed (status already polling) and finalizes a completed fal.ai job to pending', async () => {
    rpcMock.mockResolvedValue({ data: [claimedRow()], error: null });
    checkFalJobMock.mockResolvedValue({ status: 'completed', url: 'https://img.test/x.png' });

    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await poll_generations(req, res);

    expect(checkFalJobMock).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ checked: 1, completed: 1, failed: 0 });
  });

  it('two poll_generations calls never reprocess the same row — each only touches what the RPC handed it (DB-layer FOR UPDATE SKIP LOCKED atomicity can\'t be exercised by a single-process mock; this proves the JS side honors disjoint claim results, same limitation as P1-17)', async () => {
    const rowA = claimedRow({ id: 'a', hf_job_id: 'jobA' });
    const rowB = claimedRow({ id: 'b', hf_job_id: 'jobB' });
    // Simulate the DB handing out disjoint sets across two concurrent-ish callers.
    rpcMock.mockResolvedValueOnce({ data: [rowA], error: null });
    rpcMock.mockResolvedValueOnce({ data: [rowB], error: null });
    checkFalJobMock.mockResolvedValue({ status: 'pending' });

    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req: req1, res: res1 } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    const { req: req2, res: res2 } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await Promise.all([poll_generations(req1, res1), poll_generations(req2, res2)]);

    const processedJobIds = checkFalJobMock.mock.calls.map((call) => call[1]);
    expect(processedJobIds.sort()).toEqual(['jobA', 'jobB']);
    expect(new Set(processedJobIds).size).toBe(2);
  });

  it('releases the claim (status -> generating) when the fal.ai job is still in progress', async () => {
    rpcMock.mockResolvedValue({ data: [claimedRow()], error: null });
    checkFalJobMock.mockResolvedValue({ status: 'pending' });

    let releaseVals = null;
    tableData.creatives = {
      list: (ctx) => {
        if (ctx.wasUpdate) releaseVals = ctx.updateVals;
        return { data: [], error: null };
      },
    };

    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await poll_generations(req, res);

    expect(releaseVals).toEqual({ status: 'generating', polling_started_at: null });
  });

  it('releases the claim when processing throws mid-work (checkFalJob rejects)', async () => {
    rpcMock.mockResolvedValue({ data: [claimedRow()], error: null });
    checkFalJobMock.mockRejectedValue(new Error('fal.ai unreachable'));

    let releaseVals = null;
    tableData.creatives = {
      list: (ctx) => {
        if (ctx.wasUpdate) releaseVals = ctx.updateVals;
        return { data: [], error: null };
      },
    };

    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await poll_generations(req, res);

    expect(releaseVals).toEqual({ status: 'generating', polling_started_at: null });
  });

  it('re-arms the claimed row (status -> generating) when an auto-retry is resubmitted after a hard timeout', async () => {
    const oldRow = claimedRow({
      metadata: { poll_base: 'https://fal.test/poll', model: 'fal-ai/nano-banana-2/edit', submitted_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(), retry_count: 0 },
    });
    rpcMock.mockResolvedValue({ data: [oldRow], error: null });
    submitFalJobMock.mockResolvedValue({ requestId: 'retry-job', pollBase: 'https://fal.test/poll' });

    let retryVals = null;
    tableData.creatives = {
      list: (ctx) => {
        if (ctx.wasUpdate) retryVals = ctx.updateVals;
        return { data: [], error: null };
      },
    };

    const { poll_generations } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: ADMIN });
    await poll_generations(req, res);

    expect(retryVals).toMatchObject({ status: 'generating', polling_started_at: null, hf_job_id: 'retry-job' });
  });
});

describe('cleanup_stale — resets orphaned polling rows stuck > 10 min (P1-20)', () => {
  it('resets status=polling rows past the cutoff back to generating and logs it', async () => {
    let orphanResetVals = null;
    let orphanResetHadLt = false;
    tableData.creatives = {
      list: (ctx) => {
        const targetsPolling = ctx.eqCalls.some(([col, val]) => col === 'status' && val === 'polling');
        if (ctx.wasUpdate && targetsPolling) {
          orphanResetVals = ctx.updateVals;
          orphanResetHadLt = ctx.hadLt;
          return { data: [{ id: 'orphan1' }], error: null };
        }
        // stale-pending select / dependent-video count checks → no-op
        return { data: [], error: null, count: 0 };
      },
    };
    tableData.pipeline_log = { insert: vi.fn(async () => ({ error: null })) };

    const { cleanup_stale } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ user: ADMIN });
    await cleanup_stale(req, res);

    expect(orphanResetVals).toEqual({ status: 'generating', polling_started_at: null });
    expect(orphanResetHadLt).toBe(true);
    expect(tableData.pipeline_log.insert).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CLEANUP', message: expect.stringContaining('orphaned') })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reset_orphaned_polling: 1 }));
  });

  it('does nothing extra when there are no orphaned polling rows', async () => {
    tableData.creatives = { list: () => ({ data: [], error: null, count: 0 }) };
    tableData.pipeline_log = { insert: vi.fn(async () => ({ error: null })) };

    const { cleanup_stale } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ user: ADMIN });
    await cleanup_stale(req, res);

    expect(res.json).toHaveBeenCalledWith({ deleted: 0, total_checked: 0, reset_orphaned_polling: 0 });
    // Only the unconditional "Cleaned N stale" summary log — no orphan-reset log fired.
    expect(tableData.pipeline_log.insert).toHaveBeenCalledTimes(1);
  });

  it('stays admin-gated (unchanged contract)', async () => {
    const { cleanup_stale } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ user: { role: 'member', permissions: [], store_access: [] } });
    await cleanup_stale(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Phase A (soft-archive legacy NULL-store_id creatives): adds creatives.deleted_at
// (sql/archive-null-store-id-creatives.sql) and marks legacy store_id IS NULL
// rows archived. This proves the two read paths that list/sweep creatives now
// filter out archived rows:
//
//   1. api/creatives/list.js — the dashboard creative gallery (Studio.jsx /
//      ProductWorkspace.jsx) must not surface an archived row.
//   2. lib/actions/creatives.js cleanup_stale — the stale-pending sweep must not
//      pick up an already-archived row for hard deletion, which would silently
//      break the "fully reversible via deleted_at = NULL" guarantee.
//
// Mocking technique mirrors tests/standalone-routes-permissions.test.js /
// tests/creatives-poll.test.js (generic configurable Supabase query-builder
// mock, captured per table so assertions can inspect which chain methods were
// called and with what arguments).
// ---------------------------------------------------------------------------

let tableData = {};
let builderLog = {};

function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    filter: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: row, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single() : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list() : { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  (builderLog[table] = builderLog[table] || []).push(builder);
  return builder;
}

/** True if any query built against `table` called `.is(col, val)`. */
function anyBuilderCalledIs(table, col, val) {
  return (builderLog[table] || []).some((b) =>
    b.is.mock.calls.some(([c, v]) => c === col && v === val)
  );
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => makeBuilder(table),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage.test/x.png' } }),
      }),
    },
  }),
}));

vi.mock('../lib/auth.js', () => ({ withAuth: (handler) => handler }));

function mockReqRes({ body = {}, query = {}, user, method } = {}) {
  const req = { body, query, headers: {}, user, method };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  builderLog = {};
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
});

describe('api/creatives/list.js filters archived rows', () => {
  it('applies .is("deleted_at", null) to the store-scoped list query', async () => {
    tableData.creatives = { list: () => ({ data: [], error: null }) };

    const { default: handler } = await import('../api/creatives/list.js');
    const { req, res } = mockReqRes({ method: 'GET', query: { store_id: 's1' }, user: ADMIN });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(anyBuilderCalledIs('creatives', 'deleted_at', null)).toBe(true);
  });
});

describe('lib/actions/creatives.js cleanup_stale filters archived rows', () => {
  it('applies .is("deleted_at", null) to the stale-pending sweep, so an archived row is never hard-deleted', async () => {
    tableData.creatives = { list: () => ({ data: [], error: null, count: 0 }) };
    tableData.pipeline_log = { insert: vi.fn(async () => ({ error: null })) };

    const { cleanup_stale } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ user: ADMIN });
    await cleanup_stale(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(anyBuilderCalledIs('creatives', 'deleted_at', null)).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// import_reviews_csv with `product_ids` — one review file copied onto several
// products of a collection (the Reviews panel's "Collection" import mode).
// The single-product path (no product_ids) is covered by the existing tests in
// tests/reviews-dedup-race.test.js and tests/rate-limit-per-tenant.test.js.
// ---------------------------------------------------------------------------

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

// Supabase mock that remembers eq()/in() filters, so a table's list() can answer
// per product (e.g. "which reviews already exist for product p2").
let tableData = {};
const calls = { inserts: {} };
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const filters = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((k, v) => { filters[k] = v; return builder; }),
    in: vi.fn((k, v) => { filters[k] = v; return builder; }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    insert: vi.fn((rows) => {
      (calls.inserts[table] ||= []).push(rows);
      const c = cfg();
      const result = c.insert ? c.insert(rows) : { data: null, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single(filters) : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list(filters) : { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table) => makeBuilder(table) }) }));

const admin = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
function mockReqRes(body) {
  const req = { body, headers: {}, user: admin };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const CSV = [
  'author,rating,title,body,date,photo_url,verified',
  'Jane D.,5,Great,Loved it,2026-09-01,,',
  'Mia K.,4,Good,Runs a bit small,2026-09-02,,',
].join('\n');

// Products that exist in store s1.
function storeOwns(...ids) {
  tableData.products = {
    list: (f) => ({ data: (f.id || []).filter((id) => ids.includes(id)).map((id) => ({ id })), error: null }),
  };
}

const reviewInserts = () => calls.inserts.product_reviews || [];
const insertedRows = () => reviewInserts().flatMap((r) => (Array.isArray(r) ? r : [r]));

beforeEach(() => {
  vi.resetModules();
  tableData = { pipeline_log: { insert: () => ({ error: null }) } };
  calls.inserts = {};
  rateLimitMock.mockClear().mockResolvedValue(true);
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
});

async function runImport(body) {
  const { import_reviews_csv } = await import('../lib/actions/reviews-import.js');
  const { req, res } = mockReqRes({ store_id: 's1', csv: CSV, ...body });
  await import_reviews_csv(req, res);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe('import_reviews_csv — product_ids (collection import)', () => {
  it('copies every valid row onto each selected product', async () => {
    storeOwns('p1', 'p2', 'p3');
    const { status, body } = await runImport({ product_id: 'p1', product_ids: ['p2', 'p3'] });

    expect(status).toBe(200);
    expect(body.inserted).toBe(6);
    expect(body.products).toBe(3);
    const byProduct = (pid) => insertedRows().filter((r) => r.product_id === pid).map((r) => r.author);
    expect(byProduct('p1')).toEqual(['Jane D.', 'Mia K.']);
    expect(byProduct('p2')).toEqual(['Jane D.', 'Mia K.']);
    expect(byProduct('p3')).toEqual(['Jane D.', 'Mia K.']);
    expect(insertedRows().every((r) => r.status === 'pending' && r.source === 'csv' && r.store_id === 's1')).toBe(true);
  });

  it('always includes the current product and ignores repeated ids', async () => {
    storeOwns('p1', 'p2');
    const { body } = await runImport({ product_id: 'p1', product_ids: ['p2', 'p2', 'p1'] });

    expect(body.products).toBe(2);
    expect(body.inserted).toBe(4);
  });

  it('inserts each product as one batch when nothing collides', async () => {
    storeOwns('p1', 'p2', 'p3');
    await runImport({ product_id: 'p1', product_ids: ['p2', 'p3'] });

    expect(reviewInserts()).toHaveLength(3);
    expect(reviewInserts().every((batch) => Array.isArray(batch) && batch.length === 2)).toBe(true);
  });

  it('refuses the whole import when any product is not in the store', async () => {
    storeOwns('p1', 'p2');
    const { status } = await runImport({ product_id: 'p1', product_ids: ['p2', 'p-other-store'] });

    expect(status).toBe(404);
    expect(reviewInserts()).toHaveLength(0);
  });

  it('refuses more than 50 products', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `p${i + 2}`);
    storeOwns('p1', ...ids);
    const { status } = await runImport({ product_id: 'p1', product_ids: ids });

    expect(status).toBe(400);
    expect(reviewInserts()).toHaveLength(0);
  });

  it('refuses an import that would create more than 3000 rows', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i + 2}`);
    storeOwns('p1', ...ids);
    const rows = Array.from({ length: 100 }, (_, i) => `Author ${i},5,T,Body ${i},2026-09-01,,`);
    const bigCsv = ['author,rating,title,body,date,photo_url,verified', ...rows].join('\n');
    const { status } = await runImport({ product_id: 'p1', product_ids: ids, csv: bigCsv }); // 100 × 31 = 3100

    expect(status).toBe(400);
    expect(reviewInserts()).toHaveLength(0);
  });

  it('skips reviews a product already has, per product', async () => {
    storeOwns('p1', 'p2');
    tableData.product_reviews = {
      list: (f) => ({ data: f.product_id === 'p2' ? [{ author: 'Jane D.', body: 'Loved it' }] : [], error: null }),
    };
    const { body } = await runImport({ product_id: 'p1', product_ids: ['p2'] });

    expect(body.inserted).toBe(3);
    expect(body.duplicates).toBe(1);
    expect(insertedRows().filter((r) => r.product_id === 'p2').map((r) => r.author)).toEqual(['Mia K.']);
    expect(body.per_product).toEqual([
      { product_id: 'p1', inserted: 2, duplicates: 0 },
      { product_id: 'p2', inserted: 1, duplicates: 1 },
    ]);
  });

  it('falls back to row-by-row for a product whose batch hits a concurrent duplicate', async () => {
    storeOwns('p1', 'p2');
    tableData.product_reviews = {
      insert: (rows) => {
        // p2's batch collides (a concurrent import won "Jane D."); the retry inserts row by row.
        if (Array.isArray(rows) && rows[0].product_id === 'p2') return { error: { code: '23505' } };
        if (!Array.isArray(rows) && rows.product_id === 'p2' && rows.author === 'Jane D.') return { error: { code: '23505' } };
        return { error: null };
      },
    };
    const { status, body } = await runImport({ product_id: 'p1', product_ids: ['p2'] });

    expect(status).toBe(200);
    expect(body.inserted).toBe(3);
    expect(body.duplicates).toBe(1);
  });

  it('writes one pipeline_log entry that names the product count', async () => {
    storeOwns('p1', 'p2', 'p3');
    await runImport({ product_id: 'p1', product_ids: ['p2', 'p3'] });

    const logs = calls.inserts.pipeline_log || [];
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toMatch(/3 products/);
    expect(logs[0].agent).toBe('REVIEWS');
    expect(logs[0].initiator).toBe('user');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// AUDIT-2026-08 P2: import_reviews_csv (reviews-import.js) and
// generate_reviews_ai (reviews-ai.js) pre-check for duplicates via
// dropExistingDuplicates() before inserting, but that SELECT-then-INSERT is
// a TOCTOU race — a concurrent import/generate/web-submit can insert the
// same (store_id, product_id, author, md5(body)) row in the window between
// the pre-check and the insert. Previously the bulk `.insert(rows)` would
// then fail the ENTIRE batch with an unhandled Postgres 23505
// (unique_violation), 500ing a request that should have just skipped one
// row. Both handlers now insert via insertReviewsTolerant (reviews-shared.js
// — unit-tested directly in tests/reviews-shared.test.js), which inserts one
// row at a time and treats 23505 as "already there, skip it". These tests
// prove the two call sites are actually wired to that behavior end-to-end:
// a mid-batch 23505 is caught, the batch completes, and the response
// reports the split instead of the request 500ing.
// ---------------------------------------------------------------------------

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

// Generic configurable Supabase mock (same technique as
// tests/rate-limit-per-tenant.test.js / tests/publications.test.js).
let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
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
      const result = c.list ? c.list() : { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table) => makeBuilder(table) }) }));

vi.mock('@anthropic-ai/sdk', () => ({
  // Must be a real constructable function — reviews-ai.js does `new Anthropic(...)`.
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            text: JSON.stringify([
              { author: 'Maria', rating: 5, title: 'Great', body: 'Loved it' },
              { author: 'Jennifer', rating: 4, title: 'Good', body: 'Pretty good fit' },
              { author: 'Diane', rating: 5, title: 'Perfect', body: 'Exactly as pictured' },
            ]),
          }],
        }),
      },
    };
  }),
}));

const admin = (user_id) => ({ role: 'admin', user_id, permissions: [], store_access: [] });
function mockReqRes(body) {
  const req = { body, headers: {}, user: admin('u1') };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

// Force the 2nd product_reviews insert in a batch to 23505 — simulates a concurrent
// request winning the race for that one row between the pre-check and this insert.
function conflictOnSecondInsert() {
  let call = 0;
  const attempts = [];
  const insert = (row) => {
    call += 1;
    attempts.push(row);
    if (call === 2) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_product_reviews_dedup"' } };
    return { error: null };
  };
  return { insert, attempts: () => attempts };
}

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  rateLimitMock.mockClear().mockResolvedValue(true);
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
});

describe('import_reviews_csv — TOCTOU tolerance', () => {
  const CSV = [
    'author,rating,title,body,date,photo_url,verified',
    'Maria,5,Great,Loved it,2024-06-10,,1',
    'Jennifer,4,Good,Pretty good fit,2024-06-11,,0',
    'Diane,5,Perfect,Exactly as pictured,2024-06-12,,0',
  ].join('\n');

  it('catches a mid-batch 23505, inserts the rest, and reports it as a duplicate — no throw, no 500', async () => {
    tableData.products = { single: () => ({ data: { id: 'p1' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const conflict = conflictOnSecondInsert();
    tableData.product_reviews = { insert: conflict.insert }; // list() defaults to [] — pre-check finds nothing

    const { import_reviews_csv } = await import('../lib/actions/reviews-import.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', csv: CSV });

    await import_reviews_csv(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.inserted).toBe(2);
    expect(body.duplicates).toBe(1); // race-caught 23505 folded into the existing duplicates count
    expect(body.skipped).toBe(0); // 3 valid CSV rows, none malformed
    expect(conflict.attempts()).toHaveLength(3); // every row was attempted, batch wasn't aborted
  });
});

describe('generate_reviews_ai — TOCTOU tolerance', () => {
  it('catches a mid-batch 23505, inserts the rest, and reports skipped_duplicates — no throw, no 500', async () => {
    tableData.products = { single: () => ({ data: { title: 'Test Product', description: 'A product' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const conflict = conflictOnSecondInsert();
    tableData.product_reviews = { insert: conflict.insert };

    const { generate_reviews_ai } = await import('../lib/actions/reviews-ai.js');
    const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', count: 3, tone: 'positive' });

    await generate_reviews_ai(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.inserted).toBe(2);
    expect(body.skipped_duplicates).toBe(1);
    expect(conflict.attempts()).toHaveLength(3);
  });
});

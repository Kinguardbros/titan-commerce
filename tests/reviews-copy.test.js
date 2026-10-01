import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// copy_reviews_to_products — copy a product's live reviews onto one other product
// of the same store (the Reviews panel's "Copy to collection…", which calls it once
// per selected product).
// ---------------------------------------------------------------------------

vi.mock('../lib/store-context.js', () => ({
  getStore: vi.fn(async (id) => ({ id, slug: 'isola', name: 'Isola' })),
}));

const BUCKET_URL = 'https://x.supabase.co/storage/v1/object/public/store-docs/';
let tableData = {};
const calls = { inserts: {}, copies: [] };
let copyFails = () => false;

function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const filters = {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((k, v) => { filters[k] = v; return builder; }),
    in: vi.fn((k, v) => { filters[k] = v; return builder; }),
    is: vi.fn((k, v) => { filters[`is:${k}`] = v; return builder; }),
    order: vi.fn(() => builder),
    insert: vi.fn((rows) => {
      (calls.inserts[table] ||= []).push(rows);
      const c = cfg();
      const result = c.insert ? c.insert(rows) : { data: null, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list(filters) : { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}
const storage = {
  from: () => ({
    copy: vi.fn(async (from, to) => {
      calls.copies.push({ from, to });
      return copyFails(from) ? { data: null, error: { message: 'not found' } } : { data: { path: to }, error: null };
    }),
    getPublicUrl: (path) => ({ data: { publicUrl: `${BUCKET_URL}${path}` } }),
  }),
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t) => makeBuilder(t), storage }) }));

const admin = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
const member = { role: 'member', user_id: 'u2', permissions: ['products:read'], store_access: ['s1'] };

const SOURCE = [
  { author: 'Jane D.', rating: 5, title: 'Love it', body: 'Fits great', review_date: '2026-05-01', status: 'published', source: 'amazon', verified: true, helpful_count: 12, photo_url: `${BUCKET_URL}isola/Reviews/src/photo_1.jpg`, photo_urls: [`${BUCKET_URL}isola/Reviews/src/photo_1.jpg`, 'https://cdn.example.com/ext.jpg'] },
  { author: 'Mia K.', rating: 4, title: null, body: 'Runs small', review_date: '2026-05-02', status: 'approved', source: 'csv', verified: false, helpful_count: 3, photo_url: null, photo_urls: null },
  { author: 'Pending P.', rating: 5, title: null, body: 'Not live yet', review_date: '2026-05-03', status: 'pending', source: 'web', verified: false, helpful_count: 0, photo_url: null, photo_urls: null },
  { author: 'Rejected R.', rating: 1, title: null, body: 'Spam', review_date: '2026-05-04', status: 'rejected', source: 'web', verified: false, helpful_count: 0, photo_url: null, photo_urls: null },
  { author: 'Johnnie H.', rating: 5, title: 'Love it!', body: 'Bought on shapermint', review_date: '2026-09-29', status: 'published', source: 'stamped', origin_site: 'shapermint.com', verified: false, helpful_count: 0, photo_url: null, photo_urls: null },
];

function setup({ owned = ['src', 'tgt'], targetHas = [] } = {}) {
  tableData = {
    pipeline_log: { insert: () => ({ error: null }) },
    products: {
      list: (f) => ({ data: (f.id || []).filter((id) => owned.includes(id)).map((id) => ({ id, title: `Product ${id}` })), error: null }),
    },
    product_reviews: {
      list: (f) => {
        if (f.product_id === 'src') {
          return { data: SOURCE.filter((r) => (f.status || []).includes(r.status) && (!('is:origin_site' in f) || !r.origin_site)), error: null };
        }
        if (f.product_id === 'tgt') return { data: targetHas, error: null };
        return { data: [], error: null };
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  calls.inserts = {};
  calls.copies = [];
  copyFails = () => false;
  vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
});

async function run(body, user = admin) {
  const { copy_reviews_to_products } = await import('../lib/actions/reviews-copy.js');
  const req = { body: { store_id: 's1', source_product_id: 'src', target_product_id: 'tgt', ...body }, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await copy_reviews_to_products(req, res);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}
const inserted = () => (calls.inserts.product_reviews || []).flatMap((r) => (Array.isArray(r) ? r : [r]));

describe('copy_reviews_to_products', () => {
  it('copies only the live reviews, as pending copies on the target', async () => {
    setup();
    const { status, body } = await run({});

    expect(status).toBe(200);
    expect(body.copied).toBe(2);
    expect(inserted().map((r) => r.author)).toEqual(['Jane D.', 'Mia K.']);
    for (const r of inserted()) {
      expect(r).toMatchObject({ store_id: 's1', product_id: 'tgt', status: 'pending', verified: false, helpful_count: 0 });
    }
    expect(inserted().map((r) => r.source)).toEqual(['amazon', 'csv']);
  });

  it('never copies a syndicated review (origin_site): it belongs only to the identical product it was imported for', async () => {
    setup();
    const { status } = await run({});

    expect(status).toBe(200);
    expect(inserted().map((r) => r.author)).not.toContain('Johnnie H.');
  });

  it('skips reviews the target product already has', async () => {
    setup({ targetHas: [{ author: 'Jane D.', body: 'Fits great' }] });
    const { body } = await run({});

    expect(body.copied).toBe(1);
    expect(body.duplicates).toBe(1);
    expect(inserted().map((r) => r.author)).toEqual(['Mia K.']);
    expect(calls.copies).toHaveLength(0); // a skipped review's photos are not copied
  });

  it("gives every copy its own file in the target product's folder", async () => {
    setup();
    const { body } = await run({});

    expect(calls.copies).toHaveLength(1);
    expect(calls.copies[0].from).toBe('isola/Reviews/src/photo_1.jpg');
    expect(calls.copies[0].to).toMatch(/^isola\/Reviews\/tgt\/copy_\d+_0\.jpg$/);
    const jane = inserted().find((r) => r.author === 'Jane D.');
    expect(jane.photo_urls[0]).toBe(`${BUCKET_URL}${calls.copies[0].to}`);
    expect(jane.photo_urls[1]).toBe('https://cdn.example.com/ext.jpg'); // not ours: kept as is
    expect(jane.photo_url).toBe(jane.photo_urls[0]);
    expect(body.photos_copied).toBe(1);
  });

  it('drops a photo whose copy fails instead of sharing the original file', async () => {
    setup();
    copyFails = () => true;
    const { status, body } = await run({});

    expect(status).toBe(200);
    const jane = inserted().find((r) => r.author === 'Jane D.');
    expect(jane.photo_urls).toEqual(['https://cdn.example.com/ext.jpg']);
    expect(jane.photo_url).toBe('https://cdn.example.com/ext.jpg');
    expect(body.photos_failed).toBe(1);
  });

  it('refuses to copy a product onto itself', async () => {
    setup();
    const { status } = await run({ target_product_id: 'src' });

    expect(status).toBe(400);
    expect(inserted()).toHaveLength(0);
  });

  it('refuses a target product from another store', async () => {
    setup({ owned: ['src'] });
    const { status } = await run({});

    expect(status).toBe(404);
    expect(inserted()).toHaveLength(0);
  });

  it('requires products:edit', async () => {
    setup();
    const { status } = await run({}, member);

    expect(status).toBe(403);
    expect(inserted()).toHaveLength(0);
  });

  it('logs one pipeline_log entry for the copy', async () => {
    setup();
    await run({});

    const logs = calls.inserts.pipeline_log || [];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ store_id: 's1', agent: 'REVIEWS', initiator: 'user', user_id: 'u1' });
    expect(logs[0].message).toMatch(/Copied 2 review/);
  });
});

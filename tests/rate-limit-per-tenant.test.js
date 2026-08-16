import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P0-8 (Docs/AUDIT-2026-08.md): 7 rate-limited actions used a fixed literal
// string key — ONE shared bucket across every store and every user, platform-
// wide. This file proves each call site now composes a per-store + per-user
// key (`${action}:${store_id}:${user_id}`) before calling rateLimit(),
// mirroring the pattern already used in lib/actions/publications.js
// (bulk_publish:${store_id}) and lib/actions/reviews-amazon.js
// (amazon_scrape:${user_id}).
//
// rateLimit()'s own counting logic (allow-under/block-at/fail-open) is
// already covered by tests/rate-limit.test.js — it isn't retested here.
// What IS under test: (1) the exact key string each call site passes, and
// (2) that two different tenants hitting the SAME action never share a
// counter — the actual bug. We stand in a small in-memory per-key counter
// for rateLimit() so we can deterministically pre-seed a bucket at its cap
// without looping N times per test.
// ---------------------------------------------------------------------------

const rlCounts = new Map();
const rateLimitMock = vi.fn(async (key, max) => {
  const n = (rlCounts.get(key) || 0) + 1;
  rlCounts.set(key, n);
  return n <= max;
});
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

// ---- generic configurable Supabase mock (same technique as
// tests/standalone-routes-permissions.test.js / tests/publications.test.js) --
let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    or: vi.fn(() => builder),
    not: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
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
      const result = c.list ? c.list() : { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => makeBuilder(table),
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage.test/x.png' } }),
      }),
    },
  }),
}));

vi.mock('../lib/auth.js', () => ({ withAuth: (handler) => handler }));

vi.mock('../lib/store-context.js', () => ({
  getStore: vi.fn().mockResolvedValue({
    id: 's1', name: 'Test Store', slug: 'test-store', admin_token: 't', shopify_url: 'x.myshopify.com',
  }),
}));

vi.mock('../lib/higgsfield.js', () => ({
  buildStyledPrompt: vi.fn().mockResolvedValue('prompt'),
  buildPrompt: vi.fn().mockReturnValue('prompt'),
  generateFluxKontext: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png' }),
  generateImage: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png', jobId: 'job1' }),
  generateVideo: vi.fn().mockResolvedValue({ url: 'https://vid.test/x.mp4', jobId: 'job1' }),
}));
vi.mock('../lib/fal.js', () => ({
  submitFalJob: vi.fn().mockResolvedValue({ requestId: 'r1', pollBase: 'base' }),
  checkFalJob: vi.fn().mockResolvedValue({ status: 'completed', url: 'https://img.test/x.png' }),
}));
vi.mock('../lib/v4-prompt.js', () => ({ V4_PROMPT_BODY: 'v4' }));
vi.mock('../lib/v5-prompt.js', () => ({ V5_PROMPT_BODY: 'v5' }));
vi.mock('../lib/v6-prompt.js', () => ({ V6_PROMPT_BODY: 'v6' }));
vi.mock('../lib/v7-prompt.js', () => ({ V7_PROMPT_BODY: 'v7' }));
vi.mock('../lib/v8-prompt.js', () => ({
  V8_PROMPT_BODY_TEMPLATE: 'v8',
  detectV8ColorClass: vi.fn(() => 'print'),
  buildV8LightingBlock: vi.fn(() => ''),
  buildV8DoNotBlock: vi.fn(() => ''),
}));
vi.mock('../lib/v9-prompt.js', () => ({ V9_PROMPT_BODY: 'v9' }));
vi.mock('../lib/v10-prompt.js', () => ({ V10_PROMPT_BODY: 'v10' }));
vi.mock('../lib/avatar-crop.js', () => ({ processCatalogImage: vi.fn(async (buf) => buf) }));
vi.mock('../lib/v3-beach-scenes.js', () => ({ buildV3BeachPrompt: vi.fn(() => 'prompt') }));
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({ graphql: vi.fn(), updateProductStatus: vi.fn() }),
  updateProduct: vi.fn().mockResolvedValue({}),
  updateVariant: vi.fn().mockResolvedValue({}),
  updateProductOptions: vi.fn().mockResolvedValue({}),
  getProductVariants: vi.fn().mockResolvedValue(null),
}));
vi.mock('@higgsfield/client/v2', () => ({
  higgsfield: { subscribe: vi.fn().mockResolvedValue({ id: 'job1' }) },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  // Must be a real constructable function (not an arrow) — both lib/claude.js and
  // lib/actions/reviews-ai.js do `new Anthropic(...)`.
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ text: '[{"author":"Jane","rating":5,"title":"Great","body":"Loved it"}]' }],
        }),
      },
    };
  }),
}));
// lib/actions/optimizations.js imports optimizeProduct from lib/claude.js, which
// constructs its own Anthropic client at module load — mock the whole module so
// the "sacred" prompt logic in claude.js is never exercised by this unrelated test.
vi.mock('../lib/claude.js', () => ({ optimizeProduct: vi.fn().mockResolvedValue({ title: 'Optimized' }) }));

function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({
      status: 'completed',
      images: [{ url: 'https://img.test/x.png' }],
      video: { url: 'https://vid.test/x.mp4' },
    }),
  })));
}

function mockReqRes({ body = {}, query = {}, user, method = 'POST' } = {}) {
  const req = { body, query, headers: {}, user, method };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const admin = (user_id) => ({ role: 'admin', user_id, permissions: [], store_access: [] });

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  rlCounts.clear();
  rateLimitMock.mockClear();
  installFetchMock();
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
});

// =========================================================================
// api/creatives/generate.js — key: generate:${store_id}:${user_id}, cap 20/hr
// =========================================================================
describe('api/creatives/generate.js — per-store + per-user rate limit key', () => {
  let handler;
  beforeEach(async () => {
    tableData.products = { single: () => ({ data: { id: 'p1', title: 'T', images: '[]', tags: '[]', store_id: 's1' }, error: null }) };
    tableData.stores = { single: () => ({ data: { shopify_url: 'x.myshopify.com', name: 'Test Store' }, error: null }) };
    tableData.creatives = { single: () => ({ data: { id: 'cr1' }, error: null }) };
    const mod = await import('../api/creatives/generate.js');
    handler = mod.default;
  });

  it('keys the rate limit as generate:${store_id}:${user_id}', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: admin('u1') });
    await handler(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('generate:s1:u1', 20, 3600000);
  });

  it('falls back to "master" in the key when the caller has no user_id/username (master token)', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: { master: true, role: 'admin' } });
    await handler(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('generate:s1:master', 20, 3600000);
  });

  it('two different stores do not share a bucket — one store at cap does not block the other', async () => {
    rlCounts.set('generate:s1:u1', 20); // store s1 / user u1 already exhausted its 20/hr
    const { req: reqA, res: resA } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: admin('u1') });
    await handler(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    const { req: reqB, res: resB } = mockReqRes({ body: { product_id: 'p1', store_id: 's2' }, user: admin('u1') });
    await handler(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429); // s2 bucket is untouched
  });

  it('429s once the caller\'s own store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('generate:s1:u2', 20);
    const { req, res } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: admin('u2') });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// api/creatives/regenerate.js — store_id resolved from the creatives row
// (P0-1). key: regenerate:${store_id}:${user_id}, cap 20/hr
// =========================================================================
describe('api/creatives/regenerate.js — per-store + per-user rate limit key', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = {
      single: () => ({
        data: {
          id: 'c1', store_id: 's1', format: 'video', variant_index: 0, brief_id: null, product_id: 'p1',
          metadata: JSON.stringify({ source_image_url: 'https://img.test/src.png' }),
        },
        error: null,
      }),
    };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../api/creatives/regenerate.js');
    handler = mod.default;
  });

  it('keys the rate limit as regenerate:${store_id}:${user_id}, resolved from the creatives row', async () => {
    const { req, res } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u1') });
    await handler(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('regenerate:s1:u1', 20, 3600000);
  });

  it('two different stores (different creatives rows) do not share a bucket', async () => {
    rlCounts.set('regenerate:s1:u1', 20);
    const { req: reqA, res: resA } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u1') });
    await handler(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    tableData.creatives.single = () => ({
      data: {
        id: 'c2', store_id: 's2', format: 'video', variant_index: 0, brief_id: null, product_id: 'p1',
        metadata: JSON.stringify({ source_image_url: 'https://img.test/src.png' }),
      },
      error: null,
    });
    const { req: reqB, res: resB } = mockReqRes({ body: { creative_id: 'c2' }, user: admin('u1') });
    await handler(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the resolved store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('regenerate:s1:u3', 20);
    const { req, res } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u3') });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// api/creatives/convert-to-video.js — store_id resolved from the source
// creative row (P0-1). key: convert-to-video:${store_id}:${user_id}, cap 10/hr
// =========================================================================
describe('api/creatives/convert-to-video.js — per-store + per-user rate limit key', () => {
  let handler;
  beforeEach(async () => {
    tableData.creatives = {
      single: () => ({ data: { id: 'c1', store_id: 's1', format: 'image', product_id: 'p1', style: 'ad_creative', file_url: 'https://img.test/src.png' }, error: null }),
      insert: () => ({ data: { id: 'c2' }, error: null }),
    };
    tableData.products = { single: () => ({ data: { handle: 'x', title: 'T' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../api/creatives/convert-to-video.js');
    handler = mod.default;
  });

  it('keys the rate limit as convert-to-video:${store_id}:${user_id}, resolved from the source creative row', async () => {
    const { req, res } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u1') });
    await handler(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('convert-to-video:s1:u1', 10, 3600000);
  });

  it('two different stores do not share a bucket', async () => {
    rlCounts.set('convert-to-video:s1:u1', 10);
    const { req: reqA, res: resA } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u1') });
    await handler(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    tableData.creatives.single = () => ({ data: { id: 'c9', store_id: 's2', format: 'image', product_id: 'p1', style: 'ad_creative', file_url: 'https://img.test/src.png' }, error: null });
    const { req: reqB, res: resB } = mockReqRes({ body: { creative_id: 'c9' }, user: admin('u1') });
    await handler(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the resolved store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('convert-to-video:s1:u4', 10);
    const { req, res } = mockReqRes({ body: { creative_id: 'c1' }, user: admin('u4') });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// lib/actions/optimizations.js optimize_product — store_id resolved from the
// product row. key: optimize_product:${store_id}:${user_id}, cap 30/hr
// =========================================================================
describe('lib/actions/optimizations.js optimize_product — per-store + per-user rate limit key', () => {
  let optimize_product;
  beforeEach(async () => {
    tableData.products = { single: () => ({ data: { id: 'p1', title: 'T', description: '', price: 10, product_type: '', tags: '[]', images: '[]', store_id: 's1', shopify_id: null }, error: null }) };
    tableData.product_optimizations = { single: () => ({ data: { id: 'opt1' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../lib/actions/optimizations.js');
    optimize_product = mod.optimize_product;
  });

  it('keys the rate limit as optimize_product:${store_id}:${user_id}, resolved from the product row', async () => {
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: admin('u1') });
    await optimize_product(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('optimize_product:s1:u1', 30, 3600000);
  });

  it('two different stores do not share a bucket', async () => {
    rlCounts.set('optimize_product:s1:u1', 30);
    const { req: reqA, res: resA } = mockReqRes({ body: { product_id: 'p1' }, user: admin('u1') });
    await optimize_product(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    tableData.products.single = () => ({ data: { id: 'p2', title: 'T2', description: '', price: 10, product_type: '', tags: '[]', images: '[]', store_id: 's2', shopify_id: null }, error: null });
    const { req: reqB, res: resB } = mockReqRes({ body: { product_id: 'p2' }, user: admin('u1') });
    await optimize_product(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the resolved store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('optimize_product:s1:u5', 30);
    const { req, res } = mockReqRes({ body: { product_id: 'p1' }, user: admin('u5') });
    await optimize_product(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// lib/actions/creatives.js generate_branded — store_id straight from body.
// key: generate_branded:${store_id}:${user_id}, cap 20/hr
// =========================================================================
describe('lib/actions/creatives.js generate_branded — per-store + per-user rate limit key', () => {
  let generate_branded;
  beforeEach(async () => {
    tableData.creatives = { single: () => ({ data: { id: 'cb1' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../lib/actions/creatives.js');
    generate_branded = mod.generate_branded;
  });

  it('keys the rate limit as generate_branded:${store_id}:${user_id}', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 's1', prompt: 'A lovely beach shot' }, user: admin('u1') });
    await generate_branded(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('generate_branded:s1:u1', 20, 3600000);
  });

  it('two different stores do not share a bucket', async () => {
    rlCounts.set('generate_branded:s1:u1', 20);
    const { req: reqA, res: resA } = mockReqRes({ body: { store_id: 's1', prompt: 'p' }, user: admin('u1') });
    await generate_branded(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    const { req: reqB, res: resB } = mockReqRes({ body: { store_id: 's2', prompt: 'p' }, user: admin('u1') });
    await generate_branded(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('generate_branded:s1:u6', 20);
    const { req, res } = mockReqRes({ body: { store_id: 's1', prompt: 'p' }, user: admin('u6') });
    await generate_branded(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// lib/actions/reviews-import.js import_reviews_csv — store_id straight from
// body. key: import_reviews_csv:${store_id}:${user_id}, cap 20/hr
// =========================================================================
describe('lib/actions/reviews-import.js import_reviews_csv — per-store + per-user rate limit key', () => {
  let import_reviews_csv;
  const CSV = 'author,rating,title,body,date,photo_url,verified\nJane,5,Great,Loved it,2024-06-10,,1';

  beforeEach(async () => {
    tableData.products = { single: () => ({ data: { id: 'p1' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../lib/actions/reviews-import.js');
    import_reviews_csv = mod.import_reviews_csv;
  });

  it('keys the rate limit as import_reviews_csv:${store_id}:${user_id}', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', csv: CSV }, user: admin('u1') });
    await import_reviews_csv(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('import_reviews_csv:s1:u1', 20, 3600000);
  });

  it('two different stores do not share a bucket', async () => {
    rlCounts.set('import_reviews_csv:s1:u1', 20);
    const { req: reqA, res: resA } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', csv: CSV }, user: admin('u1') });
    await import_reviews_csv(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    const { req: reqB, res: resB } = mockReqRes({ body: { store_id: 's2', product_id: 'p1', csv: CSV }, user: admin('u1') });
    await import_reviews_csv(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('import_reviews_csv:s1:u7', 20);
    const { req, res } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', csv: CSV }, user: admin('u7') });
    await import_reviews_csv(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

// =========================================================================
// lib/actions/reviews-ai.js generate_reviews_ai — store_id straight from
// body. key: generate_reviews:${store_id}:${user_id}, cap 20/hr
// =========================================================================
describe('lib/actions/reviews-ai.js generate_reviews_ai — per-store + per-user rate limit key', () => {
  let generate_reviews_ai;
  beforeEach(async () => {
    tableData.products = { single: () => ({ data: { title: 'T', description: 'D' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../lib/actions/reviews-ai.js');
    generate_reviews_ai = mod.generate_reviews_ai;
  });

  it('keys the rate limit as generate_reviews:${store_id}:${user_id}', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', count: 3, tone: 'positive' }, user: admin('u1') });
    await generate_reviews_ai(req, res);
    expect(rateLimitMock).toHaveBeenCalledWith('generate_reviews:s1:u1', 20, 3600000);
  });

  it('two different stores do not share a bucket', async () => {
    rlCounts.set('generate_reviews:s1:u1', 20);
    const { req: reqA, res: resA } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', count: 3 }, user: admin('u1') });
    await generate_reviews_ai(reqA, resA);
    expect(resA.status).toHaveBeenCalledWith(429);

    const { req: reqB, res: resB } = mockReqRes({ body: { store_id: 's2', product_id: 'p1', count: 3 }, user: admin('u1') });
    await generate_reviews_ai(reqB, resB);
    expect(resB.status).not.toHaveBeenCalledWith(429);
  });

  it('429s once the store+user bucket is exhausted (N+1th call)', async () => {
    rlCounts.set('generate_reviews:s1:u8', 20);
    const { req, res } = mockReqRes({ body: { store_id: 's1', product_id: 'p1', count: 3 }, user: admin('u8') });
    await generate_reviews_ai(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

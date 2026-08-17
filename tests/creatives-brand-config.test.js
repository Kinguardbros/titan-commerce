import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-11 (Docs/AUDIT-2026-08.md): Isola-specific hardcodes replaced with
// data-driven stores.brand_config JSONB.
//
// 1. api/creatives/generate.js — the `isIsola` name-substring check that
//    gated the HIGH-WAIST navel-hide prompt block is now
//    store.brand_config.features.high_waist_navel_hide (boolean).
// 2. lib/actions/creatives.js generate_branded — the hardcoded BRAND_CONTEXTS
//    dict keyed by store.slug is now store.brand_config.brand_voice, with a
//    generic `BRAND: ${name}` fallback for stores without one configured.
//
// Mocking technique mirrors tests/rate-limit-per-tenant.test.js /
// tests/standalone-routes-permissions.test.js (generic configurable Supabase
// builder + module mocks for the AI-provider surface).
// ---------------------------------------------------------------------------

let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    not: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: { id: 'new-id', ...row }, error: null };
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
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: (...args) => getStoreMock(...args) }));

const buildStyledPromptMock = vi.fn().mockResolvedValue('prompt');
vi.mock('../lib/higgsfield.js', () => ({
  buildStyledPrompt: (...args) => buildStyledPromptMock(...args),
  generateFluxKontext: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png' }),
  generateImage: vi.fn().mockResolvedValue({ url: 'https://img.test/x.png', jobId: 'job1' }),
}));

const submitFalJobMock = vi.fn().mockResolvedValue({ requestId: 'r1' });
vi.mock('../lib/fal.js', () => ({
  submitFalJob: (...args) => submitFalJobMock(...args),
  checkFalJob: vi.fn().mockResolvedValue({ status: 'completed', url: 'https://img.test/x.png' }),
}));

vi.mock('../lib/v4-prompt.js', () => ({ V4_PROMPT_BODY: 'V4_BODY_MARKER' }));
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
}));
vi.mock('@higgsfield/client/v2', () => ({
  higgsfield: { subscribe: vi.fn().mockResolvedValue({ id: 'job1' }) },
}));

function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({ status: 'completed', images: [{ url: 'https://img.test/x.png' }] }),
  })));
}

function mockReqRes({ body = {}, user } = {}) {
  const req = { body, headers: {}, user, method: 'POST' };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
const HIGH_WAIST_MARKER = 'HIGH-WAIST TUMMY-CONTROL — MANDATORY';

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  getStoreMock.mockReset();
  buildStyledPromptMock.mockClear().mockResolvedValue('prompt');
  submitFalJobMock.mockClear().mockResolvedValue({ requestId: 'r1' });
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  installFetchMock();
});

// =========================================================================
// api/creatives/generate.js — HIGH-WAIST navel-hide gating (P1-11)
// =========================================================================
describe('api/creatives/generate.js — HIGH-WAIST navel-hide gated by brand_config.features (P1-11)', () => {
  let handler;

  beforeEach(async () => {
    tableData.products = {
      single: () => ({
        data: { id: 'p1', title: 'Ocean Blue Swimsuit', images: '[]', tags: '[]', product_type: '', store_id: 's1' },
        error: null,
      }),
    };
    // Non-null store_skills row => the fire-and-forget product-skill auto-gen is skipped.
    tableData.store_skills = { single: () => ({ data: { id: 'sk1' }, error: null }) };
    tableData.pipeline_log = { list: () => ({ data: [], error: null }), insert: () => ({ data: {}, error: null }) };
    tableData.creatives = { single: () => ({ data: { id: 'c1' }, error: null }) };

    const mod = await import('../api/creatives/generate.js');
    handler = mod.default;
  });

  function requestFor(storeName, brandConfig) {
    tableData.stores = {
      single: () => ({
        data: { shopify_url: 'x.myshopify.com', name: storeName, brand_config: brandConfig },
        error: null,
      }),
    };
    return mockReqRes({
      body: {
        product_id: 'p1', store_id: 's1', style: 'product_catalog_v4',
        ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png',
      },
      user: ADMIN,
    });
  }

  it('injects the HIGH-WAIST block when brand_config.features.high_waist_navel_hide is true (Isola)', async () => {
    const { req, res } = requestFor('Isola', { features: { high_waist_navel_hide: true } });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(submitFalJobMock).toHaveBeenCalled();
    const sentPrompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(sentPrompt).toContain(HIGH_WAIST_MARKER);
  });

  it('does NOT inject the HIGH-WAIST block for a store without the flag (e.g. Elegance House)', async () => {
    const { req, res } = requestFor('Elegance House', {});
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const sentPrompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(sentPrompt).not.toContain(HIGH_WAIST_MARKER);
  });

  it('no longer keys off the store NAME containing "isola" — a differently-named store with the flag still gets it', async () => {
    const { req, res } = requestFor('Totally Different Brand', { features: { high_waist_navel_hide: true } });
    await handler(req, res);
    const sentPrompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(sentPrompt).toContain(HIGH_WAIST_MARKER);
  });

  it('falls back to false (no crash) when brand_config is null — backward compat for stores predating this migration', async () => {
    const { req, res } = requestFor('New Store', null);
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const sentPrompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(sentPrompt).not.toContain(HIGH_WAIST_MARKER);
  });

  it('falls back to false (no crash) when brand_config is a JSON string (legacy row shape)', async () => {
    const { req, res } = requestFor('Legacy Store', JSON.stringify({ features: { high_waist_navel_hide: true } }));
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const sentPrompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(sentPrompt).toContain(HIGH_WAIST_MARKER);
  });
});

// =========================================================================
// lib/actions/creatives.js generate_branded — brand context from
// brand_config.brand_voice, not a hardcoded dict (P1-11)
// =========================================================================
describe('lib/actions/creatives.js generate_branded — brand context reads store.brand_config.brand_voice (P1-11)', () => {
  let generate_branded;

  beforeEach(async () => {
    tableData.creatives = { single: () => ({ data: { id: 'cb1' }, error: null }) };
    tableData.pipeline_log = { insert: () => ({ error: null }) };
    const mod = await import('../lib/actions/creatives.js');
    generate_branded = mod.generate_branded;
  });

  it('uses store.brand_config.brand_voice verbatim, not a hardcoded per-slug dict', async () => {
    const customVoice = 'BRAND: Isola World — TOTALLY CUSTOM VOICE FOR THIS TEST, not the old hardcoded string.';
    getStoreMock.mockResolvedValue({
      id: 's1', slug: 'isola', name: 'Isola', shopify_url: 'x.myshopify.com',
      brand_config: { brand_voice: customVoice },
    });
    const { req, res } = mockReqRes({ body: { store_id: 's1', prompt: 'A lovely beach shot' }, user: ADMIN });
    await generate_branded(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(buildStyledPromptMock).toHaveBeenCalled();
    const customPrompt = buildStyledPromptMock.mock.calls[0][0].custom_prompt;
    expect(customPrompt).toContain(customVoice);
  });

  it('falls back to a generic "BRAND: <name>" prompt when brand_config has no brand_voice set', async () => {
    getStoreMock.mockResolvedValue({
      id: 's2', slug: 'eleganz-haus', name: 'Eleganz Haus', shopify_url: 'y.myshopify.com',
      brand_config: {},
    });
    const { req, res } = mockReqRes({ body: { store_id: 's2', prompt: 'A lovely shot' }, user: ADMIN });
    await generate_branded(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const customPrompt = buildStyledPromptMock.mock.calls[0][0].custom_prompt;
    expect(customPrompt).toContain('BRAND: Eleganz Haus');
  });

  it('falls back gracefully (no crash) when brand_config is null', async () => {
    getStoreMock.mockResolvedValue({
      id: 's3', slug: 'new-store', name: 'New Store', shopify_url: 'z.myshopify.com',
      brand_config: null,
    });
    const { req, res } = mockReqRes({ body: { store_id: 's3', prompt: 'A shot' }, user: ADMIN });
    await generate_branded(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const customPrompt = buildStyledPromptMock.mock.calls[0][0].custom_prompt;
    expect(customPrompt).toContain('BRAND: New Store');
  });
});

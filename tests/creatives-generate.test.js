import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-23 (Docs/AUDIT-2026-08.md): api/creatives/generate.js is a 929-line file
// CLAUDE.md flags as "churned heavily (5/10)" with zero test coverage before
// this. This file covers: ai_model → provider routing, the forced-2K-default
// resolution invariant, a spot-check of the Product Catalog v1/v4/v7 prompt
// bodies, the persona-avatar sandwich reference-image pattern, the P1-11
// HIGH-WAIST gate, and the P0-1 RBAC gates. Everything external (fal.ai,
// Higgsfield, Shopify, the raw @higgsfield/client/v2 SDK) is mocked — no real
// network calls.
//
// Mocking technique + generic Supabase builder copied verbatim from
// tests/creatives-brand-config.test.js / tests/standalone-routes-permissions.test.js
// (both already exercise this exact file) to stay consistent with the
// established convention.
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
    in: vi.fn(() => builder),
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

const buildStyledPromptMock = vi.fn().mockResolvedValue('MOCK_STYLED_PROMPT');
const generateFluxKontextMock = vi.fn().mockResolvedValue({ url: 'https://img.test/flux-result.png', jobId: 'hf-job-1' });
vi.mock('../lib/higgsfield.js', () => ({
  buildStyledPrompt: (...args) => buildStyledPromptMock(...args),
  generateFluxKontext: (...args) => generateFluxKontextMock(...args),
  generateImage: vi.fn(),
}));

const submitFalJobMock = vi.fn().mockResolvedValue({ requestId: 'r1', pollBase: 'pb1', completed: false });
vi.mock('../lib/fal.js', () => ({
  submitFalJob: (...args) => submitFalJobMock(...args),
  checkFalJob: vi.fn(),
}));

vi.mock('../lib/v4-prompt.js', () => ({ V4_PROMPT_BODY: 'V4_BODY_MARKER' }));
vi.mock('../lib/v5-prompt.js', () => ({ V5_PROMPT_BODY: 'V5_BODY_MARKER' }));
vi.mock('../lib/v6-prompt.js', () => ({ V6_PROMPT_BODY: 'V6_BODY_MARKER' }));
vi.mock('../lib/v7-prompt.js', () => ({ V7_PROMPT_BODY: 'V7_BODY_MARKER' }));
vi.mock('../lib/v8-prompt.js', () => ({
  V8_PROMPT_BODY_TEMPLATE: 'V8_BODY_MARKER __V8_LIGHTING_BLOCK__ - __V8_DO_NOT__',
  detectV8ColorClass: vi.fn(() => 'print'),
  buildV8LightingBlock: vi.fn(() => 'lighting'),
  buildV8DoNotBlock: vi.fn(() => '- do-not'),
}));
vi.mock('../lib/v9-prompt.js', () => ({ V9_PROMPT_BODY: 'V9_BODY_MARKER' }));
vi.mock('../lib/v10-prompt.js', () => ({ V10_PROMPT_BODY: 'V10_BODY_MARKER' }));

const higgsfieldSubscribeMock = vi.fn().mockResolvedValue({ id: 'soul-job-1' });
vi.mock('@higgsfield/client/v2', () => ({
  higgsfield: { subscribe: (...args) => higgsfieldSubscribeMock(...args) },
}));

function installFetchMock() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({ status: 'completed', images: [{ url: 'https://img.test/soul-result.png' }] }),
  })));
}

function mockReqRes({ body = {}, user } = {}) {
  const req = { body, headers: {}, user, method: 'POST' };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };

const PRODUCT_WITH_IMAGES = {
  id: 'p1', title: 'Ocean Blue One-Piece', images: JSON.stringify(['https://img.test/prod1.png', 'https://img.test/prod2.png']),
  tags: '[]', product_type: '', store_id: 's1',
};
const PRODUCT_NO_IMAGES = { ...PRODUCT_WITH_IMAGES, images: '[]' };

function setupDefaultTableData(product = PRODUCT_WITH_IMAGES, brandConfig = {}) {
  tableData.products = { single: () => ({ data: product, error: null }) };
  tableData.stores = { single: () => ({ data: { shopify_url: 'x.myshopify.com', name: 'Test Store', brand_config: brandConfig }, error: null }) };
  // Non-null store_skills row => the fire-and-forget product-skill auto-gen (Anthropic call) is skipped.
  tableData.store_skills = { single: () => ({ data: { id: 'sk1' }, error: null }) };
  tableData.pipeline_log = { list: () => ({ data: [], error: null }), insert: () => ({ data: {}, error: null }) };
  tableData.creatives = { single: () => ({ data: { id: 'c1' }, error: null }) };
  tableData.proposals = { list: () => ({ data: [], error: null, count: 0 }) };
}

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  buildStyledPromptMock.mockClear().mockResolvedValue('MOCK_STYLED_PROMPT');
  generateFluxKontextMock.mockClear().mockResolvedValue({ url: 'https://img.test/flux-result.png', jobId: 'hf-job-1' });
  submitFalJobMock.mockClear().mockResolvedValue({ requestId: 'r1', pollBase: 'pb1', completed: false });
  higgsfieldSubscribeMock.mockClear().mockResolvedValue({ id: 'soul-job-1' });
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  installFetchMock();
  setupDefaultTableData();
});

async function loadHandler() {
  const mod = await import('../api/creatives/generate.js');
  return mod.default;
}

describe('api/creatives/generate.js — ai_model routing', () => {
  it('fal_nano_banana_pro + a reference image → submitFalJob with model fal-ai/nano-banana-pro/edit', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana_pro', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(submitFalJobMock).toHaveBeenCalledTimes(1);
    expect(submitFalJobMock.mock.calls[0][0].model).toBe('fal-ai/nano-banana-pro/edit');
  });

  it('fal_nano_banana (default) + a reference image → submitFalJob with model fal-ai/nano-banana-2/edit', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(submitFalJobMock.mock.calls[0][0].model).toBe('fal-ai/nano-banana-2/edit');
  });

  it('ai_model=soul → routes through the raw @higgsfield/client/v2 SDK (subscribe to /v1/text2image/soul), not fal.ai', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'soul' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(higgsfieldSubscribeMock).toHaveBeenCalledTimes(1);
    expect(higgsfieldSubscribeMock.mock.calls[0][0]).toBe('/v1/text2image/soul');
    expect(submitFalJobMock).not.toHaveBeenCalled();
  });

  it('ai_model=flux_kontext → Higgsfield generateFluxKontext (Flux Kontext Max), falls back to fal.ai only on HF failure', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'flux_kontext' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateFluxKontextMock).toHaveBeenCalledTimes(1);
    expect(generateFluxKontextMock.mock.calls[0][0]).toMatchObject({ aspectRatio: '1:1' });
    expect(submitFalJobMock).not.toHaveBeenCalled(); // HF succeeded, no fal.ai fallback needed
  });

  it('fal_nano_banana + NO reference image AND product has no images → falls back to Higgsfield Flux Kontext Max', async () => {
    setupDefaultTableData(PRODUCT_NO_IMAGES);
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(generateFluxKontextMock).toHaveBeenCalledTimes(1);
    expect(submitFalJobMock).not.toHaveBeenCalled();
  });
});

describe('api/creatives/generate.js — resolution invariant', () => {
  it('no resolution supplied + Nano Banana → defaults to 2K (never the fal.ai-default 1K)', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(submitFalJobMock.mock.calls[0][0].resolution).toBe('2K');
  });

  it('an explicit valid resolution ("1K") is honored, not silently overridden', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png', resolution: '1K' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(submitFalJobMock.mock.calls[0][0].resolution).toBe('1K');
  });
});

describe('api/creatives/generate.js — Product Catalog prompt routing (spot check)', () => {
  it('product_catalog_v4 sends the (mocked) V4_PROMPT_BODY verbatim', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog_v4', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(submitFalJobMock.mock.calls[0][0].prompt).toContain('V4_BODY_MARKER');
  });

  it('product_catalog_v7 sends the (mocked) V7_PROMPT_BODY verbatim (distinct from v4)', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog_v7', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    const prompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(prompt).toContain('V7_BODY_MARKER');
    expect(prompt).not.toContain('V4_BODY_MARKER');
  });

  it('product_catalog (v1) — inline monolithic prompt (no external body file) — contains its distinctive GARMENT SHAPING section', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    const prompt = submitFalJobMock.mock.calls[0][0].prompt;
    expect(prompt).toContain('GARMENT SHAPING — THIS IS THE WHOLE POINT OF THE PHOTO');
  });
});

describe('api/creatives/generate.js — persona avatar sandwich reference-image pattern', () => {
  it('product_catalog with an audience/persona avatar → refImages is the [avatar, productPhoto, avatar] 3-element sandwich', async () => {
    tableData.persona_avatars = { single: () => ({ data: { reference_url: 'https://img.test/avatar.png' }, error: null }) };
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog', ai_model: 'fal_nano_banana', audience: 'Maria' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const sentImages = submitFalJobMock.mock.calls[0][0].imageUrl;
    expect(sentImages).toEqual(['https://img.test/avatar.png', 'https://img.test/prod1.png', 'https://img.test/avatar.png']);
  });

  it('a non-catalog style with a persona avatar → sandwich is [avatar, ...up to 2 product photos, avatar]', async () => {
    tableData.persona_avatars = { single: () => ({ data: { reference_url: 'https://img.test/avatar.png' }, error: null }) };
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'ad_creative', ai_model: 'fal_nano_banana', audience: 'Maria' },
      user: ADMIN,
    });
    await handler(req, res);
    const sentImages = submitFalJobMock.mock.calls[0][0].imageUrl;
    expect(sentImages).toEqual(['https://img.test/avatar.png', 'https://img.test/prod1.png', 'https://img.test/prod2.png', 'https://img.test/avatar.png']);
  });

  // FINDING (not fixed here — coverage only): the frontend never actually triggers this path
  // (CreativeStudio.jsx sends `audience`, not a bare `reference_url`, for every catalog style —
  // see apps/dashboard/src/components/CreativeStudio.jsx:703-708). But if reference_url is ever
  // passed directly (bypassing the audience/persona_avatars lookup) for a catalog style, the
  // unconditional "prepend reference_url to images" step (generate.js ~line 204) means
  // images.slice(0,1) below it picks up the AVATAR (now images[0]) instead of a real product
  // photo — the sandwich degenerates to [avatar, avatar, avatar] with the garment reference lost.
  it('LATENT BUG (currently unreachable from the frontend): direct reference_url (no audience) on a catalog style loses the product photo from the sandwich', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    const sentImages = submitFalJobMock.mock.calls[0][0].imageUrl;
    expect(sentImages).toEqual(['https://img.test/avatar.png', 'https://img.test/avatar.png', 'https://img.test/avatar.png']);
  });
});

describe('api/creatives/generate.js — HIGH-WAIST navel-hide gate (P1-11, full matrix in tests/creatives-brand-config.test.js)', () => {
  it('injects the HIGH-WAIST block when store.brand_config.features.high_waist_navel_hide is true', async () => {
    setupDefaultTableData(PRODUCT_WITH_IMAGES, { features: { high_waist_navel_hide: true } });
    const handler = await loadHandler();
    const { req, res } = mockReqRes({
      body: { product_id: 'p1', store_id: 's1', style: 'product_catalog_v4', ai_model: 'fal_nano_banana', reference_url: 'https://img.test/avatar.png' },
      user: ADMIN,
    });
    await handler(req, res);
    expect(submitFalJobMock.mock.calls[0][0].prompt).toContain('HIGH-WAIST TUMMY-CONTROL — MANDATORY');
  });
});

describe('api/creatives/generate.js — RBAC gates (P0-1, full matrix in tests/standalone-routes-permissions.test.js)', () => {
  it('403s for a member missing creatives:generate', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(submitFalJobMock).not.toHaveBeenCalled();
  });

  it('403s for a member with creatives:generate but store_id outside store_access', async () => {
    const handler = await loadHandler();
    const { req, res } = mockReqRes({ body: { product_id: 'p1', store_id: 's1' }, user: { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] } });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

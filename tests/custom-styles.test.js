import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Supabase mock (store_skills + store-docs Storage bucket) ---
const storageState = { listResults: {}, removed: [], uploaded: [] };

const storageListMock = vi.fn(async (prefix) => ({ data: storageState.listResults[prefix] || [], error: null }));
const storageRemoveMock = vi.fn(async (paths) => { storageState.removed.push(paths); return { error: null }; });
const storageUploadMock = vi.fn(async (path, _buf, opts) => { storageState.uploaded.push({ path, opts }); return { error: null }; });
const storageGetPublicUrlMock = vi.fn((path) => ({ data: { publicUrl: `https://storage.test/${path}` } }));

const storeSkillsUpsertMock = vi.fn(() => ({
  select: () => ({ single: async () => ({ data: { id: 'skill1' }, error: null }) }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      if (table === 'store_skills') {
        return {
          delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
          upsert: storeSkillsUpsertMock,
        };
      }
      // pipeline_log and anything else
      return { insert: vi.fn(async () => ({ error: null })) };
    },
    storage: {
      from: () => ({
        list: storageListMock,
        remove: storageRemoveMock,
        upload: storageUploadMock,
        getPublicUrl: storageGetPublicUrlMock,
      }),
    },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const scrapeProductMock = vi.fn();
vi.mock('../lib/scraper-utils.js', () => ({ scrapeProduct: (...args) => scrapeProductMock(...args) }));

vi.mock('@anthropic-ai/sdk', () => ({
  // Must be a real constructable function (not an arrow) — matches the pattern in
  // tests/rate-limit-per-tenant.test.js.
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ text: '{"style_name_suggestion":"Poolside","color_palette":["#fff"],"lighting":"soft","composition":"wide","setting":"pool","mood":"calm","camera_angle":"eye-level","color_grading":"warm","distinguishing_features":"tile","prompt_template":"a poolside scene"}' }],
        }),
      },
    };
  }),
}));

// DNS lookups only happen for hostnames that aren't literal IPs (the SSRF guard
// short-circuits IP literals before ever calling dns.lookup). Default to a public
// IP so "legit URL" tests don't need a real network call; individual tests override
// via mockResolvedValueOnce for the DNS-rebinding case.
const dnsLookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args) => dnsLookupMock(...args) },
}));

function mockReqRes(body, user) {
  const req = { body, headers: {}, user: user || { user_id: 'u1', role: 'admin', permissions: [], store_access: [] } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

describe('lib/actions/custom-styles.js', () => {
  let assertUrlIsSafeToFetch, scrape_style, create_custom_style, delete_custom_style;

  beforeEach(async () => {
    vi.resetModules();
    storageState.listResults = {};
    storageState.removed = [];
    storageState.uploaded = [];
    storeSkillsUpsertMock.mockClear();
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', name: 'Isola World', slug: 'isola' });
    scrapeProductMock.mockReset().mockResolvedValue({ image_urls: ['https://cdn.example.com/img1.jpg'] });
    dnsLookupMock.mockReset().mockResolvedValue([{ address: '104.16.0.1', family: 4 }]); // public IP default
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer,
    });
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
    const mod = await import('../lib/actions/custom-styles.js');
    assertUrlIsSafeToFetch = mod.assertUrlIsSafeToFetch;
    scrape_style = mod.scrape_style;
    create_custom_style = mod.create_custom_style;
    delete_custom_style = mod.delete_custom_style;
  });

  describe('assertUrlIsSafeToFetch (SSRF guard)', () => {
    it('rejects http://127.0.0.1/ (loopback, also non-https)', async () => {
      await expect(assertUrlIsSafeToFetch('http://127.0.0.1/')).rejects.toThrow();
    });

    it('rejects https://169.254.169.254/latest/meta-data/ (cloud metadata, link-local)', async () => {
      await expect(assertUrlIsSafeToFetch('https://169.254.169.254/latest/meta-data/')).rejects.toThrow();
      expect(dnsLookupMock).not.toHaveBeenCalled(); // IP literal short-circuits before any DNS call
    });

    it('rejects http://10.0.0.1/ (RFC1918, also non-https)', async () => {
      await expect(assertUrlIsSafeToFetch('http://10.0.0.1/')).rejects.toThrow();
    });

    it('rejects a public-looking hostname that resolves to a private IP (DNS-rebinding)', async () => {
      dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      await expect(assertUrlIsSafeToFetch('https://rebind.example.com/')).rejects.toThrow();
    });

    it('accepts https://dribbble.com/foo', async () => {
      await expect(assertUrlIsSafeToFetch('https://dribbble.com/foo')).resolves.toBeInstanceOf(URL);
    });

    it('accepts https://behance.net/bar', async () => {
      await expect(assertUrlIsSafeToFetch('https://behance.net/bar')).resolves.toBeInstanceOf(URL);
    });
  });

  describe('scrape_style SSRF gate', () => {
    it('400s a malicious url and never calls scrapeProduct', async () => {
      const { req, res } = mockReqRes({ url: 'http://127.0.0.1/admin', store_id: 's1' });
      await scrape_style(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(scrapeProductMock).not.toHaveBeenCalled();
    });

    it('proceeds to scrape + analyze for an allowed https url', async () => {
      const { req, res } = mockReqRes({ url: 'https://dribbble.com/shots/some-scene', store_id: 's1' });
      await scrape_style(req, res);
      expect(scrapeProductMock).toHaveBeenCalledWith('https://dribbble.com/shots/some-scene');
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.analysis.style_name_suggestion).toBe('Poolside');
    });
  });

  describe('create_custom_style Storage path (P2 — slug, not name)', () => {
    const analysis = { color_palette: ['#fff'], lighting: 'soft', prompt_template: 'x' };

    it('uses store.slug for the upload path, not store.name', async () => {
      const { req, res } = mockReqRes({
        store_id: 's1', name: 'Poolside Resort', description: '', analysis,
        reference_images: [{ base64: 'AAAA', media_type: 'image/jpeg' }],
      });
      await create_custom_style(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(storageState.uploaded).toHaveLength(1);
      expect(storageState.uploaded[0].path).toMatch(/^isola\/Styles\//);
      expect(storageState.uploaded[0].path).not.toMatch(/Isola World/);
    });

    it('falls back to store.id when slug is null/empty', async () => {
      getStoreMock.mockResolvedValue({ id: 's1', name: 'Isola World', slug: null });
      const { req, res } = mockReqRes({
        store_id: 's1', name: 'Poolside Resort', description: '', analysis,
        reference_images: [{ base64: 'AAAA', media_type: 'image/jpeg' }],
      });
      await create_custom_style(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(storageState.uploaded[0].path).toMatch(/^s1\/Styles\//);
    });
  });

  describe('delete_custom_style dual-path cleanup (P2 — burn-in fallback)', () => {
    it('removes files from both the new slug path and the legacy name path', async () => {
      storageState.listResults['isola/Styles/poolside'] = [{ name: 'ref_0.jpg' }];
      storageState.listResults['Isola World/Styles/poolside'] = [{ name: 'ref_1.jpg' }];
      const { req, res } = mockReqRes({ store_id: 's1', style_key: 'cs_poolside' });
      await delete_custom_style(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(storageState.removed).toContainEqual(['isola/Styles/poolside/ref_0.jpg']);
      expect(storageState.removed).toContainEqual(['Isola World/Styles/poolside/ref_1.jpg']);
    });
  });
});

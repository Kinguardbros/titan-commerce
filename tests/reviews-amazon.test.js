import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseState = { logged: [], inserted: [], existing: [] };

const supabaseFromMock = vi.fn((table) => {
  if (table === 'pipeline_log') {
    return { insert: vi.fn(async (row) => { supabaseState.logged.push(row); return { error: null }; }) };
  }
  if (table === 'product_reviews') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: supabaseState.existing, error: null })),
        })),
      })),
      insert: vi.fn(async (rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        supabaseState.inserted.push(...arr);
        return { error: null };
      }),
    };
  }
  return { insert: vi.fn(async () => ({ error: null })) };
});

const storageUploadMock = vi.fn().mockResolvedValue({ error: null });
const storageGetPublicUrlMock = vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/photo.jpg' } });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: supabaseFromMock,
    storage: { from: () => ({ upload: storageUploadMock, getPublicUrl: storageGetPublicUrlMock }) },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const fetchMock = vi.fn();

function mockReqRes(body, user) {
  const req = { body, headers: {}, user: user || { user_id: 'u1', role: 'admin', permissions: [], store_access: [] } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const MEMBER_WITH_EDIT = { user_id: 'm1', role: 'member', permissions: ['products:edit'], store_access: ['s1'] };
const MEMBER_NO_EDIT = { user_id: 'm2', role: 'member', permissions: ['products:read'], store_access: ['s1'] };
const MEMBER_WRONG_STORE = { user_id: 'm3', role: 'member', permissions: ['products:edit'], store_access: ['s2'] };

describe('lib/actions/reviews-amazon.js', () => {
  let scrape_amazon_preview, import_amazon_reviews;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.logged = [];
    supabaseState.inserted = [];
    supabaseState.existing = [];
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', name: 'Isola', slug: 'isola' });
    rateLimitMock.mockReset().mockResolvedValue(true);
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('AMAZON_SCRAPER_URL', 'http://37.27.189.60:3100');
    vi.stubEnv('AMAZON_SCRAPER_TOKEN', 'test-scraper-token');
    vi.stubEnv('FEATURE_AMAZON_REVIEWS_SCRAPER', 'true');
    const mod = await import('../lib/actions/reviews-amazon.js');
    scrape_amazon_preview = mod.scrape_amazon_preview;
    import_amazon_reviews = mod.import_amazon_reviews;
  });

  describe('scrape_amazon_preview', () => {
    it('403s when member lacks products:edit', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_NO_EDIT);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('403s when member has no access to the store', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_WRONG_STORE);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('200s for a member with products:edit + store access', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ reviews: [{ author: 'John S.', rating: 5, title: 'Great', body: 'Loved it', verified: true, photo_urls: [], helpful_count: 2, review_date: 'Reviewed in the United States on November 15, 2024' }], product: { asin: 'B08N5WRWNW', title: 'Test Product' } }),
      });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_WITH_EDIT);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.reviews).toHaveLength(1);
      expect(body.product.asin).toBe('B08N5WRWNW');
    });

    it('400s when amazon_url is missing', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('429s when rate limit trips', async () => {
      rateLimitMock.mockResolvedValue(false);
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('502s when the TC scraper VPS is unreachable/errors', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(502);
    });

    it('502s with an AMAZON_SCRAPER_TOKEN hint on a 401 from the scraper', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.hint).toMatch(/AMAZON_SCRAPER_TOKEN/);
    });

    it('503s when feature flag is off', async () => {
      vi.stubEnv('FEATURE_AMAZON_REVIEWS_SCRAPER', '');
      vi.resetModules();
      const mod = await import('../lib/actions/reviews-amazon.js');
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await mod.scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  describe('import_amazon_reviews', () => {
    const SAMPLE_REVIEW = { author: 'John S.', rating: 5, title: 'Great', body: 'Loved it', verified: true, photo_urls: [], helpful_count: 2, review_date: 'Reviewed in the United States on November 15, 2024' };

    it('403s when member lacks products:edit', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_NO_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when reviews array is empty', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [] });
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: inserts reviews as pending/source=amazon', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0]).toMatchObject({
        store_id: 's1', product_id: 'p1', status: 'pending', source: 'amazon', author: 'John S.', rating: 5,
      });
      expect(supabaseState.logged[0]).toMatchObject({ agent: 'AMAZON_SCRAPER', level: 'info' });
    });

    it('continues without a photo when photo download fails (does not block import)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      const withPhoto = { ...SAMPLE_REVIEW, photo_urls: ['https://m.media-amazon.com/images/I/photo._SY88_.jpg'] };
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [withPhoto] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0].photo_url).toBeNull();
    });

    it('skips duplicate reviews already present (dedup pre-check)', async () => {
      supabaseState.existing = [{ author: 'John S.', body: 'Loved it' }];
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.duplicates).toBe(1);
      expect(supabaseState.inserted).toHaveLength(0);
    });

    it('caps reviews array at 200 (hard cap, mirrors scrape max)', async () => {
      const many = Array.from({ length: 201 }, (_, i) => ({ ...SAMPLE_REVIEW, body: `Review ${i}` }));
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: many }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('prioritizes photo reviews (photo-first, then rating DESC) — F06', async () => {
      const noPhoto5 = { ...SAMPLE_REVIEW, body: 'no-photo-5-star', rating: 5 };
      const noPhoto3 = { ...SAMPLE_REVIEW, body: 'no-photo-3-star', rating: 3 };
      const photo4   = { ...SAMPLE_REVIEW, body: 'photo-4-star',   rating: 4, photo_urls: ['https://m.media-amazon.com/images/I/photo1.jpg'] };
      const photo2   = { ...SAMPLE_REVIEW, body: 'photo-2-star',   rating: 2, photo_urls: ['https://m.media-amazon.com/images/I/photo2.jpg'] };
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [noPhoto5, noPhoto3, photo4, photo2] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      // Insertion order in supabase mock preserves the priority order:
      // photo-4 (photo), photo-2 (photo), no-photo-5, no-photo-3
      const bodies = supabaseState.inserted.map((r) => r.body);
      expect(bodies).toEqual(['photo-4-star', 'photo-2-star', 'no-photo-5-star', 'no-photo-3-star']);
    });

    it('accepts source="temu" (feature-05 multi-domain) and persists it', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW], source: 'temu' }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted[0].source).toBe('temu');
    });

    it('defaults source to "amazon" when omitted (backward compat with F04 userscript)', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted[0].source).toBe('amazon');
    });

    it('rejects unknown source values', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW], source: 'evil' }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('I-3 SSRF: rejects a non-Amazon photo host (e.g. cloud metadata IP) without fetching it', async () => {
      const ssrf = { ...SAMPLE_REVIEW, photo_urls: ['http://169.254.169.254/latest/meta-data/'] };
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [ssrf] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0].photo_url).toBeNull();
    });

    it('I-3 SSRF: allows an Amazon CDN photo host and fetches it', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]).buffer,
      });
      const allowed = { ...SAMPLE_REVIEW, photo_urls: ['https://m.media-amazon.com/images/I/foo.jpg'] };
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [allowed] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetchMock).toHaveBeenCalledWith('https://m.media-amazon.com/images/I/foo.jpg', expect.any(Object));
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0].photo_url).toBe('https://storage.test/photo.jpg');
    });
  });
});

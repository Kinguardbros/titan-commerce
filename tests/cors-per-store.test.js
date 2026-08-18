import { describe, it, expect, vi, beforeEach } from 'vitest';

// P1-10 (AUDIT-2026-08): submit_review_public / vote_review_helpful /
// review_helpful_counts now resolve their CORS allow-list from a specific
// store's stores.storefront_origins row instead of one shared global env
// var. These tests exercise applyCors indirectly via the OPTIONS preflight
// response (same approach as the "CORS per-action origins" describe block
// in tests/system-routing.test.js — api/system.js does not export applyCors
// directly, it's module-private), using a Supabase mock smart enough to
// route by table + eq() conditions instead of the generic always-null mock.

const STORE_ORIGINS = {
  'store-a': ['https://store-a.example.com'],
  'store-b': ['https://store-b.example.com'],
  'store-empty': [], // backfill not done yet for this store — should fall back to legacy
};
const PRODUCT_TO_STORE = {
  'shopify-a-1': 'store-a',
  'shopify-b-1': 'store-b',
  'shopify-empty-1': 'store-empty',
};
const REVIEW_TO_STORE = {
  'review-a-1': 'store-a',
  'review-b-1': 'store-b',
};
// Sentinel shopify_product_id that simulates a genuine DB failure (network
// blip, not "not found") during resolveStoreId's product lookup — exercises
// getPerStoreOrigins' fail-open-to-legacy path (P1-A DB-error test below).
const DB_ERROR_SHOPIFY_ID = 'shopify-dberror-1';

vi.mock('@supabase/supabase-js', () => {
  function makeQuery(table) {
    const conds = [];
    const builder = {
      select: () => builder,
      eq: (col, val) => { conds.push([col, val]); return builder; },
      single: async () => {
        const val = (col) => conds.find(([c]) => c === col)?.[1];
        if (table === 'stores') {
          const storeId = val('id');
          const origins = STORE_ORIGINS[storeId];
          return { data: origins !== undefined ? { storefront_origins: origins } : null, error: null };
        }
        if (table === 'products') {
          const shopifyId = val('shopify_id');
          if (shopifyId === DB_ERROR_SHOPIFY_ID) throw new Error('simulated DB error');
          const storeId = PRODUCT_TO_STORE[shopifyId];
          return { data: storeId ? { store_id: storeId } : null, error: null };
        }
        if (table === 'product_reviews') {
          const reviewId = val('id');
          const storeId = REVIEW_TO_STORE[reviewId];
          return { data: storeId ? { store_id: storeId } : null, error: null };
        }
        return { data: null, error: null };
      },
      // Generic fallbacks so any other module's module-level createClient()
      // usage doesn't throw if a chain method beyond select/eq/single is hit
      // (e.g. lib/rate-limit.js, transitively imported by the real POST
      // action handlers the "POST unchanged behavior" test below dispatches
      // into).
      is: () => builder, order: () => builder, limit: () => builder,
      in: () => builder, gte: () => builder, insert: () => builder, update: () => builder,
      delete: () => builder,
      // Thenable — reached when a query is awaited WITHOUT .single(), e.g.
      // lib/storefront-cors.js's origin-index bulk fetch
      // (`select('id, storefront_origins').from('stores')`, no .eq() filter —
      // there's nothing to filter by, that's the whole point of the reverse
      // index). Only the unfiltered `stores` case matters for these tests.
      then: (resolve, reject) => {
        if (table === 'stores' && conds.length === 0) {
          const rows = Object.entries(STORE_ORIGINS).map(([id, storefront_origins]) => ({ id, storefront_origins }));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { createClient: () => ({ from: (table) => makeQuery(table) }) };
});

vi.mock('../lib/shopify-admin.js', () => ({
  getRevenueSummary: vi.fn(), getRecentOrders: vi.fn(), updateProduct: vi.fn(),
  updateVariant: vi.fn(), updateProductOptions: vi.fn(), getProductVariants: vi.fn(),
  createShopifyClient: vi.fn(() => ({})), isConnected: vi.fn(() => false), getTopProductsWithCreatives: vi.fn(),
}));
vi.mock('../lib/higgsfield.js', () => ({ buildStyledPrompt: vi.fn() }));
vi.mock('../lib/claude.js', () => ({ optimizeProduct: vi.fn() }));
vi.mock('../lib/auth.js', () => ({ withAuth: (handler) => handler }));
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('../lib/store-context.js', () => ({
  getAllStores: vi.fn().mockResolvedValue([]),
  getStore: vi.fn(),
}));
vi.mock('../lib/scraper-utils.js', () => ({ scrapeProduct: vi.fn(), scrapeCollectionUrls: vi.fn() }));
vi.mock('../lib/meta-api.js', () => ({
  isConnected: vi.fn(() => false), getAccountInsights: vi.fn(), getCampaigns: vi.fn(), getActiveAdsCount: vi.fn(),
}));
vi.mock('../lib/doc-processor.js', () => ({
  extractText: vi.fn(), classifyDocument: vi.fn(), extractInsights: vi.fn(), identifyProduct: vi.fn(),
}));

function optionsReq(action, origin, extra = {}) {
  return mockReq('OPTIONS', action, origin, extra);
}

// Same shape as optionsReq but with a configurable method — used by the P1-A
// "POST unchanged behavior" test to confirm the CORS header logic is
// identical for the actual POST, not just its preflight.
function mockReq(method, action, origin, extra = {}) {
  const req = {
    method,
    query: { action, ...extra.query },
    body: extra.body || {},
    headers: { origin },
    user: { role: 'admin', permissions: [], store_access: [] },
  };
  const headers = {};
  const res = {
    setHeader: vi.fn((k, v) => { headers[k] = v; }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return { req, res, headers };
}

describe('P1-10: per-store CORS for public review actions', () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('APP_SECRET', 'test-secret');
    vi.stubEnv('STOREFRONT_URL', 'https://legacy-fallback.example.com');
    vi.stubEnv('AMAZON_USERSCRIPT_ORIGINS', '');
    const mod = await import('../api/system.js');
    handler = mod.default;
  });

  it('review_helpful_counts (GET) resolves the target store from shopify_product_id in the query string and allows only that store\'s origin', async () => {
    const { req, res, headers } = optionsReq('review_helpful_counts', 'https://store-a.example.com', {
      query: { shopify_product_id: 'shopify-a-1' },
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://store-a.example.com');
  });

  it('review_helpful_counts does NOT allow a different store\'s origin for this product', async () => {
    const { req, res, headers } = optionsReq('review_helpful_counts', 'https://store-b.example.com', {
      query: { shopify_product_id: 'shopify-a-1' }, // belongs to store-a
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://store-b.example.com');
  });

  it('submit_review_public preflight (no body — real browser preflight shape) falls back to the legacy STOREFRONT_URL env origin', async () => {
    const { req, res, headers } = optionsReq('submit_review_public', 'https://legacy-fallback.example.com');
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://legacy-fallback.example.com');
  });

  it('vote_review_helpful resolves the target store from review_id in the body when present', async () => {
    const { req, res, headers } = optionsReq('vote_review_helpful', 'https://store-b.example.com', {
      body: { review_id: 'review-b-1' },
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://store-b.example.com');
  });

  it('a store with empty storefront_origins (not backfilled) falls back to the legacy STOREFRONT_URL origin, not an empty allow-list', async () => {
    const { req, res, headers } = optionsReq('review_helpful_counts', 'https://legacy-fallback.example.com', {
      query: { shopify_product_id: 'shopify-empty-1' },
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://legacy-fallback.example.com');
  });

  it('import_amazon_reviews is unaffected — still the env-based Amazon origin list, not per-store', async () => {
    const { req, res, headers } = optionsReq('import_amazon_reviews', 'https://www.amazon.com');
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://www.amazon.com');
  });
});

describe('P1-A (AUDIT-2026-08-B): CORS preflight resolves the store without a body', () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('APP_SECRET', 'test-secret');
    vi.stubEnv('STOREFRONT_URL', 'https://legacy-fallback.example.com');
    vi.stubEnv('AMAZON_USERSCRIPT_ORIGINS', '');
    const mod = await import('../api/system.js');
    handler = mod.default;
  });

  it('a real preflight shape (no body, no query product/review id) resolves store B purely from the Origin header', async () => {
    // This is the exact shape a browser sends before submit_review_public's actual POST:
    // OPTIONS, no body, no store-identifying query param — only Origin. Before the fix this
    // always fell through to the legacy Isola-only list regardless of storefront_origins.
    const { req, res, headers } = optionsReq('submit_review_public', 'https://store-b.example.com');
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://store-b.example.com');
  });

  it('an Origin matching no store and not on the legacy list gets no Access-Control-Allow-Origin header (fail closed)', async () => {
    const { req, res, headers } = optionsReq('submit_review_public', 'https://totally-unknown.example.com');
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('?store_id= on the preflighted URL resolves directly, without needing shopify_product_id/review_id', async () => {
    const { req, res, headers } = optionsReq('submit_review_public', 'https://store-b.example.com', {
      query: { store_id: 'store-b' },
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://store-b.example.com');
  });

  it('a real POST (not just its preflight) still resolves per-store CORS the same way — unchanged behavior', async () => {
    const { req, res, headers } = mockReq('POST', 'vote_review_helpful', 'https://store-b.example.com', {
      body: { review_id: 'review-b-1' },
    });
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://store-b.example.com');
  });

  it('a DB error during store resolution fails open to the legacy allow-list instead of throwing/500ing the preflight', async () => {
    const { req, res, headers } = optionsReq('review_helpful_counts', 'https://legacy-fallback.example.com', {
      query: { shopify_product_id: DB_ERROR_SHOPIFY_ID },
    });
    // getPerStoreOrigins must never throw — a rejected/thrown preflight would surface as an
    // unhandled error here (vitest fails the test on an uncaught rejection).
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://legacy-fallback.example.com');
  });
});

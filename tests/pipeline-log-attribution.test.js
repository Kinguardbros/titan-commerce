import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// P1-16 (Docs/AUDIT-2026-08.md): pipeline_log recorded WHAT happened (agent,
// message, level, metadata) but nothing about WHO triggered it. Post-P0-1 RBAC
// + P1-14/P1-15 self-service password change, multiple people can trigger
// dashboard actions — "who ran bulk_price?" / "who approved this proposal?"
// was unanswerable.
//
// Fix: pipeline_log gained two nullable columns (sql/add-pipeline-log-user-
// attribution.sql) — user_id (UUID FK) + initiator ('user'|'system'|'webhook'|
// 'cron' CHECK). ~73 call sites across lib/actions/, api/creatives/, api/ads/,
// api/auth/, api/cron/, api/webhooks/ were updated to pass both.
//
// These 3 tests cover the three initiator categories end-to-end through a
// real handler (not just asserting the object literal in source):
//   1. user-triggered   — lib/actions/creatives.js cleanup_stale (admin dashboard
//      action) writes user_id = req.user.user_id, initiator: 'user'.
//   2. cron-triggered    — api/cron/detect-events.js's aggregated scan log
//      writes user_id: null, initiator: 'cron' (no req.user at all — cron auth
//      is via CRON_SECRET header, not a session).
//   3. webhook-triggered — api/webhooks/shopify.js writes user_id: null,
//      initiator: 'webhook' for a verified Shopify product webhook.
// ---------------------------------------------------------------------------

let tableData = {};
function makeBuilder(table) {
  const cfg = () => tableData[table] || {};
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn((row) => {
      const c = cfg();
      const result = c.insert ? c.insert(row) : { data: row, error: null };
      return Object.assign(Promise.resolve(result), { select: vi.fn(() => builder) });
    }),
    delete: vi.fn(() => builder),
    single: vi.fn(async () => {
      const c = cfg();
      return c.single ? c.single() : { data: null, error: null };
    }),
    then: (resolve, reject) => {
      const c = cfg();
      const result = c.list ? c.list() : { data: [], error: null };
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
        list: vi.fn().mockResolvedValue({ data: [] }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
}));

vi.mock('../lib/sentry.js', () => ({
  initSentry: vi.fn(),
  captureException: vi.fn(),
}));

// --- deps for api/cron/detect-events.js ---
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: vi.fn(() => ({ getTopProductsWithCreatives: vi.fn() })),
}));
vi.mock('../lib/event-detector.js', () => ({
  detectEventsForStore: vi.fn(),
}));
const pollGenerationsMock = vi.fn().mockImplementation(async (req, res) => {
  res.status(200).json({ checked: 0, completed: 0, failed: 0 });
});
vi.mock('../lib/actions/creatives.js', async () => {
  const actual = await vi.importActual('../lib/actions/creatives.js');
  return { ...actual, poll_generations: (...args) => pollGenerationsMock(...args) };
});

// --- deps for api/webhooks/shopify.js ---
const handleProductCreateMock = vi.fn().mockResolvedValue({ action: 'created', title: 'Test Product', shopify_id: 999 });
vi.mock('../lib/shopify-webhook-handlers.js', () => ({
  handleProductCreate: (...args) => handleProductCreateMock(...args),
  handleProductUpdate: vi.fn(),
  handleProductDelete: vi.fn(),
}));

function mockReqRes({ body = {}, query = {}, user, headers = {} } = {}) {
  const req = { body, query, headers, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

beforeEach(() => {
  vi.resetModules();
  tableData = {};
  pollGenerationsMock.mockClear();
  handleProductCreateMock.mockClear();
  delete process.env.CRON_SECRET;
});

describe('pipeline_log attribution (P1-16)', () => {
  it('user-triggered action (cleanup_stale) writes user_id + initiator: "user"', async () => {
    const pipelineLogInsertSpy = vi.fn();
    tableData.creatives = { list: () => ({ data: [], error: null }) };
    tableData.pipeline_log = { insert: (row) => { pipelineLogInsertSpy(row); return { data: row, error: null }; } };

    const { cleanup_stale } = await import('../lib/actions/creatives.js');
    const { req, res } = mockReqRes({ user: { user_id: 'u-admin-1', role: 'admin', permissions: [], store_access: [] } });

    await cleanup_stale(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(pipelineLogInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CLEANUP', user_id: 'u-admin-1', initiator: 'user' })
    );
  });

  it('cron-triggered scan (api/cron/detect-events.js) writes user_id: null + initiator: "cron"', async () => {
    const pipelineLogInsertSpy = vi.fn();
    tableData.stores = { list: () => ({ data: [], error: null }) };
    tableData.creatives = { list: () => ({ data: [], error: null }) };
    tableData.pipeline_log = { insert: (row) => { pipelineLogInsertSpy(row); return { data: row, error: null }; } };

    const { default: handler } = await import('../api/cron/detect-events.js');
    const { req, res } = mockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(pipelineLogInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'AGENT', user_id: null, initiator: 'cron' })
    );
  });

  it('webhook-triggered product create (api/webhooks/shopify.js) writes user_id: null + initiator: "webhook"', async () => {
    const pipelineLogInsertSpy = vi.fn();
    const secret = 'store-webhook-secret';
    const payload = { id: 999, title: 'Test Product' };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

    tableData.stores = {
      single: () => ({ data: { id: 's1', shopify_url: 'shop.myshopify.com', admin_token: 'tok', client_secret: secret }, error: null }),
    };
    tableData.pipeline_log = { insert: (row) => { pipelineLogInsertSpy(row); return { data: row, error: null }; } };

    const { default: handler } = await import('../api/webhooks/shopify.js');

    // api/webhooks/shopify.js reads the raw body via `for await (const c of req)` —
    // build a minimal async-iterable request object carrying method/headers too.
    const req = {
      method: 'POST',
      headers: {
        'x-shopify-topic': 'products/create',
        'x-shopify-shop-domain': 'shop.myshopify.com',
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-webhook-id': 'wh-1',
      },
      [Symbol.asyncIterator]: async function* () { yield rawBody; },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(handleProductCreateMock).toHaveBeenCalled();
    expect(pipelineLogInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'SCRAPER', user_id: null, initiator: 'webhook' })
    );
  });
});

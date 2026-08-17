import { describe, it, expect, vi, beforeEach } from 'vitest';

// P0-3 (Docs/AUDIT-2026-08.md): manual_adspend and performance (Meta) queries
// must be scoped by store_id, same as products.cogs already was.

const supabaseCallsMock = {};

function makeBuilderMock(table) {
  const builder = {
    select: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    eq: vi.fn((col, val) => {
      supabaseCallsMock[table] = supabaseCallsMock[table] || [];
      supabaseCallsMock[table].push({ col, val });
      return builder;
    }),
    upsert: vi.fn((row, options) => {
      supabaseCallsMock[table] = supabaseCallsMock[table] || [];
      supabaseCallsMock[table].push({ upsert: row, upsertOptions: options });
      return builder;
    }),
    single: vi.fn(async () => {
      const calls = supabaseCallsMock[table] || [];
      const lastUpsert = calls[calls.length - 1];
      return { data: { id: 1, ...(lastUpsert?.upsert || {}) }, error: null };
    }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return builder;
}

const supabaseFromMock = vi.fn((table) => makeBuilderMock(table));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

const getStoreMock = vi.fn(async () => ({ id: 'store-1' }));
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: vi.fn(),
  getRevenueSummary: vi.fn(async () => ({})),
  getRecentOrders: vi.fn(async () => []),
}));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
// finance:read (not products:read) is what gates profit_summary since P0-5 —
// these P0-3 store-scoping tests need it to reach the query logic at all.
const MEMBER_STORE1 = { role: 'member', permissions: ['finance:read'], store_access: ['store-1'] };
const MEMBER_STORE1_PRODUCTS_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };

describe('profit_summary store scoping (P0-3)', () => {
  let profit_summary;

  beforeEach(async () => {
    vi.resetModules();
    Object.keys(supabaseCallsMock).forEach((k) => delete supabaseCallsMock[k]);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/profit.js');
    ({ profit_summary } = mod);
  });

  it('filters manual_adspend by store_id when store_id is provided', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', days: '7' }, user: MEMBER_STORE1 });
    await profit_summary(req, res);
    expect(supabaseCallsMock['manual_adspend']).toContainEqual({ col: 'store_id', val: 'store-1' });
  });

  it('filters performance (Meta) by store_id when store_id is provided', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', days: '7' }, user: MEMBER_STORE1 });
    await profit_summary(req, res);
    expect(supabaseCallsMock['performance']).toContainEqual({ col: 'store_id', val: 'store-1' });
  });

  it('does not filter manual_adspend/performance by store_id for an unscoped admin call', async () => {
    const { req, res } = mockReqRes({ query: { days: '7' }, user: ADMIN });
    await profit_summary(req, res);
    expect(supabaseCallsMock['manual_adspend']).toBeUndefined();
    expect(supabaseCallsMock['performance']).toBeUndefined();
  });

  // P0-5 (Docs/AUDIT-2026-08.md): finance:read is a dedicated permission tier,
  // separate from products:read — profit_summary must reject a caller who only
  // has products:read (the permission the Products tab needs).
  it('rejects a member with products:read but not finance:read (403)', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', days: '7' }, user: MEMBER_STORE1_PRODUCTS_ONLY });
    await profit_summary(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows a member with finance:read and store access', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', days: '7' }, user: MEMBER_STORE1 });
    await profit_summary(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('allows admin regardless of permissions array', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', days: '7' }, user: ADMIN });
    await profit_summary(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

describe('manual_adspend write scoping (P0-3)', () => {
  let manual_adspend;

  beforeEach(async () => {
    vi.resetModules();
    Object.keys(supabaseCallsMock).forEach((k) => delete supabaseCallsMock[k]);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/pricing.js');
    ({ manual_adspend } = mod);
  });

  it('rejects without store_id (400)', async () => {
    const { req, res } = mockReqRes({ body: { date: '2026-08-01', channel: 'tiktok', amount: 10 }, user: ADMIN });
    await manual_adspend(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a non-admin with store access via hasStoreAccess-gated path', async () => {
    const { req, res } = mockReqRes({ body: { date: '2026-08-01', channel: 'tiktok', amount: 10, store_id: 'store-2' }, user: MEMBER_STORE1 });
    await manual_adspend(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('writes store_id into the upsert row for an admin with store_id provided', async () => {
    const { req, res } = mockReqRes({ body: { date: '2026-08-01', channel: 'tiktok', amount: 10, store_id: 'store-1' }, user: ADMIN });
    await manual_adspend(req, res);
    const upsertCall = supabaseCallsMock['manual_adspend']?.find((c) => c.upsert);
    expect(upsertCall?.upsert?.store_id).toBe('store-1');
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  // P0-3 follow-up (Docs/AUDIT-2026-08.md, sql/fix-manual-adspend-unique.sql):
  // the UNIQUE constraint moved from (date, channel) to (store_id, date, channel) —
  // the upsert's onConflict target must match, or a duplicate-key upsert against the
  // new constraint would silently fall through to a plain INSERT and 23505.
  it('uses composite onConflict target store_id,date,channel — not the old global date,channel', async () => {
    const { req, res } = mockReqRes({ body: { date: '2026-08-01', channel: 'tiktok', amount: 10, store_id: 'store-1' }, user: ADMIN });
    await manual_adspend(req, res);
    const upsertCall = supabaseCallsMock['manual_adspend']?.find((c) => c.upsert);
    expect(upsertCall?.upsertOptions).toEqual({ onConflict: 'store_id,date,channel' });
  });
});

// Test the P&L calculation logic directly — extracted from system.js profit_summary

function calculateDailyPnL(orders, cogsMap, paymentFees, defaultFeeRate) {
  const emptyDay = (date) => ({
    date, revenue: 0, returns: 0, cogs: 0, shipping: 0,
    adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0,
    transaction_fees: 0,
  });
  const dailyMap = {};

  for (const order of orders) {
    const date = order.created_at.split('T')[0];
    if (!dailyMap[date]) dailyMap[date] = emptyDay(date);
    dailyMap[date].revenue += order.total;
    dailyMap[date].returns += order.refund_amount || 0;
    dailyMap[date].shipping += order.shipping || 0;
    for (const item of order.items || []) {
      const unitCost = cogsMap[item.title] || 0;
      dailyMap[date].cogs += unitCost * item.quantity;
    }
    const feeRate = paymentFees[order.payment_gateway] || defaultFeeRate;
    dailyMap[date].transaction_fees += order.total * feeRate;
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  return Object.values(dailyMap).map((d) => {
    const adspend_total = d.adspend_meta + d.adspend_tiktok + d.adspend_pinterest + d.adspend_manual;
    const net_revenue = d.revenue - d.returns;
    const profit = net_revenue - d.cogs - d.shipping - adspend_total - d.transaction_fees;
    return { ...d, profit: round2(profit), transaction_fees: round2(d.transaction_fees) };
  });
}

describe('P&L calculation', () => {
  const baseOrder = {
    created_at: '2026-04-10T12:00:00Z',
    total: 100,
    shipping: 5,
    refund_amount: 0,
    payment_gateway: 'shopify_payments',
    financial_status: 'paid',
    items: [{ title: 'Mathilda Pants', quantity: 2 }],
  };

  it('calculates profit with all components', () => {
    const cogsMap = { 'Mathilda Pants': 15 };
    const paymentFees = { shopify_payments: 0.019, paypal: 0.0349 };
    const result = calculateDailyPnL([baseOrder], cogsMap, paymentFees, 0.035);

    expect(result).toHaveLength(1);
    const day = result[0];
    expect(day.revenue).toBe(100);
    expect(day.shipping).toBe(5);
    expect(day.cogs).toBe(30); // 15 * 2
    expect(day.transaction_fees).toBe(1.9); // 100 * 0.019
    // profit = 100 - 0 - 30 - 5 - 0 - 1.9 = 63.1
    expect(day.profit).toBe(63.1);
  });

  it('uses per-gateway fee rate', () => {
    const paypalOrder = { ...baseOrder, payment_gateway: 'paypal', items: [] };
    const result = calculateDailyPnL([paypalOrder], {}, { shopify_payments: 0.019, paypal: 0.0349 }, 0.035);
    expect(result[0].transaction_fees).toBe(3.49); // 100 * 0.0349
  });

  it('falls back to default fee rate for unknown gateway', () => {
    const unknownOrder = { ...baseOrder, payment_gateway: 'klarna', items: [] };
    const result = calculateDailyPnL([unknownOrder], {}, { shopify_payments: 0.019 }, 0.035);
    expect(result[0].transaction_fees).toBe(3.5); // 100 * 0.035
  });

  it('accounts for returns/refunds', () => {
    const refundedOrder = { ...baseOrder, refund_amount: 50, items: [] };
    const result = calculateDailyPnL([refundedOrder], {}, {}, 0.035);
    // profit = 100 - 50 - 0 - 5 - 0 - 3.5 = 41.5
    expect(result[0].returns).toBe(50);
    expect(result[0].profit).toBe(41.5);
  });

  it('handles shipping from Shopify', () => {
    const shippingOrder = { ...baseOrder, shipping: 12.50, items: [] };
    const result = calculateDailyPnL([shippingOrder], {}, {}, 0.035);
    expect(result[0].shipping).toBe(12.50);
    // profit = 100 - 0 - 0 - 12.50 - 0 - 3.5 = 84
    expect(result[0].profit).toBe(84);
  });

  it('handles orders with no shipping (digital products)', () => {
    const digitalOrder = { ...baseOrder, shipping: 0, items: [] };
    const result = calculateDailyPnL([digitalOrder], {}, {}, 0.035);
    expect(result[0].shipping).toBe(0);
  });

  it('aggregates multiple orders on same day', () => {
    const order2 = { ...baseOrder, total: 50, shipping: 3, items: [{ title: 'Elara Bikini', quantity: 1 }] };
    const cogsMap = { 'Mathilda Pants': 15, 'Elara Bikini': 10 };
    const result = calculateDailyPnL([baseOrder, order2], cogsMap, {}, 0.035);
    expect(result).toHaveLength(1);
    expect(result[0].revenue).toBe(150);
    expect(result[0].shipping).toBe(8);
    expect(result[0].cogs).toBe(40); // 15*2 + 10*1
  });
});

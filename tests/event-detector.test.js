import { describe, it, expect, beforeEach } from 'vitest';
import { detectEventsForStore } from '../lib/event-detector.js';

// ---------------------------------------------------------------------------
// P1-23 (Docs/AUDIT-2026-08.md): lib/event-detector.js had ZERO test coverage
// despite being the shared engine behind both the daily proposal-generation
// cron (api/cron/detect-events.js) and the Cockpit's "Scan Now" button
// (scan_events action). detectEventsForStore(storeId, topProducts, supabase)
// takes its Supabase client as a plain argument (no module-level singleton to
// mock) — so this file drives it with a small in-memory fake Supabase instead
// of vi.mock, covering the real query/filter shapes the function issues.
// ---------------------------------------------------------------------------

function applyFilters(rows, filters) {
  return rows.filter((r) => filters.every((f) => {
    if (f.op === 'eq') return r[f.field] === f.value;
    if (f.op === 'in') return f.value.includes(r[f.field]);
    if (f.op === 'gte') return r[f.field] >= f.value;
    return true;
  }));
}

function makeFakeSupabase(state) {
  function from(table) {
    const filters = [];
    let limitN = null;
    const builder = {
      select: () => builder,
      eq: (field, value) => { filters.push({ field, op: 'eq', value }); return builder; },
      in: (field, value) => { filters.push({ field, op: 'in', value }); return builder; },
      gte: (field, value) => { filters.push({ field, op: 'gte', value }); return builder; },
      order: () => builder,
      limit: (n) => { limitN = n; return builder; },
      insert: (row) => {
        const rows = Array.isArray(row) ? row : [row];
        const inserted = rows.map((r, i) => ({ id: `${table}-${state[table].length + i}`, ...r }));
        state[table].push(...inserted);
        const result = { data: inserted.length === 1 ? inserted[0] : inserted, error: null };
        return Object.assign(Promise.resolve(result), {
          select: () => ({ single: async () => ({ data: inserted[0], error: null }) }),
        });
      },
      update: (patch) => ({
        eq: (field, value) => {
          state[table] = (state[table] || []).map((r) => (r[field] === value ? { ...r, ...patch } : r));
          return Promise.resolve({ data: null, error: null });
        },
      }),
      single: async () => {
        const rows = applyFilters(state[table] || [], filters);
        const limited = limitN ? rows.slice(0, limitN) : rows;
        return { data: limited[0] || null, error: null };
      },
      then: (resolve, reject) => {
        const rows = applyFilters(state[table] || [], filters);
        const limited = limitN ? rows.slice(0, limitN) : rows;
        return Promise.resolve({ data: limited, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { from };
}

function makeTopProduct(overrides = {}) {
  return { product_id: 'p1', title: 'Product 1', units: 5, creative_count: 0, revenue: 100, trend: null, ...overrides };
}

describe('lib/event-detector.js detectEventsForStore', () => {
  let state;

  beforeEach(() => {
    state = { products: [], creatives: [], events: [], proposals: [] };
  });

  it('empty store (no top products, no products at all) — returns 0/0, no crash', async () => {
    const supabase = makeFakeSupabase(state);
    const result = await detectEventsForStore('store-1', [], supabase);
    expect(result).toEqual({ eventsCreated: 0, proposalsCreated: 0 });
  });

  it('product with 0 creatives and units sold creates a product_no_creatives event + proposal', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p1', title: 'No Creatives Yet', units: 10, creative_count: 0 })];
    const result = await detectEventsForStore('store-1', topProducts, supabase);
    expect(result.eventsCreated).toBeGreaterThanOrEqual(1);
    const evt = state.events.find((e) => e.type === 'product_no_creatives' && e.product_id === 'p1');
    expect(evt).toBeTruthy();
    expect(evt.severity).toBe('high');
    const prop = state.proposals.find((p) => p.type === 'generate_creatives' && p.product_id === 'p1');
    expect(prop).toBeTruthy();
    expect(JSON.parse(prop.suggested_action)).toMatchObject({ action: 'generate', product_id: 'p1' });
  });

  it('a product with 0 units sold does NOT trigger product_no_creatives (units > 0 gate)', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p1', units: 0, creative_count: 0 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    expect(state.events.find((e) => e.type === 'product_no_creatives')).toBeUndefined();
  });

  it('revenue dropping >10% day-over-day (with existing creatives) creates a revenue_declining proposal', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p2', title: 'Declining Product', creative_count: 2, revenue: 80, trend: -25 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    const evt = state.events.find((e) => e.type === 'revenue_declining' && e.product_id === 'p2');
    expect(evt).toBeTruthy();
    expect(evt.severity).toBe('medium');
    const prop = state.proposals.find((p) => p.type === 'try_different_style' && p.product_id === 'p2');
    expect(prop).toBeTruthy();
  });

  it('a small revenue dip (<=10%) does NOT trigger revenue_declining', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p2', creative_count: 2, trend: -5 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    expect(state.events.find((e) => e.type === 'revenue_declining')).toBeUndefined();
  });

  it('a "winner" product (trend > 15%, revenue > 100) creates a winner_detected proposal', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p3', title: 'Winner Product', creative_count: 3, revenue: 250, trend: 40 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    const evt = state.events.find((e) => e.type === 'winner_detected' && e.product_id === 'p3');
    expect(evt).toBeTruthy();
    expect(evt.severity).toBe('low');
    const prop = state.proposals.find((p) => p.type === 'generate_variations' && p.product_id === 'p3');
    expect(prop).toBeTruthy();
  });

  it('trend > 15% but revenue <= 100 does NOT count as a winner (revenue gate)', async () => {
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p3', creative_count: 3, revenue: 50, trend: 40 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    expect(state.events.find((e) => e.type === 'winner_detected')).toBeUndefined();
  });

  it('dedup: does not create a second event/proposal when an active event of the same type already exists for the product', async () => {
    state.events.push({ id: 'evt-existing', store_id: 'store-1', product_id: 'p1', type: 'product_no_creatives', status: 'proposal_created' });
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p1', units: 10, creative_count: 0 })];
    const result = await detectEventsForStore('store-1', topProducts, supabase);
    // No NEW product_no_creatives event/proposal was created for p1
    const p1Events = state.events.filter((e) => e.type === 'product_no_creatives' && e.product_id === 'p1');
    expect(p1Events).toHaveLength(1); // still just the pre-seeded one
    expect(state.proposals.find((p) => p.type === 'generate_creatives' && p.product_id === 'p1')).toBeUndefined();
  });

  it('cooldown: does not recreate a proposal type that was dismissed (rejected) within the last 7 days', async () => {
    state.proposals.push({
      id: 'prop-existing', store_id: 'store-1', product_id: 'p1', type: 'generate_creatives',
      status: 'rejected', created_at: new Date().toISOString(),
    });
    const supabase = makeFakeSupabase(state);
    const topProducts = [makeTopProduct({ product_id: 'p1', units: 10, creative_count: 0 })];
    await detectEventsForStore('store-1', topProducts, supabase);
    expect(state.events.find((e) => e.type === 'product_no_creatives' && e.product_id === 'p1')).toBeUndefined();
  });

  it('archived products are excluded from the store-wide beach-photo scan (status filter)', async () => {
    state.products.push(
      { id: 'active-1', title: 'Active Swimsuit', status: 'active', store_id: 'store-1' },
      { id: 'archived-1', title: 'Archived Swimsuit', status: 'archived', store_id: 'store-1' },
    );
    const supabase = makeFakeSupabase(state);
    await detectEventsForStore('store-1', [], supabase);
    const proposalProductIds = state.proposals.map((p) => p.product_id);
    expect(proposalProductIds).toContain('active-1');
    expect(proposalProductIds).not.toContain('archived-1');
  });

  it('a product with an existing approved beach creative is skipped by the store-wide beach scan', async () => {
    state.products.push(
      { id: 'has-beach', title: 'Has Beach Photo', status: 'active', store_id: 'store-1' },
      { id: 'no-beach', title: 'No Beach Photo Yet', status: 'active', store_id: 'store-1' }, // control: should still get a proposal
    );
    state.creatives.push({ id: 'c1', store_id: 'store-1', product_id: 'has-beach', style: 'product_photo_beach', status: 'approved' });
    const supabase = makeFakeSupabase(state);
    await detectEventsForStore('store-1', [], supabase);
    expect(state.proposals.find((p) => p.product_id === 'has-beach')).toBeUndefined();
    expect(state.proposals.find((p) => p.product_id === 'no-beach')).toBeTruthy(); // proves the query/filter actually ran
  });

  it('non-product line items (shipping insurance, gift cards, etc.) are excluded from the beach scan', async () => {
    state.products.push(
      { id: 'ship-1', title: 'Shipping Protection', status: 'active', store_id: 'store-1' },
      { id: 'real-1', title: 'Real Swimsuit', status: 'active', store_id: 'store-1' }, // control: should still get a proposal
    );
    const supabase = makeFakeSupabase(state);
    await detectEventsForStore('store-1', [], supabase);
    expect(state.proposals.find((p) => p.product_id === 'ship-1')).toBeUndefined();
    expect(state.proposals.find((p) => p.product_id === 'real-1')).toBeTruthy(); // proves the query/filter actually ran
  });
});

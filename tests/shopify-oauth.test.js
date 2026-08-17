import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'fs';

// P2 fix (AUDIT-2026-08): api/auth/shopify.js OAuth callback
//   1. fails CLOSED when the `hmac` query param is absent (was fail-open)
//   2. actually validates the `state` nonce against a stored, single-use,
//      TTL'd row in oauth_nonces (was: generated + logged, never checked)

const STORE_ID = 'store-1';
const CLIENT_SECRET = 'shpss_test_secret';
const SHOP = 'test-shop.myshopify.com';

// --- Generic chainable Supabase mock, driven by a shared `state` object. ---
function makeSupabaseMock(state) {
  const from = vi.fn((table) => {
    const chain = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.single = vi.fn(async () => {
      if (table === 'stores') return { data: state.store, error: state.storeError || null };
      return { data: null, error: null };
    });
    chain.maybeSingle = vi.fn(async () => {
      if (table === 'oauth_nonces') return { data: state.nonceRow, error: state.nonceLookupError || null };
      return { data: null, error: null };
    });
    chain.delete = vi.fn(() => {
      if (table === 'oauth_nonces') state.nonceDeleted = true;
      return chain;
    });
    chain.update = vi.fn((payload) => {
      if (table === 'stores') state.storeUpdated = payload;
      return chain;
    });
    chain.insert = vi.fn(async (row) => {
      if (table === 'oauth_nonces') state.nonceInserted = row;
      if (table === 'pipeline_log') state.logs.push(row);
      return { data: null, error: state.insertError || null };
    });
    return chain;
  });
  return { from };
}

let state;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabaseMock(state),
}));

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  return res;
}

function computeHmac(query, secret) {
  const { hmac, ...params } = query;
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

let handler;

beforeEach(async () => {
  vi.resetModules();
  state = {
    store: { id: STORE_ID, shopify_url: SHOP, client_id: 'client-1', client_secret: CLIENT_SECRET },
    storeError: null,
    nonceRow: null,
    nonceLookupError: null,
    nonceDeleted: false,
    nonceInserted: null,
    storeUpdated: null,
    insertError: null,
    logs: [],
  };
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('APP_URL', 'https://titan-commerce.vercel.app');
  const mod = await import('../api/auth/shopify.js');
  handler = mod.default;
});

describe('api/auth/shopify.js — CALLBACK hmac fail-closed (P2, AUDIT-2026-08)', () => {
  it('returns 400 when hmac param is absent — was fail-open', async () => {
    const req = {
      method: 'GET',
      query: { code: 'abc', shop: SHOP, state: `${STORE_ID}:somenonce` },
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'OAuth HMAC required' }));
  });

  it('returns 400 when hmac param is an empty string', async () => {
    const req = {
      method: 'GET',
      query: { code: 'abc', shop: SHOP, state: `${STORE_ID}:somenonce`, hmac: '' },
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('still redirects with hmac_failed when hmac is present but wrong (existing behavior preserved)', async () => {
    const query = { code: 'abc', shop: SHOP, state: `${STORE_ID}:somenonce` };
    const req = { method: 'GET', query: { ...query, hmac: 'deadbeef'.repeat(8) } };
    const res = mockRes();
    await handler(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/?error=hmac_failed');
  });
});

describe('api/auth/shopify.js — CALLBACK nonce validation (P2, AUDIT-2026-08)', () => {
  function validCallbackReq(nonce, extra = {}) {
    const query = { code: 'abc', shop: SHOP, state: `${STORE_ID}:${nonce}`, ...extra };
    const hmac = computeHmac(query, CLIENT_SECRET);
    return { method: 'GET', query: { ...query, hmac } };
  }

  it('returns 400 when the nonce was never issued (e.g. forged state)', async () => {
    state.nonceRow = null; // nothing stored
    const req = validCallbackReq('never-issued-nonce');
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/nonce/i) }));
  });

  it('returns 400 on nonce reuse — second callback with the same (now-deleted) nonce is rejected', async () => {
    // Simulate: nonce existed for the first call, but by the time this second
    // call runs it has already been deleted (delete-after-use).
    state.nonceRow = null;
    const req = validCallbackReq('already-used-nonce');
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when the stored nonce has expired', async () => {
    state.nonceRow = { nonce: 'expired-nonce', expires_at: new Date(Date.now() - 60_000).toISOString() };
    const req = validCallbackReq('expired-nonce');
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    // Still deleted even though expired — single-use regardless of validity.
    expect(state.nonceDeleted).toBe(true);
  });

  it('happy path: valid hmac + valid unexpired nonce — deletes the nonce and proceeds to token exchange', async () => {
    state.nonceRow = { nonce: 'good-nonce', expires_at: new Date(Date.now() + 5 * 60_000).toISOString() };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'shpat_abc123' }),
    })));
    const req = validCallbackReq('good-nonce');
    const res = mockRes();
    await handler(req, res);
    expect(state.nonceDeleted).toBe(true);
    expect(state.storeUpdated).toEqual({ admin_token: 'shpat_abc123' });
    expect(res.redirect).toHaveBeenCalledWith('/?tab=Shopify&connected=true');
  });
});

describe('api/auth/shopify.js — CONNECT step stores a nonce in oauth_nonces', () => {
  it('inserts a nonce row with store_id + a future expires_at instead of only logging it', async () => {
    const req = { method: 'GET', query: { store_id: STORE_ID } };
    const res = mockRes();
    await handler(req, res);
    expect(state.nonceInserted).toBeTruthy();
    expect(state.nonceInserted.store_id).toBe(STORE_ID);
    expect(typeof state.nonceInserted.nonce).toBe('string');
    expect(new Date(state.nonceInserted.expires_at).getTime()).toBeGreaterThan(Date.now());
    // Nonce value itself must NOT be logged to pipeline_log (it's a secret).
    expect(state.logs[0]?.metadata?.nonce).toBeUndefined();
  });
});

describe('sql/add-oauth-nonces-table.sql', () => {
  const sql = readFileSync('sql/add-oauth-nonces-table.sql', 'utf8');

  it('creates the oauth_nonces table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS oauth_nonces/);
  });

  it('nonce is the PRIMARY KEY (single-use, no duplicate nonce values)', () => {
    expect(sql).toMatch(/nonce TEXT PRIMARY KEY/);
  });

  it('references stores(id) with ON DELETE CASCADE', () => {
    expect(sql).toMatch(/store_id UUID NOT NULL REFERENCES stores\(id\) ON DELETE CASCADE/);
  });

  it('enables RLS', () => {
    expect(sql).toMatch(/ALTER TABLE oauth_nonces ENABLE ROW LEVEL SECURITY/);
  });

  it('registers itself in schema_migrations (idempotent)', () => {
    expect(sql).toMatch(/INSERT INTO schema_migrations \(filename\) VALUES \('add-oauth-nonces-table\.sql'\) ON CONFLICT DO NOTHING/);
  });
});

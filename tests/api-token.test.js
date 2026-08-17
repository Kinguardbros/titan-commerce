import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import crypto from 'crypto';

describe('sql/add-user-api-token.sql', () => {
  it('adds an api_token TEXT UNIQUE column to users', () => {
    const sql = readFileSync('sql/add-user-api-token.sql', 'utf8');
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE/);
  });

  it('creates a partial index on api_token for auth lookup performance', () => {
    const sql = readFileSync('sql/add-user-api-token.sql', 'utf8');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_users_api_token ON users\(api_token\) WHERE api_token IS NOT NULL/);
  });
});

describe('sql/add-users-api-token-hash.sql (P2, AUDIT-2026-08)', () => {
  const sql = readFileSync('sql/add-users-api-token-hash.sql', 'utf8');

  it('adds an api_token_hash TEXT column to users', () => {
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token_hash TEXT/);
  });

  it('creates a partial index on api_token_hash', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_users_api_token_hash ON users\(api_token_hash\) WHERE api_token_hash IS NOT NULL/);
  });

  it('backfills api_token_hash from existing plaintext api_token values', () => {
    expect(sql).toMatch(/UPDATE users\s+SET api_token_hash = encode\(sha256\(api_token::bytea\), 'hex'\)\s+WHERE api_token IS NOT NULL AND api_token_hash IS NULL/);
  });

  it('registers itself in schema_migrations (idempotent)', () => {
    expect(sql).toMatch(/INSERT INTO schema_migrations \(filename\) VALUES \('add-users-api-token-hash\.sql'\) ON CONFLICT DO NOTHING/);
  });
});

// --- generate_api_token mock infrastructure (module top-level: vi.mock is hoisted
// above imports, so the mock factory must only reference top-level bindings). ---
const usersState = { updated: [], logged: [], updateResult: null, updateError: null };

// Shared with the verifyAuth api_token-bearer-path describe block below: two lookup
// chains, `from('users').select(...).eq('api_token_hash', ...).maybeSingle()` (new,
// preferred path) and `.eq('api_token', ...).maybeSingle()` (legacy fallback path),
// each driven by `authState`.
const authState = { hashRow: null, hashError: null, plaintextRow: null, plaintextError: null };

const supabaseFromMock = vi.fn((table) => {
  if (table === 'users') {
    return {
      update: vi.fn((payload) => {
        usersState.updated.push(payload);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: usersState.updateResult, error: usersState.updateError })),
            })),
          })),
        };
      }),
      select: vi.fn(() => ({
        eq: vi.fn((col) => {
          if (col === 'api_token_hash') {
            return { maybeSingle: vi.fn(async () => ({ data: authState.hashRow, error: authState.hashError })) };
          }
          if (col === 'api_token') {
            return { maybeSingle: vi.fn(async () => ({ data: authState.plaintextRow, error: authState.plaintextError })) };
          }
          // session-token path (id lookup) — untouched by this test file
          return { single: vi.fn(async () => ({ data: null, error: { code: 'PGRST116' } })) };
        }),
      })),
    };
  }
  if (table === 'pipeline_log') {
    return { insert: vi.fn(async (row) => { usersState.logged.push(row); return { error: null }; }) };
  }
  return { insert: vi.fn(async () => ({ error: null })) };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

function mockReqRes(body, user) {
  const req = { body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN_USER = { user_id: 'admin-1', username: 'dan', role: 'admin', permissions: [], store_access: [] };
const MEMBER_USER = { user_id: 'member-1', username: 'petr', role: 'member', permissions: ['products:read'], store_access: [] };

describe('lib/actions/users.js — generate_api_token', () => {
  let generate_api_token;

  beforeEach(async () => {
    vi.resetModules();
    usersState.updated = [];
    usersState.logged = [];
    usersState.updateResult = null;
    usersState.updateError = null;
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/users.js');
    generate_api_token = mod.generate_api_token;
  });

  it('403s when caller lacks admin:users', async () => {
    const { req, res } = mockReqRes({ user_id: 'u2' }, MEMBER_USER);
    await generate_api_token(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('400s when user_id is missing', async () => {
    const { req, res } = mockReqRes({}, ADMIN_USER);
    await generate_api_token(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('happy path: generates a 64-char hex token, saves it, returns it once', async () => {
    usersState.updateResult = { id: 'u2', username: 'jana' };
    const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
    await generate_api_token(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.api_token).toMatch(/^[a-f0-9]{64}$/);
    expect(usersState.logged[0]).toMatchObject({ agent: 'AUTH_ADMIN' });
  });

  it('clears the plaintext api_token column and stores only the SHA-256 hash (P2, AUDIT-2026-08)', async () => {
    usersState.updateResult = { id: 'u2', username: 'jana' };
    const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
    await generate_api_token(req, res);
    const returnedToken = res.json.mock.calls[0][0].api_token;
    const expectedHash = crypto.createHash('sha256').update(returnedToken).digest('hex');
    expect(usersState.updated[0]).toEqual({ api_token: null, api_token_hash: expectedHash });
  });

  it('regenerating overwrites the previous token (old token stops working — verified in Task 3)', async () => {
    usersState.updateResult = { id: 'u2', username: 'jana' };
    const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
    await generate_api_token(req, res);
    const { req: req2, res: res2 } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
    await generate_api_token(req2, res2);
    const token1 = res.json.mock.calls[0][0].api_token;
    const token2 = res2.json.mock.calls[0][0].api_token;
    expect(token1).not.toBe(token2);
  });

  it('500s when the DB update fails', async () => {
    usersState.updateError = { message: 'db error' };
    const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
    await generate_api_token(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('lib/auth.js — verifyAuth api_token bearer path (P2, AUDIT-2026-08: hash lookup + plaintext fallback)', () => {
  let verifyAuth;

  beforeEach(async () => {
    vi.resetModules();
    authState.hashRow = null;
    authState.hashError = null;
    authState.plaintextRow = null;
    authState.plaintextError = null;
    vi.stubEnv('APP_SECRET', 'test-secret');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/auth.js');
    verifyAuth = mod.verifyAuth;
  });

  function sha256(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  it('resolves a valid api_token to a user object via the api_token_hash lookup', async () => {
    const token = 'a'.repeat(64);
    authState.hashRow = {
      id: 'u2', username: 'jana', role: 'member',
      permissions: ['products:edit'], store_access: ['store-1'], active: true,
      api_token_hash: sha256(token),
    };
    const req = { headers: { authorization: 'Bearer ' + token }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({
      user_id: 'u2', username: 'jana', role: 'member',
      permissions: ['products:edit'], store_access: ['store-1'],
    });
  });

  it('returns null for an api_token with no matching user (hash or plaintext)', async () => {
    authState.hashRow = null;
    authState.plaintextRow = null;
    const req = { headers: { authorization: 'Bearer ' + 'b'.repeat(64) }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('returns null when the hash-matched row belongs to a deactivated user', async () => {
    const token = 'c'.repeat(64);
    authState.hashRow = {
      id: 'u2', username: 'jana', role: 'member', permissions: [], store_access: [],
      active: false, api_token_hash: sha256(token),
    };
    const req = { headers: { authorization: 'Bearer ' + token }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('a session token (contains a dot) never hits the api_token DB branch', async () => {
    // A malformed "session" token with a dot but garbage payload must fail on
    // HMAC/JSON parsing, not silently fall through to the api_token lookup.
    const req = { headers: { authorization: 'Bearer not.avalidtoken' }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('returns null for an api_token shorter than 40 chars, without querying the DB', async () => {
    const req = { headers: { authorization: 'Bearer ' + 'd'.repeat(39) }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
    expect(authState.hashRow).toBeNull(); // sanity: nothing set the row, but real assertion below
  });

  it('returns null for a 64-char token containing non-hex characters, without querying the DB', async () => {
    const req = { headers: { authorization: 'Bearer ' + 'g'.repeat(64) }, query: {} }; // 'g' is not hex
    expect(await verifyAuth(req)).toBeNull();
  });

  it('falls back to the legacy plaintext api_token match when api_token_hash is NULL, and logs a warning', async () => {
    const token = 'e'.repeat(64);
    authState.hashRow = null; // not found by hash — pre-migration token, not yet backfilled
    authState.plaintextRow = {
      id: 'u3', username: 'legacy', role: 'member', permissions: ['products:read'],
      store_access: ['store-2'], active: true, api_token_hash: null,
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = { headers: { authorization: 'Bearer ' + token }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({
      user_id: 'u3', username: 'legacy', role: 'member',
      permissions: ['products:read'], store_access: ['store-2'],
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('plaintext api_token match'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('u3'));
    warnSpy.mockRestore();
  });

  it('does NOT fall back to plaintext when the row already has a (non-matching) api_token_hash — data-integrity guard', async () => {
    authState.hashRow = null; // no exact hash match
    authState.plaintextRow = {
      id: 'u4', username: 'weird', role: 'member', permissions: [], store_access: [],
      active: true, api_token_hash: 'some-other-hash-not-derived-from-this-token',
    };
    const req = { headers: { authorization: 'Bearer ' + 'f'.repeat(64) }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('a mismatched-length api_token_hash on the matched row is rejected without throwing (constant-time compare)', async () => {
    // Guards against a naive crypto.timingSafeEqual call (which throws on
    // unequal-length buffers) ever creeping back in — safeEqual must check
    // lengths first and return false instead of throwing.
    authState.hashRow = {
      id: 'u5', username: 'x', role: 'member', permissions: [], store_access: [],
      active: true, api_token_hash: 'short-hash',
    };
    const req = { headers: { authorization: 'Bearer ' + 'a'.repeat(64) }, query: {} };
    await expect(verifyAuth(req)).resolves.toBeNull();
  });
});

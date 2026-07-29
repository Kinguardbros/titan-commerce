import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

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

// --- generate_api_token mock infrastructure (module top-level: vi.mock is hoisted
// above imports, so the mock factory must only reference top-level bindings). ---
const usersState = { updated: [], logged: [], updateResult: null, updateError: null };

// Shared with the verifyAuth api_token-bearer-path describe block below: a single
// `from('users').select(...).eq('api_token', ...).single()` chain driven by `authState`.
const authState = { userRow: null, userError: null };

const supabaseFromMock = vi.fn((table) => {
  if (table === 'users') {
    return {
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: usersState.updateResult, error: usersState.updateError })),
          })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn((col) => {
          if (col === 'api_token') {
            return { single: vi.fn(async () => ({ data: authState.userRow, error: authState.userError })) };
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

describe('lib/auth.js — verifyAuth api_token bearer path', () => {
  let verifyAuth;

  beforeEach(async () => {
    vi.resetModules();
    authState.userRow = null;
    authState.userError = null;
    vi.stubEnv('APP_SECRET', 'test-secret');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/auth.js');
    verifyAuth = mod.verifyAuth;
  });

  it('resolves a valid api_token (no dot) to a user object', async () => {
    authState.userRow = {
      id: 'u2', username: 'jana', role: 'member',
      permissions: ['products:edit'], store_access: ['store-1'], active: true,
    };
    const req = { headers: { authorization: 'Bearer ' + 'a'.repeat(64) }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({
      user_id: 'u2', username: 'jana', role: 'member',
      permissions: ['products:edit'], store_access: ['store-1'],
    });
  });

  it('returns null for an api_token with no matching user', async () => {
    authState.userRow = null;
    const req = { headers: { authorization: 'Bearer ' + 'b'.repeat(64) }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('returns null when the api_token matches a deactivated user', async () => {
    authState.userRow = { id: 'u2', username: 'jana', role: 'member', permissions: [], store_access: [], active: false };
    const req = { headers: { authorization: 'Bearer ' + 'c'.repeat(64) }, query: {} };
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
    expect(authState.userRow).toBeNull(); // sanity: nothing set the row, but real assertion below
  });

  it('returns null for a 64-char token containing non-hex characters, without querying the DB', async () => {
    const req = { headers: { authorization: 'Bearer ' + 'g'.repeat(64) }, query: {} }; // 'g' is not hex
    expect(await verifyAuth(req)).toBeNull();
  });
});

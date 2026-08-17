import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const APP_SECRET = 'test-secret';
const APP_PASSWORD = 'master-pw';

function decodeToken(token) {
  const [payloadB64] = token.split('.');
  return JSON.parse(Buffer.from(payloadB64, 'base64').toString());
}

function signToken(payload, secret = APP_SECRET) {
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return `${payloadB64}.${signature}`;
}

const usersState = { row: null, updateError: null, lastUpdate: null };
const supabaseFromMock = vi.fn((table) => {
  if (table === 'users') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: usersState.row, error: usersState.row ? null : { code: 'PGRST116' } })),
        })),
      })),
      // Supports BOTH shapes used across lib/actions/users.js:
      //   update(x).eq(id)                       — bare await → {error}          (change_own_password)
      //   update(x).eq(id).select(cols).single()  — chained    → {data, error}    (reset_password)
      // Returning a Promise with a `.select` property attached lets `.eq()`'s
      // result satisfy both call patterns.
      update: vi.fn((payload) => {
        usersState.lastUpdate = payload;
        const result = {
          data: usersState.updateError ? null : { id: usersState.row?.id, username: usersState.row?.username },
          error: usersState.updateError,
        };
        return {
          eq: vi.fn(() => {
            const eqResult = Promise.resolve(result);
            eqResult.select = vi.fn(() => ({ single: vi.fn(async () => result) }));
            return eqResult;
          }),
        };
      }),
    };
  }
  if (table === 'pipeline_log') {
    return { insert: vi.fn(async () => ({ error: null })) };
  }
  return { insert: vi.fn(async () => ({ error: null })) };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

const verifyPasswordMock = vi.fn();
const hashPasswordMock = vi.fn(async () => 'dummy-salt:dummy-hash');
vi.mock('../lib/password.js', () => ({ verifyPassword: verifyPasswordMock, hashPassword: hashPasswordMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe('verifyAuth — master fallback', () => {
  let verifyAuth;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/auth.js');
    verifyAuth = mod.verifyAuth;
  });

  it('returns {master:true, role:"admin"} for a master token — skips DB lookup', async () => {
    const token = signToken({ master: true, expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ master: true, role: 'admin' });
    expect(supabaseFromMock).not.toHaveBeenCalledWith('users');
  });
});

describe('verifyAuth — real user', () => {
  let verifyAuth;
  beforeEach(async () => {
    vi.resetModules();
    supabaseFromMock.mockClear();
    usersState.row = null;
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/auth.js');
    verifyAuth = mod.verifyAuth;
  });

  it('fetches user from DB and returns full shape when active', async () => {
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: ['products:read'], store_access: ['s1'], active: true };
    const token = signToken({ user_id: 'u1', expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ user_id: 'u1', username: 'petr', role: 'member', permissions: ['products:read'], store_access: ['s1'] });
  });

  it('returns null when user no longer exists', async () => {
    usersState.row = null;
    const token = signToken({ user_id: 'ghost', expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('returns null when user is inactive', async () => {
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [], active: false };
    const token = signToken({ user_id: 'u1', expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('returns null for expired token before hitting the DB', async () => {
    const token = signToken({ user_id: 'u1', expires: Date.now() - 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
    expect(supabaseFromMock).not.toHaveBeenCalledWith('users');
  });

  // P1-15 (AUDIT-2026-08): session revocation via token_version.
  it('rejects a token whose tv claim no longer matches users.token_version', async () => {
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [], active: true, token_version: 3 };
    const token = signToken({ user_id: 'u1', tv: 1, expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('accepts a token whose tv claim matches users.token_version', async () => {
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [], active: true, token_version: 3 };
    const token = signToken({ user_id: 'u1', tv: 3, expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toEqual({ user_id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [] });
  });

  // Migration compat window (documented in lib/auth.js): tokens signed before
  // this deploy carry no `tv` claim at all — they must still pass for a short
  // window rather than logging out every currently active session the moment
  // this ships. A follow-up commit removes this branch.
  it('accepts a pre-migration token with no tv claim at all (compat window)', async () => {
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [], active: true, token_version: 3 };
    const token = signToken({ user_id: 'u1', expires: Date.now() + 60000 }); // no tv
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toEqual({ user_id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [] });
  });
});

describe('api/auth/login — new flow', () => {
  let handler;
  beforeEach(async () => {
    vi.resetModules();
    usersState.row = null;
    verifyPasswordMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('APP_PASSWORD', APP_PASSWORD);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../api/auth/login.js');
    handler = mod.default;
  });

  it('signs a master token when username is empty and password matches APP_PASSWORD', async () => {
    const req = { method: 'POST', body: { password: APP_PASSWORD }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const payload = decodeToken(res.body.token);
    expect(payload.master).toBe(true);
  });

  it('signs a real user token on valid username+password', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', role: 'member', permissions: ['products:read'], store_access: ['s1'], active: true };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { method: 'POST', body: { username: 'petr', password: 'pw123456' }, headers: { 'x-real-ip': '1.2.3.4' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const payload = decodeToken(res.body.token);
    expect(payload.user_id).toBe('u1');
    expect(payload.role).toBe('member');
    expect(payload.permissions).toEqual(['products:read']);
    expect(payload.store_access).toEqual(['s1']);
  });

  // P1-15 (AUDIT-2026-08): login must stamp the current token_version onto the
  // session token so verifyAuth can invalidate it later on password reset/change.
  it('includes tv (token_version) in the signed token payload', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', role: 'member', permissions: [], store_access: [], active: true, token_version: 7 };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { method: 'POST', body: { username: 'petr', password: 'pw123456' }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const payload = decodeToken(res.body.token);
    expect(payload.tv).toBe(7);
  });

  // P1-14 (AUDIT-2026-08): login must surface must_change_password so the
  // frontend can gate the dashboard behind a forced password-change screen.
  it('returns must_change_password from the login response', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', role: 'member', permissions: [], store_access: [], active: true, token_version: 1, must_change_password: true };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { method: 'POST', body: { username: 'petr', password: 'temp-pw' }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.must_change_password).toBe(true);
  });

  it('401s on wrong password for a real user', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', role: 'member', permissions: [], store_access: [], active: true };
    verifyPasswordMock.mockResolvedValue(false);
    const req = { method: 'POST', body: { username: 'petr', password: 'wrong' }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s on unknown username', async () => {
    usersState.row = null;
    const req = { method: 'POST', body: { username: 'ghost', password: 'x' }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401s when user is inactive even with correct password', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', role: 'member', permissions: [], store_access: [], active: false };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { method: 'POST', body: { username: 'petr', password: 'pw123456' }, headers: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('429s when per-IP rate limit trips', async () => {
    rateLimitMock.mockImplementation(async (key) => !key.startsWith('login_attempts:1.2.3.4'));
    const req = { method: 'POST', body: { username: 'petr', password: 'x' }, headers: { 'x-real-ip': '1.2.3.4' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(429);
  });

  it('unknown username still runs a password verification (constant-time defense)', async () => {
    usersState.row = null;
    verifyPasswordMock.mockResolvedValue(false);
    const req = { method: 'POST', body: { username: 'nonexistent', password: 'wrongpass' }, headers: { 'x-real-ip': '1.1.1.1' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(verifyPasswordMock).toHaveBeenCalledWith('wrongpass', 'dummy-salt:dummy-hash');
  });
});

describe('change_own_password — P1-14', () => {
  let change_own_password;
  let verifyAuth;
  beforeEach(async () => {
    vi.resetModules();
    supabaseFromMock.mockClear();
    usersState.row = null;
    usersState.updateError = null;
    usersState.lastUpdate = null;
    verifyPasswordMock.mockReset();
    hashPasswordMock.mockReset().mockResolvedValue('new-salt:new-hash');
    rateLimitMock.mockReset().mockResolvedValue(true);
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const usersMod = await import('../lib/actions/users.js');
    change_own_password = usersMod.change_own_password;
    const authMod = await import('../lib/auth.js');
    verifyAuth = authMod.verifyAuth;
  });

  it('valid current + new password → succeeds and bumps token_version', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', token_version: 1 };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { user: { user_id: 'u1', username: 'petr' }, body: { current_password: 'oldpass1', new_password: 'newpass123' } };
    const res = mockRes();
    await change_own_password(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(usersState.lastUpdate.token_version).toBe(2);
    expect(usersState.lastUpdate.must_change_password).toBe(false);
  });

  it('old token no longer verifies once token_version has been bumped', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', token_version: 1 };
    verifyPasswordMock.mockResolvedValue(true);
    const req = { user: { user_id: 'u1', username: 'petr' }, body: { current_password: 'oldpass1', new_password: 'newpass123' } };
    await change_own_password(req, mockRes());
    expect(usersState.lastUpdate.token_version).toBe(2);

    // Simulate the DB row now reflecting the bump, and try to verify a token
    // signed against the OLD token_version (as if the client had kept it).
    usersState.row = { id: 'u1', username: 'petr', role: 'member', permissions: [], store_access: [], active: true, token_version: 2 };
    const staleToken = signToken({ user_id: 'u1', tv: 1, expires: Date.now() + 60000 });
    const req2 = { headers: { authorization: `Bearer ${staleToken}` }, query: {} };
    expect(await verifyAuth(req2)).toBeNull();
  });

  it('wrong current password → 401', async () => {
    usersState.row = { id: 'u1', username: 'petr', password_hash: 'salt:hash', token_version: 1 };
    verifyPasswordMock.mockResolvedValue(false);
    const req = { user: { user_id: 'u1', username: 'petr' }, body: { current_password: 'wrongpass', new_password: 'newpass123' } };
    const res = mockRes();
    await change_own_password(req, res);
    expect(res.statusCode).toBe(401);
    expect(usersState.lastUpdate).toBeNull();
  });

  it('weak new password (< 8 chars) → 400', async () => {
    const req = { user: { user_id: 'u1', username: 'petr' }, body: { current_password: 'oldpass1', new_password: 'short' } };
    const res = mockRes();
    await change_own_password(req, res);
    expect(res.statusCode).toBe(400);
    expect(usersState.lastUpdate).toBeNull();
  });

  it('master account gets a clean 400 instead of a DB lookup — kill-switch preserved', async () => {
    const req = { user: { master: true, role: 'admin' }, body: { current_password: 'x', new_password: 'newpass123' } };
    const res = mockRes();
    await change_own_password(req, res);
    expect(res.statusCode).toBe(400);
    expect(supabaseFromMock).not.toHaveBeenCalledWith('users');
  });
});

describe('reset_password — P1-15 side effects', () => {
  let reset_password;
  beforeEach(async () => {
    vi.resetModules();
    usersState.row = null;
    usersState.updateError = null;
    usersState.lastUpdate = null;
    hashPasswordMock.mockReset().mockResolvedValue('temp-salt:temp-hash');
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/users.js');
    reset_password = mod.reset_password;
  });

  it('bumps token_version and sets must_change_password on the target user', async () => {
    usersState.row = { id: 'u2', username: 'target', token_version: 4 };
    const req = { user: { role: 'admin', username: 'admin1' }, body: { user_id: 'u2' } };
    const res = mockRes();
    await reset_password(req, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.temp_password).toBe('string');
    expect(usersState.lastUpdate.token_version).toBe(5);
    expect(usersState.lastUpdate.must_change_password).toBe(true);
  });

  it('403s for a non-admin caller without admin:users', async () => {
    const req = { user: { role: 'member', permissions: [] }, body: { user_id: 'u2' } };
    const res = mockRes();
    await reset_password(req, res);
    expect(res.statusCode).toBe(403);
    expect(usersState.lastUpdate).toBeNull();
  });
});

describe('master fallback survives the P1-14/P1-15 changes', () => {
  it('master login still signs a token with no tv claim, and verifyAuth still bypasses the tv check', async () => {
    vi.resetModules();
    supabaseFromMock.mockClear();
    usersState.row = null;
    rateLimitMock.mockReset().mockResolvedValue(true);
    vi.stubEnv('APP_SECRET', APP_SECRET);
    vi.stubEnv('APP_PASSWORD', APP_PASSWORD);
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const loginMod = await import('../api/auth/login.js');
    const req = { method: 'POST', body: { password: APP_PASSWORD }, headers: {} };
    const res = mockRes();
    await loginMod.default(req, res);
    expect(res.statusCode).toBe(200);
    const payload = decodeToken(res.body.token);
    expect(payload.master).toBe(true);
    expect(payload.tv).toBeUndefined();

    const authMod = await import('../lib/auth.js');
    const verifyReq = { headers: { authorization: `Bearer ${res.body.token}` }, query: {} };
    expect(await authMod.verifyAuth(verifyReq)).toEqual({ master: true, role: 'admin' });
    expect(supabaseFromMock).not.toHaveBeenCalledWith('users');
  });
});

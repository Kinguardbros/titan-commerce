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

const usersState = { row: null };
const supabaseFromMock = vi.fn((table) => {
  if (table === 'users') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: usersState.row, error: usersState.row ? null : { code: 'PGRST116' } })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
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

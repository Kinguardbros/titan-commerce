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

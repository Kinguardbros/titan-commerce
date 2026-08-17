import { describe, it, expect, vi, beforeEach } from 'vitest';

const usersState = { rows: [] };

function makeChain(overrides = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: usersState._single, error: usersState._singleError || null })),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return chain;
}

const supabaseFromMock = vi.fn((table) => {
  if (table === 'users') {
    return {
      select: vi.fn(() => ({
        order: vi.fn(async () => ({ data: usersState.rows, error: null })),
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: usersState._single, error: usersState._singleError || null })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: usersState._insertResult, error: usersState._insertError || null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: usersState._updateResult, error: usersState._updateError || null })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: usersState._deleteError || null })),
      })),
    };
  }
  if (table === 'pipeline_log') {
    return { insert: vi.fn(async (row) => { usersState.logged = usersState.logged || []; usersState.logged.push(row); return { error: null }; }) };
  }
  return makeChain();
});

// safe_update_user / safe_delete_user (P1-17, AUDIT-2026-08) — atomic Postgres
// RPCs that replaced the old read-then-write pattern. The mock simulates the
// SQL function's decision logic in JS so tests can drive it via usersState
// without a real DB: usersState.rows is the full user table, usersState._single
// (role/active only) identifies the RPC target for the last-admin check.
const supabaseRpcMock = vi.fn((fnName, args) => {
  const rpcResult = (data, error) => {
    const result = { data: data ?? null, error: error ?? null };
    // Mirrors supabase-js: .rpc(...).single() is chainable; only update_user uses it.
    result.single = async () => result;
    return result;
  };

  if (fnName === 'safe_update_user') {
    if (usersState._rpcError) return rpcResult(null, usersState._rpcError);
    const target = usersState._single;
    if (!target) return rpcResult(null, { message: 'user_not_found' });

    const updates = args.p_updates || {};
    const newRole = updates.role !== undefined ? updates.role : target.role;
    const newActive = updates.active !== undefined ? updates.active : target.active;
    if (target.role === 'admin' && target.active === true && (newRole !== 'admin' || newActive === false)) {
      const otherActiveAdmins = usersState.rows.filter(
        (u) => u.role === 'admin' && u.active && u.id !== args.p_user_id
      );
      if (otherActiveAdmins.length === 0) {
        return rpcResult(null, { message: 'last_active_admin' });
      }
    }
    return rpcResult(usersState._updateResult, usersState._updateError || null);
  }

  if (fnName === 'safe_delete_user') {
    if (usersState._rpcError) return rpcResult(null, usersState._rpcError);
    const target = usersState.rows.find((u) => u.id === args.p_user_id);
    if (!target) return rpcResult(null, { message: 'user_not_found' });
    if (target.role === 'admin' && target.active) {
      const otherActiveAdmins = usersState.rows.filter(
        (u) => u.role === 'admin' && u.active && u.id !== args.p_user_id
      );
      if (otherActiveAdmins.length === 0) {
        return rpcResult(null, { message: 'last_active_admin' });
      }
    }
    return rpcResult(true, usersState._deleteError || null);
  }

  return rpcResult(null, { message: `unmocked rpc: ${fnName}` });
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: supabaseFromMock, rpc: supabaseRpcMock }),
}));

const hashPasswordMock = vi.fn().mockResolvedValue('salt:hash');
vi.mock('../lib/password.js', () => ({ hashPassword: hashPasswordMock }));

function mockReqRes(body, user, query = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN_USER = { user_id: 'admin-1', username: 'dan', role: 'admin', permissions: [], store_access: [] };
const MEMBER_USER = { user_id: 'member-1', username: 'petr', role: 'member', permissions: ['products:read'], store_access: [] };

describe('lib/actions/users.js', () => {
  let users_list, create_user, update_user, delete_user, reset_password;

  beforeEach(async () => {
    vi.resetModules();
    usersState.rows = [];
    usersState.logged = [];
    usersState._single = null;
    usersState._singleError = null;
    usersState._insertResult = null;
    usersState._insertError = null;
    usersState._updateResult = null;
    usersState._updateError = null;
    usersState._deleteError = null;
    usersState._rpcError = null;
    supabaseRpcMock.mockClear();
    hashPasswordMock.mockClear().mockResolvedValue('salt:hash');
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/users.js');
    ({ users_list, create_user, update_user, delete_user, reset_password } = mod);
  });

  describe('users_list', () => {
    it('403s when caller lacks admin:users', async () => {
      const { req, res } = mockReqRes({}, MEMBER_USER);
      await users_list(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns all users with password_hash stripped', async () => {
      usersState.rows = [
        { id: 'u1', username: 'jana', password_hash: 'salt:secret', role: 'member', permissions: [], store_access: [], active: true },
      ];
      const { req, res } = mockReqRes({}, ADMIN_USER);
      await users_list(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.users).toHaveLength(1);
      expect(body.users[0].password_hash).toBeUndefined();
      expect(body.users[0].username).toBe('jana');
    });
  });

  describe('create_user', () => {
    it('403s when caller lacks admin:users', async () => {
      const { req, res } = mockReqRes({ username: 'x', password: 'y', role: 'member', permissions: [], store_access: [] }, MEMBER_USER);
      await create_user(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when required fields are missing', async () => {
      const { req, res } = mockReqRes({ username: 'jana' }, ADMIN_USER);
      await create_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400s when role is not admin/member', async () => {
      const { req, res } = mockReqRes({ username: 'jana', password: 'pw123456', role: 'superuser', permissions: [], store_access: [] }, ADMIN_USER);
      await create_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400s when permissions contains an unknown permission', async () => {
      const { req, res } = mockReqRes({ username: 'jana', password: 'pw123456', role: 'member', permissions: ['products:read', 'hack:everything'], store_access: [] }, ADMIN_USER);
      await create_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400s on duplicate username (unique violation)', async () => {
      usersState._insertError = { code: '23505', message: 'duplicate key value violates unique constraint "idx_users_username"' };
      const { req, res } = mockReqRes({ username: 'jana', password: 'pw123456', role: 'member', permissions: ['products:read'], store_access: [] }, ADMIN_USER);
      await create_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].error).toMatch(/username/i);
    });

    it('happy path: hashes password, inserts, strips password_hash from response', async () => {
      usersState._insertResult = {
        id: 'u2', username: 'jana', password_hash: 'salt:hash', role: 'member',
        permissions: ['products:read', 'products:edit'], store_access: ['store-1'], active: true,
      };
      const { req, res } = mockReqRes({
        username: 'jana', password: 'pw123456', role: 'member',
        permissions: ['products:read', 'products:edit'], store_access: ['store-1'],
      }, ADMIN_USER);
      await create_user(req, res);
      expect(hashPasswordMock).toHaveBeenCalledWith('pw123456');
      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.user.password_hash).toBeUndefined();
      expect(body.user.username).toBe('jana');
      expect(usersState.logged[0]).toMatchObject({ agent: 'AUTH_ADMIN' });
    });
  });

  describe('update_user', () => {
    it('403s when caller lacks admin:users', async () => {
      const { req, res } = mockReqRes({ user_id: 'u2', active: false }, MEMBER_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when user_id is missing', async () => {
      const { req, res } = mockReqRes({ active: false }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400s when permissions contains an unknown permission', async () => {
      const { req, res } = mockReqRes({ user_id: 'u2', permissions: ['not:real'] }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: patches role/permissions/store_access/active, never touches username or password', async () => {
      usersState._single = { role: 'member', active: true };
      usersState._updateResult = {
        id: 'u2', username: 'jana', password_hash: 'salt:hash', role: 'member',
        permissions: ['products:read'], store_access: [], active: false,
      };
      const { req, res } = mockReqRes({ user_id: 'u2', active: false, permissions: ['products:read'] }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.user.password_hash).toBeUndefined();
      expect(body.user.active).toBe(false);
    });

    it('409s when deactivating the last active admin (active:false) — atomic RPC guard', async () => {
      // P1-17, AUDIT-2026-08: the count-check now happens inside safe_update_user
      // (Postgres RPC, FOR UPDATE locks), not a separate JS-side SELECT. The
      // RPC raises 'last_active_admin', which update_user maps to 409.
      usersState._single = { role: 'admin', active: true };
      usersState.rows = [{ id: 'admin-1', role: 'admin', active: true }];
      const { req, res } = mockReqRes({ user_id: 'admin-1', active: false }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].error).toMatch(/last active admin/i);
    });

    it("409s when demoting the last active admin (role:'member') — atomic RPC guard", async () => {
      usersState._single = { role: 'admin', active: true };
      usersState.rows = [{ id: 'admin-1', role: 'admin', active: true }];
      const { req, res } = mockReqRes({ user_id: 'admin-1', role: 'member' }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].error).toMatch(/last active admin/i);
    });

    it("succeeds demoting an admin when a second active admin exists", async () => {
      usersState._single = { role: 'admin', active: true };
      usersState.rows = [
        { id: 'admin-1', role: 'admin', active: true },
        { id: 'admin-2', role: 'admin', active: true },
      ];
      usersState._updateResult = {
        id: 'admin-1', username: 'jana', password_hash: 'salt:hash', role: 'member',
        permissions: [], store_access: [], active: true,
      };
      const { req, res } = mockReqRes({ user_id: 'admin-1', role: 'member' }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].user.role).toBe('member');
    });

    it('404s when the RPC reports the target user does not exist', async () => {
      usersState._single = null;
      const { req, res } = mockReqRes({ user_id: 'ghost', active: false }, ADMIN_USER);
      await update_user(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    // The atomic guarantee itself (two concurrent demote calls against 2
    // different admins, only one succeeding) is enforced by Postgres FOR
    // UPDATE row locks inside safe_update_user/safe_delete_user — it cannot
    // be raced in-process against a mocked client. This is verified at the
    // DB layer (sql/add-safe-admin-update-fn.sql); these JS tests only cover
    // that update_user/delete_user map the RPC's 'last_active_admin' /
    // 'user_not_found' exceptions to the right HTTP status codes.
  });

  describe('delete_user', () => {
    it('403s when caller lacks admin:users', async () => {
      const { req, res } = mockReqRes({ user_id: 'u2' }, MEMBER_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when user_id is missing', async () => {
      const { req, res } = mockReqRes({}, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('409s when deleting the last active admin — atomic RPC guard', async () => {
      // P1-17, AUDIT-2026-08: safe_delete_user (Postgres RPC) raises
      // 'last_active_admin', mapped here to 409.
      usersState.rows = [{ id: 'admin-1', role: 'admin', active: true }];
      const { req, res } = mockReqRes({ user_id: 'admin-1' }, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].error).toMatch(/last admin/i);
    });

    it('404s when the RPC reports the target user does not exist', async () => {
      usersState.rows = [];
      const { req, res } = mockReqRes({ user_id: 'ghost' }, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('happy path: deletes a member user', async () => {
      usersState.rows = [
        { id: 'admin-1', role: 'admin', active: true },
        { id: 'u2', role: 'member', active: true },
      ];
      const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0]).toEqual({ ok: true });
    });

    it('allows deleting an admin when another active admin remains', async () => {
      usersState.rows = [
        { id: 'admin-1', role: 'admin', active: true },
        { id: 'admin-2', role: 'admin', active: true },
      ];
      const { req, res } = mockReqRes({ user_id: 'admin-2' }, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('reset_password', () => {
    it('403s when caller lacks admin:users', async () => {
      const { req, res } = mockReqRes({ user_id: 'u2' }, MEMBER_USER);
      await reset_password(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when user_id is missing', async () => {
      const { req, res } = mockReqRes({}, ADMIN_USER);
      await reset_password(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: generates a 12-char temp password, hashes it, saves, returns it in the response', async () => {
      // reset_password now does a preliminary select() for token_version
      // (P1-15, AUDIT-2026-08 — bumped so the reset invalidates existing
      // sessions) before the update — needs a truthy row to pass that lookup.
      usersState._single = { token_version: 3 };
      usersState._updateResult = { id: 'u2', username: 'jana' };
      const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
      await reset_password(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.temp_password).toHaveLength(12);
      expect(hashPasswordMock).toHaveBeenCalledWith(body.temp_password);
      expect(usersState.logged[0]).toMatchObject({ agent: 'AUTH_ADMIN' });
    });

    it('404s when the target user cannot be found for the token_version lookup', async () => {
      usersState._single = null;
      const { req, res } = mockReqRes({ user_id: 'ghost' }, ADMIN_USER);
      await reset_password(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

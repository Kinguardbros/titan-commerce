# Users & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-shared `APP_PASSWORD` with per-user login (username+password), granular permissions, and per-store access. Admin can create/manage members through UI.

**Architecture:** Users stored in Postgres (Supabase); passwords hashed with Node built-in `crypto.scrypt` (zero-dep). Session token extended with `user_id` + `permissions` + `store_access`; `withAuth` middleware fetches the user from DB on every request. Every action in `lib/actions/*` gets a `hasPermission()` + `hasStoreAccess()` check at top. Frontend filters tabs/stores/buttons per user permissions. Admin-only Settings > Users UI for CRUD. `APP_PASSWORD` retained as master backdoor (kill-switch safety).

**Tech Stack:** React 19 + Vite frontend (`apps/dashboard/`); Vercel Serverless Functions (Node) backend; Supabase Postgres (service-role, RLS bypassed by design); `crypto.scrypt` (Node built-in) for password hashing; Vitest (node env) for tests.

## Global Constraints

- **Vercel Hobby 12/12 routes** — NO new `api/*.js` files; all 5 new actions go through `api/system.js` (`?action=X` GET / `{ action }` POST body)
- **Password hashing = `crypto.scrypt`** (Node built-in, zero dep). NO bcrypt/argon2/bcryptjs npm dependency — this OVERRIDES the spec's D-01 (bcryptjs) per explicit instruction from Dan; scrypt needs no native build step and ships with Node, which is strictly safer on Vercel's serverless build image than even pure-JS bcrypt.
- **`catch (e) {}` FORBIDDEN** — always `console.error` + rethrow, or a graceful error response
- **`npm install` always with `--legacy-peer-deps`** (Higgsfield peer conflict) — not needed for this feature since no new deps are added, but any install must use this flag
- **Files ≤ 300 lines** — extract sub-components if a modified file would cross this
- **Language** — UI text: English; code + comments: English; Docs (`Docs/superpowers/plans/*`): Czech is NOT required here, this is an English-authored engineering plan per existing precedent (see reference plan `2026-07-23-publications-manager.md`, also English)
- **`pipeline_log.agent` names for this feature:** `AUTH` (login events — already in the registered agent list), `AUTH_ADMIN` (admin user CRUD), `MASTER` (APP_PASSWORD fallback usage)
- **Action names** = flat `snake_case`, no dot-namespace
- **Rate limits (via `lib/rate-limit.js`, Supabase-backed, fails open):**
  - `login_attempts:${ip}` — 10 per 3 600 000 ms (1 hour)
  - `login_attempts:${username}` — 5 per 900 000 ms (15 min) — credential-stuffing guard
  - `login_attempts_global` — 200 per 3 600 000 ms (1 hour)
- **Client IP for rate-limiting** = `req.headers['x-real-ip']` (Vercel-set, non-spoofable — same pattern as `lib/actions/reviews-public.js`)
- **`APP_PASSWORD` fallback ALWAYS works** — kill-switch safety net, never removed
- **Users table:** `username` UNIQUE, `role` CHECK IN `('admin','member')`, `password_hash` NEVER leaves the backend (stripped from every response)
- **`PERMISSION_LIST` is a closed set** (validated on `create_user`/`update_user`): `products:read`, `products:edit`, `products:images`, `products:publications`, `creatives:generate`, `admin:users`
- **`role='admin'` implicitly grants all permissions + all store access** — explicit `permissions`/`store_access` on an admin row is ignored by `hasPermission`/`hasStoreAccess` (admin trumps)
- **Session token payload changes are breaking** — old tokens (`{authenticated:true}`) fail the new `verifyAuth` shape check → treated as invalid → forces re-login. Documented as a manual step (Task 11): clear `localStorage.auth_token` after deploy.
- **`req.user` shape after this feature:**
  - Master fallback: `{ master: true, role: 'admin' }`
  - Real user: `{ user_id, username, role, permissions: string[], store_access: string[] }`

---

## File Structure

**Create (new files):**
- `sql/add-users-and-permissions.sql` — `users` table + indexes + RLS
- `lib/permissions.js` — `PERMISSION_LIST`, `ADMIN_ROLE`, `hasPermission()`, `hasStoreAccess()`
- `lib/password.js` — `hashPassword()`, `verifyPassword()` (scrypt)
- `lib/actions/users.js` — `users_list`, `create_user`, `update_user`, `delete_user`, `reset_password`
- `apps/dashboard/src/hooks/useUser.jsx` — `UserProvider` + `useUser()`
- `apps/dashboard/src/components/PermissionGate.jsx`
- `apps/dashboard/src/pages/Settings.jsx`
- `apps/dashboard/src/components/settings/UsersManager.jsx` (+ `.css`)
- `apps/dashboard/src/components/settings/UserForm.jsx` (+ `.css`)
- `apps/dashboard/src/components/settings/PermissionCheckboxes.jsx`
- `apps/dashboard/src/components/settings/StoreAccessCheckboxes.jsx`
- `scripts/create-first-admin.mjs` — one-shot admin bootstrap script
- `tests/permissions.test.js`
- `tests/password.test.js`
- `tests/users.test.js`
- `tests/auth-multi-user.test.js`

**Modify (existing files):**
- `lib/auth.js` — `verifyAuth` fetches full user from DB; new payload shape
- `api/auth/login.js` — accepts `{username, password, remember}`, DB lookup, rate limiting
- `api/system.js` — register 5 new actions + `me` action; import + wire permission checks are NOT done here (done per-action-module in Tasks 5-6)
- `lib/actions/products.js`, `lib/actions/publications.js`, `lib/actions/exports.js`, `lib/actions/optimizations.js`, `lib/actions/pricing.js` — Wave 1 permission checks
- `lib/actions/creatives.js`, `lib/actions/skills.js`, `lib/actions/avatars.js`, `lib/actions/custom-styles.js`, `lib/actions/size-chart.js`, `lib/actions/reviews.js`, `lib/actions/reviews-import.js`, `lib/actions/reviews-ai.js`, `lib/actions/reviews-photo.js`, `lib/actions/reviews-push.js`, `lib/actions/sync.js`, `lib/actions/webhooks.js`, `lib/actions/docs.js`, `lib/actions/proposals.js`, `lib/actions/analytics.js`, `lib/actions/profit.js`, `lib/actions/stores.js` — Wave 2 permission checks
- `apps/dashboard/src/pages/Login.jsx` — username field
- `apps/dashboard/src/App.jsx` — `UserProvider` wrap, tab filtering, Settings tab, store filter
- `apps/dashboard/src/hooks/useActiveStore.jsx` — filter stores to `user.store_access`
- `apps/dashboard/src/lib/api.js` — 403 handling + new API wrappers
- `apps/dashboard/src/pages/Products.jsx`, `apps/dashboard/src/components/ProductDetail.jsx`, `apps/dashboard/src/components/VariantEditor.jsx`, `apps/dashboard/src/components/ImageManager.jsx`, `apps/dashboard/src/components/MetafieldEditor.jsx` — permission-gated buttons
- `CLAUDE.md` — document users table, `PERMISSION_LIST`, admin flow, `req.user` shape change
- `features/active/02-users-and-permissions.md` → moved to `features/shipped/`

---

### Task 1: DB migration + `lib/permissions.js`

**Files:**
- Create: `sql/add-users-and-permissions.sql`
- Create: `lib/permissions.js`
- Test: `tests/permissions.test.js`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces:
  - `PERMISSION_LIST` — `['products:read', 'products:edit', 'products:images', 'products:publications', 'creatives:generate', 'admin:users']`
  - `ADMIN_ROLE = 'admin'`
  - `hasPermission(user, perm) → boolean`
  - `hasStoreAccess(user, storeId) → boolean`
  - `users` table schema (see Step 5)

- [ ] **Step 1: Write the failing test**

Create `tests/permissions.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { hasPermission, hasStoreAccess, PERMISSION_LIST, ADMIN_ROLE } from '../lib/permissions.js';

describe('PERMISSION_LIST', () => {
  it('is the closed set of 6 permissions', () => {
    expect(PERMISSION_LIST).toEqual([
      'products:read',
      'products:edit',
      'products:images',
      'products:publications',
      'creatives:generate',
      'admin:users',
    ]);
  });
});

describe('ADMIN_ROLE', () => {
  it('is "admin"', () => {
    expect(ADMIN_ROLE).toBe('admin');
  });
});

describe('hasPermission', () => {
  it('returns true when member has the exact permission', () => {
    const user = { role: 'member', permissions: ['products:read', 'products:edit'] };
    expect(hasPermission(user, 'products:edit')).toBe(true);
  });

  it('returns false when member lacks the permission', () => {
    const user = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(user, 'products:edit')).toBe(false);
  });

  it('returns true for admin regardless of explicit permissions array', () => {
    const user = { role: 'admin', permissions: [] };
    expect(hasPermission(user, 'admin:users')).toBe(true);
    expect(hasPermission(user, 'products:edit')).toBe(true);
  });

  it('returns true for master fallback user', () => {
    const user = { master: true, role: 'admin' };
    expect(hasPermission(user, 'admin:users')).toBe(true);
  });

  it('returns false when user is null/undefined', () => {
    expect(hasPermission(null, 'products:read')).toBe(false);
    expect(hasPermission(undefined, 'products:read')).toBe(false);
  });

  it('returns false for an unknown permission string (no crash)', () => {
    const user = { role: 'member', permissions: ['products:read'] };
    expect(hasPermission(user, 'foo:bar')).toBe(false);
  });
});

describe('hasStoreAccess', () => {
  it('returns true when member store_access includes the store', () => {
    const user = { role: 'member', store_access: ['store-1', 'store-2'] };
    expect(hasStoreAccess(user, 'store-1')).toBe(true);
  });

  it('returns false when member store_access does not include the store', () => {
    const user = { role: 'member', store_access: ['store-1'] };
    expect(hasStoreAccess(user, 'store-2')).toBe(false);
  });

  it('returns true for admin regardless of store_access', () => {
    const user = { role: 'admin', store_access: [] };
    expect(hasStoreAccess(user, 'any-store')).toBe(true);
  });

  it('returns true for master fallback user', () => {
    const user = { master: true, role: 'admin' };
    expect(hasStoreAccess(user, 'any-store')).toBe(true);
  });

  it('returns false when store_access is empty for a member', () => {
    const user = { role: 'member', store_access: [] };
    expect(hasStoreAccess(user, 'store-1')).toBe(false);
  });

  it('returns false when user is null/undefined', () => {
    expect(hasStoreAccess(null, 'store-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/permissions.test.js`

Expected: FAIL — `Cannot find module '../lib/permissions.js'`.

- [ ] **Step 3: Implement `lib/permissions.js`**

Create `lib/permissions.js`:

```javascript
// Closed permission set — validated on create_user/update_user (lib/actions/users.js).
// role='admin' implicitly grants ALL permissions + ALL store access; explicit
// permissions/store_access on an admin row are ignored (admin trumps).
export const PERMISSION_LIST = [
  'products:read',
  'products:edit',
  'products:images',
  'products:publications',
  'creatives:generate',
  'admin:users',
];

export const ADMIN_ROLE = 'admin';

/**
 * @param {{role?: string, permissions?: string[], master?: boolean}|null} user
 * @param {string} perm
 * @returns {boolean}
 */
export function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

/**
 * @param {{role?: string, store_access?: string[], master?: boolean}|null} user
 * @param {string} storeId
 * @returns {boolean}
 */
export function hasStoreAccess(user, storeId) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  return Array.isArray(user.store_access) && user.store_access.includes(storeId);
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/permissions.test.js`

Expected: PASS (13/13).

- [ ] **Step 5: Write the SQL migration file**

Create `sql/add-users-and-permissions.sql`:

```sql
-- Users & Permissions feature migration (2026-07-24)
-- Paste into Supabase SQL Editor. No BEGIN/COMMIT — Supabase editor runs single statements.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  store_access UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth only — backend uses the service-role key (bypasses RLS by design,
-- per CLAUDE.md). This policy protects against a leaked anon/authenticated key.
CREATE POLICY IF NOT EXISTS "authenticated_select_users" ON users
  FOR SELECT
  USING (auth.role() = 'authenticated');
```

- [ ] **Step 6: Verify SQL migration is well-formed**

Run: `grep -c 'CREATE TABLE IF NOT EXISTS\|CREATE UNIQUE INDEX IF NOT EXISTS\|CREATE INDEX IF NOT EXISTS' sql/add-users-and-permissions.sql`

Expected output: `3`

(SQL must be applied against the live Supabase project as a manual step in Task 11 — no code execution here.)

- [ ] **Step 7: Commit**

```bash
git add sql/add-users-and-permissions.sql lib/permissions.js tests/permissions.test.js
git commit -m "feat(users): users table migration + hasPermission/hasStoreAccess helpers"
```

---

### Task 2: Password hashing (`lib/password.js`)

**Files:**
- Create: `lib/password.js`
- Test: `tests/password.test.js`

**Interfaces:**
- Consumes: nothing (Node built-in `crypto` only)
- Produces:
  - `hashPassword(password: string) → Promise<string>` — format `${salt}:${derivedKeyHex}`
  - `verifyPassword(password: string, hashString: string) → Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `tests/password.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips: verifyPassword matches the original password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('produces a hash in the "salt:derivedKey" format', async () => {
    const hash = await hashPassword('some-password');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[a-f0-9]{32}$/); // 16-byte salt as hex
    expect(parts[1]).toMatch(/^[a-f0-9]{128}$/); // 64-byte derived key as hex
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  });

  it('handles a malformed hash gracefully (returns false, does not throw)', async () => {
    await expect(verifyPassword('any-password', 'not-a-valid-hash')).resolves.toBe(false);
  });

  it('handles an empty hash string gracefully', async () => {
    await expect(verifyPassword('any-password', '')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/password.test.js`

Expected: FAIL — `Cannot find module '../lib/password.js'`.

- [ ] **Step 3: Implement `lib/password.js`**

Create `lib/password.js`:

```javascript
// Password hashing via Node's built-in crypto.scrypt — zero external dependency,
// no native build step (safe on Vercel serverless), sufficient for a 5-10 user
// internal tool (not a consumer-scale auth surface).
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

/**
 * @param {string} password
 * @returns {Promise<string>} "${saltHex}:${derivedKeyHex}"
 */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LEN);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * @param {string} password
 * @param {string} hashString - "${saltHex}:${derivedKeyHex}"
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hashString) {
  try {
    const [salt, keyHex] = String(hashString || '').split(':');
    if (!salt || !keyHex) return false;
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (keyBuf.length !== KEY_LEN) return false;
    const derivedKey = await scryptAsync(password, salt, KEY_LEN);
    return timingSafeEqual(keyBuf, derivedKey);
  } catch (err) {
    console.error('[password] verifyPassword failed:', err.message);
    return false;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/password.test.js`

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/password.js tests/password.test.js
git commit -m "feat(users): scrypt-based password hashing (hashPassword/verifyPassword)"
```

---

### Task 3: `lib/actions/users.js` — users CRUD backend

**Files:**
- Create: `lib/actions/users.js`
- Modify: `api/system.js` (imports + `POST_ACTIONS` + `GET_ACTIONS`)
- Test: `tests/users.test.js`

**Interfaces:**
- Consumes:
  - `hasPermission(user, perm)` from `lib/permissions.js` (Task 1)
  - `PERMISSION_LIST` from `lib/permissions.js` (Task 1)
  - `hashPassword(password)` from `lib/password.js` (Task 2)
  - `req.user` — the CURRENT shape is still `{authenticated:true}` until Task 4 lands; this task's tests inject the FUTURE shape (`{user_id, role, permissions, store_access}`) directly via `mockReqRes`, since `lib/actions/users.js` only reads `req.user`, it doesn't care how it got populated
- Produces:
  - POST action `create_user` — body `{ username, password, full_name?, email?, role, permissions, store_access }` → `201 { user: {...without password_hash} }`
  - POST action `update_user` — body `{ user_id, role?, permissions?, store_access?, active?, full_name?, email? }` → `200 { user: {...} }`
  - POST action `delete_user` — body `{ user_id }` → `200 { ok: true }`
  - POST action `reset_password` — body `{ user_id }` → `200 { temp_password: string }`
  - GET action `users_list` — query `{}` → `200 { users: [{...without password_hash}] }`

- [ ] **Step 1: Write the failing test**

Create `tests/users.test.js`:

```javascript
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

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

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

    it('400s when deleting the last active admin', async () => {
      usersState.rows = [{ id: 'admin-1', role: 'admin', active: true }];
      const { req, res } = mockReqRes({ user_id: 'admin-1' }, ADMIN_USER);
      await delete_user(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].error).toMatch(/last admin/i);
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
      usersState._updateResult = { id: 'u2', username: 'jana' };
      const { req, res } = mockReqRes({ user_id: 'u2' }, ADMIN_USER);
      await reset_password(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.temp_password).toHaveLength(12);
      expect(hashPasswordMock).toHaveBeenCalledWith(body.temp_password);
      expect(usersState.logged[0]).toMatchObject({ agent: 'AUTH_ADMIN' });
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/users.test.js`

Expected: FAIL — `Cannot find module '../lib/actions/users.js'`.

- [ ] **Step 3: Implement `lib/actions/users.js`**

Create `lib/actions/users.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { hasPermission, PERMISSION_LIST } from '../permissions.js';
import { hashPassword } from '../password.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function stripHash(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

function validPermissions(permissions) {
  return Array.isArray(permissions) && permissions.every((p) => PERMISSION_LIST.includes(p));
}

function randomTempPassword() {
  // 12-char temp password: mixed alnum, admin copies it to hand to the user out-of-band.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function users_list(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, username, full_name, email, role, permissions, store_access, active, created_at, last_login, password_hash')
    .order('username');
  if (error) {
    console.error('[users_list] query failed:', error);
    return res.status(500).json({ error: 'failed to load users' });
  }
  return res.status(200).json({ users: (data || []).map(stripHash) });
}

export async function create_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { username, password, full_name, email, role, permissions, store_access } = req.body || {};
  if (!username || !password || !role || !Array.isArray(permissions) || !Array.isArray(store_access)) {
    return res.status(400).json({ error: 'username, password, role, permissions[], store_access[] required' });
  }
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (!validPermissions(permissions)) {
    return res.status(400).json({ error: 'permissions must be a subset of PERMISSION_LIST', valid: PERMISSION_LIST });
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('users')
    .insert({
      username, password_hash, full_name: full_name || null, email: email || null,
      role, permissions, store_access, active: true,
    })
    .select('id, username, full_name, email, role, permissions, store_access, active, created_at, last_login, password_hash')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: `username "${username}" is already taken` });
    }
    console.error('[create_user] insert failed:', error);
    return res.status(500).json({ error: 'failed to create user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'info',
    message: `Admin ${req.user.username || req.user.user_id} created user "${username}" (role=${role})`,
    metadata: { created_user_id: data.id, role, permissions, store_access },
  });

  return res.status(201).json({ user: stripHash(data) });
}

export async function update_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id, role, permissions, store_access, active, full_name, email } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (role !== undefined && !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (permissions !== undefined && !validPermissions(permissions)) {
    return res.status(400).json({ error: 'permissions must be a subset of PERMISSION_LIST', valid: PERMISSION_LIST });
  }

  // Explicitly NOT patchable here: username, password_hash. Password changes go
  // through reset_password; username is immutable after creation.
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (permissions !== undefined) updates.permissions = permissions;
  if (store_access !== undefined) updates.store_access = store_access;
  if (active !== undefined) updates.active = active;
  if (full_name !== undefined) updates.full_name = full_name;
  if (email !== undefined) updates.email = email;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user_id)
    .select('id, username, full_name, email, role, permissions, store_access, active, created_at, last_login, password_hash')
    .single();

  if (error) {
    console.error('[update_user] update failed:', error);
    return res.status(500).json({ error: 'failed to update user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'info',
    message: `Admin ${req.user.username || req.user.user_id} updated user ${user_id}: ${Object.keys(updates).join(', ')}`,
    metadata: { target_user_id: user_id, updates },
  });

  return res.status(200).json({ user: stripHash(data) });
}

export async function delete_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: allUsers, error: listErr } = await supabase.from('users').select('id, role, active');
  if (listErr) {
    console.error('[delete_user] failed to list users for last-admin check:', listErr);
    return res.status(500).json({ error: 'failed to verify admin count' });
  }
  const target = (allUsers || []).find((u) => u.id === user_id);
  if (target?.role === 'admin' && target?.active) {
    const activeAdmins = (allUsers || []).filter((u) => u.role === 'admin' && u.active);
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ error: 'cannot delete the last admin — promote another user first' });
    }
  }

  const { error } = await supabase.from('users').delete().eq('id', user_id);
  if (error) {
    console.error('[delete_user] delete failed:', error);
    return res.status(500).json({ error: 'failed to delete user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} deleted user ${user_id}`,
    metadata: { deleted_user_id: user_id },
  });

  return res.status(200).json({ ok: true });
}

export async function reset_password(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const temp_password = randomTempPassword();
  const password_hash = await hashPassword(temp_password);

  const { data, error } = await supabase
    .from('users')
    .update({ password_hash })
    .eq('id', user_id)
    .select('id, username')
    .single();

  if (error) {
    console.error('[reset_password] update failed:', error);
    return res.status(500).json({ error: 'failed to reset password' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} reset password for user "${data.username}"`,
    metadata: { target_user_id: user_id },
  });

  return res.status(200).json({ temp_password });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/users.test.js`

Expected: PASS (16/16).

- [ ] **Step 5: Register the 5 actions in `api/system.js`**

Edit `api/system.js`. Add to the import block (after the `bulk_make_unlisted, bulk_make_listed` import line):

```javascript
import { users_list, create_user, update_user, delete_user, reset_password } from '../lib/actions/users.js';
```

Add `users_list` to `GET_ACTIONS` (after `review_helpful_counts,`):

```javascript
  users_list,
```

Add the other 4 to `POST_ACTIONS` (after `bulk_make_listed,`):

```javascript
  create_user,
  update_user,
  delete_user,
  reset_password,
```

- [ ] **Step 6: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (81 baseline + 13 permissions + 6 password + 16 users = 116).

- [ ] **Step 7: Commit**

```bash
git add lib/actions/users.js api/system.js tests/users.test.js
git commit -m "feat(users): users CRUD actions (list/create/update/delete/reset_password)"
```

---

### Task 4: New login flow — `lib/auth.js` + `api/auth/login.js`

**Files:**
- Modify: `lib/auth.js`
- Modify: `api/auth/login.js`
- Test: `tests/auth-multi-user.test.js`

**Interfaces:**
- Consumes:
  - `verifyPassword(password, hash)` from `lib/password.js` (Task 2)
  - `rateLimit(key, max, windowMs)` from `lib/rate-limit.js` (existing)
- Produces:
  - `verifyAuth(req) → Promise<user|null>` — `user` is `{master:true, role:'admin'}` OR `{user_id, username, role, permissions, store_access}` OR `null`
  - `withAuth(handler)` — unchanged interface, sets `req.user` to the above shape
  - `POST /api/auth/login` body `{ username?, password, remember? }` → `200 { token }` or `401`/`429`

- [ ] **Step 1: Write the failing test**

Create `tests/auth-multi-user.test.js`:

```javascript
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
vi.mock('../lib/password.js', () => ({ verifyPassword: verifyPasswordMock }));

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
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/auth-multi-user.test.js`

Expected: FAIL — `verifyAuth` still returns `{authenticated:true}`, login handler still uses old `{password}`-only shape.

- [ ] **Step 3: Rewrite `lib/auth.js`**

Replace the full contents of `lib/auth.js`:

```javascript
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Read APP_SECRET at use-time and FAIL CLOSED if it's missing — never fall back to a
// known default (a public default secret = forgeable session tokens = auth bypass).
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not set — refusing to sign/verify tokens with a default');
  return s;
}

/**
 * Decodes + HMAC-verifies the session token, then resolves it to a user object.
 * - master token ({master:true}) → {master:true, role:'admin'} — no DB round-trip
 * - user token ({user_id}) → re-fetches the user from DB every request (must exist + be active)
 * @returns {Promise<{master:true,role:'admin'}|{user_id:string,username:string,role:string,permissions:string[],store_access:string[]}|null>}
 */
export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : req.query?.token;
  if (!token) return null;

  try {
    const [payloadB64, signature] = token.split('.');
    const payloadStr = Buffer.from(payloadB64, 'base64').toString();
    const payload = JSON.parse(payloadStr);

    const expectedSig = crypto.createHmac('sha256', appSecret()).update(payloadStr).digest('hex');
    if (signature !== expectedSig) return null;

    if (payload.expires < Date.now()) return null;

    if (payload.master) {
      return { master: true, role: 'admin' };
    }

    if (!payload.user_id) return null;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, role, permissions, store_access, active')
      .eq('id', payload.user_id)
      .single();

    if (error || !user || !user.active) return null;

    return {
      user_id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
      store_access: user.store_access || [],
    };
  } catch (err) {
    console.error('[Auth] Token verification failed:', { error: err.message });
    return null;
  }
}

// Actions reachable WITHOUT a dashboard token (public storefront → TC). Hardcoded
// allow-list (never derived from user input) so only these exact actions skip auth;
// every other action stays protected. Keep this list tiny and audited.
const PUBLIC_ACTIONS = new Set(['submit_review_public', 'vote_review_helpful', 'review_helpful_counts']);

export function withAuth(handler) {
  return async (req, res) => {
    const action = req.query?.action || req.body?.action;
    if (PUBLIC_ACTIONS.has(action)) {
      return handler(req, res); // public allow-list — no token required
    }
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}
```

- [ ] **Step 4: Rewrite `api/auth/login.js`**

Replace the full contents of `api/auth/login.js`:

```javascript
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyPassword } from '../../lib/password.js';
import { rateLimit } from '../../lib/rate-limit.js';

const APP_PASSWORD = process.env.APP_PASSWORD;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Fail closed if APP_SECRET is missing — never sign tokens with a known default.
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not set');
  return s;
}

function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim() || 'unknown';
}

function signToken(payload) {
  const payloadStr = JSON.stringify(payload);
  return Buffer.from(payloadStr).toString('base64')
    + '.' + crypto.createHmac('sha256', appSecret()).update(payloadStr).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password, remember = false } = req.body || {};
  if (!password) return res.status(401).json({ error: 'Invalid credentials' });

  const ip = clientIp(req);
  if (!(await rateLimit(`login_attempts:${ip}`, 10, 3600000))) {
    return res.status(429).json({ error: 'Too many login attempts from this IP — try again later' });
  }
  if (!(await rateLimit('login_attempts_global', 200, 3600000))) {
    return res.status(429).json({ error: 'Too many login attempts — try again later' });
  }
  if (username && !(await rateLimit(`login_attempts:${username}`, 5, 900000))) {
    return res.status(429).json({ error: 'Too many login attempts for this account — try again later' });
  }

  const ttl = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  // Master fallback: empty/omitted username + APP_PASSWORD match → admin-equivalent token.
  // Kept ALWAYS available as a kill-switch, per CLAUDE.md safety rules.
  if (!username && APP_PASSWORD && password === APP_PASSWORD) {
    const token = signToken({ master: true, created: Date.now(), expires: Date.now() + ttl });
    await supabase.from('pipeline_log').insert({
      agent: 'MASTER', level: 'warn',
      message: 'Master (APP_PASSWORD) login used',
      metadata: { ip },
    });
    return res.status(200).json({ token });
  }

  if (!username) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, password_hash, role, permissions, store_access, active')
    .eq('username', username)
    .single();

  if (error || !user) {
    await logFailedLogin(username, ip, 'unknown username');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.active) {
    await logFailedLogin(username, ip, 'inactive user');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await logFailedLogin(username, ip, 'wrong password');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
  await supabase.from('pipeline_log').insert({
    agent: 'AUTH', level: 'info',
    message: `User "${user.username}" logged in`,
    metadata: { ip, user_id: user.id },
  });

  const token = signToken({
    user_id: user.id,
    created: Date.now(),
    expires: Date.now() + ttl,
  });

  return res.status(200).json({ token });
}

async function logFailedLogin(username, ip, reason) {
  console.error('[login] Failed login attempt:', { username, ip, reason });
  await supabase.from('pipeline_log').insert({
    agent: 'AUTH', level: 'warn',
    message: `Failed login for "${username}": ${reason}`,
    metadata: { ip },
  });
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/auth-multi-user.test.js`

Expected: PASS (10/10).

- [ ] **Step 6: Run existing `tests/auth.test.js` — expect it to now need updating**

Run: `npm test -- tests/auth.test.js`

Expected: the `'authenticates valid Bearer token'` and `'authenticates valid query token'` tests FAIL — they assert `result === {authenticated:true}`, but `verifyAuth` now requires either `master:true` or `user_id` in the payload and returns `null` for a bare `{expires}` payload.

- [ ] **Step 7: Update `tests/auth.test.js` to match the new payload contract**

In `tests/auth.test.js`, replace the two failing tests. Find:

```javascript
  it('authenticates valid Bearer token', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ authenticated: true });
  });

  it('authenticates valid query token', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: {}, query: { token } };
    const result = await verifyAuth(req);
    expect(result).toEqual({ authenticated: true });
  });
```

Replace with:

```javascript
  it('authenticates a valid master Bearer token', async () => {
    const token = createToken({ master: true, expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ master: true, role: 'admin' });
  });

  it('authenticates a valid master query token', async () => {
    const token = createToken({ master: true, expires: Date.now() + 60000 });
    const req = { headers: {}, query: { token } };
    const result = await verifyAuth(req);
    expect(result).toEqual({ master: true, role: 'admin' });
  });

  it('returns null for a token with neither master nor user_id', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });
```

Also add the Supabase mock this file now needs, since `verifyAuth` performs a DB lookup for non-master tokens. At the top of `tests/auth.test.js`, after the `import crypto from 'crypto';` line, add:

```javascript
import { vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }) }) }) }),
}));
```

(Every remaining test in this file uses master tokens or malformed/expired tokens, none of which reach the DB lookup, so a null-returning stub is sufficient.)

- [ ] **Step 8: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (81 baseline + 13 permissions + 6 password + 16 users + 10 auth-multi-user = 126; `tests/auth.test.js` count unchanged at its original size since 2 tests were replaced 1:1 plus 1 new test added).

- [ ] **Step 9: Commit**

```bash
git add lib/auth.js api/auth/login.js tests/auth-multi-user.test.js tests/auth.test.js
git commit -m "feat(auth): per-user login (username+password) with APP_PASSWORD master fallback + rate limiting"
```

---

### Task 5: Backend permission enforcement — Wave 1 (products & publications)

**Files:**
- Modify: `lib/actions/products.js`
- Modify: `lib/actions/publications.js`
- Modify: `lib/actions/exports.js`
- Modify: `lib/actions/optimizations.js`
- Modify: `lib/actions/pricing.js`
- Modify: `tests/publications.test.js`, `tests/exports.test.js` (inject `req.user`)
- Test: additions to `tests/products-permissions.test.js` (new file)

**Interfaces:**
- Consumes: `hasPermission(user, perm)`, `hasStoreAccess(user, storeId)` from `lib/permissions.js` (Task 1)
- Produces: every action below now 403s without the right permission/store access; unchanged 200-path response shapes for callers who DO have access

**Permission mapping locked for this task (verbatim, do not deviate):**

| Action | File | Permission | Store check |
|---|---|---|---|
| `product_detail` | products.js | `products:read` | yes (`store_id` from query) |
| `scrape_product` | products.js | `products:edit` | no (`store_id` not yet known — pre-import) |
| `import_confirm` | products.js | `products:edit` | yes (`store_id` from body) |
| `update_product_full` | products.js | `products:edit` | yes (`store_id` from body) |
| `bulk_price` | products.js | `products:edit` | yes (`store_id` from body) |
| `bulk_make_unlisted` | publications.js | `products:publications` | yes (`store_id` from body) |
| `bulk_make_listed` | publications.js | `products:publications` | yes (`store_id` from body) |
| `export_products_csv` | exports.js | `products:publications` | yes (`store_id` from body) |
| `pending_optimizations` | optimizations.js | `products:read` | yes (`store_id` from query) |
| `optimize_product` | optimizations.js | `products:edit` | yes (`store_id` from body) |
| `approve_optimization` | optimizations.js | `products:edit` | yes (`store_id` from body) |
| `reject_optimization` | optimizations.js | `products:edit` | yes (`store_id` from body) |
| `save_optimization` | optimizations.js | `products:edit` | yes (`store_id` from body) |
| `update_cogs` | pricing.js | `products:edit` | no (no `store_id` param today — see Note) |
| `manual_adspend` | pricing.js | `admin:users`-equivalent — ADMIN ONLY (`req.user.role !== 'admin'` → 403) | no |

**Note on `update_cogs`:** the existing action signature (`{product_id, cogs, variant_cogs}`) has no `store_id` — cannot enforce `hasStoreAccess` without first resolving the product's store. Add a lookup: fetch `products.store_id` for `product_id`, THEN call `hasStoreAccess`. This is the pattern for every action below that takes `product_id` but not `store_id` directly.

- [ ] **Step 1: Write the failing test file for products.js**

Create `tests/products-permissions.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseFromMock = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(async () => ({ data: { id: 'p1', shopify_id: '123', title: 'T', store_id: 'store-1' }, error: null })),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn(async () => ({ error: null })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({
    getFullProduct: vi.fn().mockResolvedValue({ title: 'T', body_html: '', tags: '', status: 'active' }),
    getProductMetafields: vi.fn().mockResolvedValue([]),
    updateProduct: vi.fn().mockResolvedValue({ product: {} }),
    bulkUpdateVariantPrices: vi.fn().mockResolvedValue(2),
  }),
}));

vi.mock('../lib/claude.js', () => ({ optimizeProduct: vi.fn() }));
vi.mock('../lib/scraper-utils.js', () => ({ scrapeProduct: vi.fn(), scrapeCollectionUrls: vi.fn() }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
const READ_ONLY = { role: 'member', permissions: ['products:read'], store_access: ['store-1'] };
const EDITOR_STORE1 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-1'] };
const EDITOR_STORE2 = { role: 'member', permissions: ['products:read', 'products:edit'], store_access: ['store-2'] };

describe('products.js permission checks', () => {
  let product_detail, update_product_full, bulk_price;

  beforeEach(async () => {
    vi.resetModules();
    getStoreMock.mockReset().mockResolvedValue({ id: 'store-1', admin_token: 't', shopify_url: 'x.myshopify.com' });
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/products.js');
    ({ product_detail, update_product_full, bulk_price } = mod);
  });

  it('product_detail: 403s without products:read', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: { role: 'member', permissions: [], store_access: ['store-1'] } });
    await product_detail(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('product_detail: 403s without store access', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: { role: 'member', permissions: ['products:read'], store_access: ['store-2'] } });
    await product_detail(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('product_detail: 200s for admin', async () => {
    const { req, res } = mockReqRes({ query: { store_id: 'store-1', product_id: 'p1' }, user: ADMIN });
    await product_detail(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('update_product_full: 403s with only products:read', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: READ_ONLY });
    await update_product_full(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('update_product_full: 403s when store not in store_access', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: EDITOR_STORE2 });
    await update_product_full(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('update_product_full: 200s with products:edit + matching store_access', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_id: 'p1', updates: { title: 'X' } }, user: EDITOR_STORE1 });
    await update_product_full(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('bulk_price: 403s without products:edit', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_shopify_ids: ['123'], new_price: '10' }, user: READ_ONLY });
    await bulk_price(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('bulk_price: 200s for admin', async () => {
    const { req, res } = mockReqRes({ body: { store_id: 'store-1', product_shopify_ids: ['123'], new_price: '10' }, user: ADMIN });
    await bulk_price(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/products-permissions.test.js`

Expected: FAIL — no 403s exist yet, `res.status` never called with 403.

- [ ] **Step 3: Add permission checks to `lib/actions/products.js`**

Edit `lib/actions/products.js`. Add the import at the top (after existing imports):

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
```

In `product_detail`, after the existing `if (!storeId || !productId) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

In `scrape_product`, after the existing `if (!url) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
```

In `import_confirm`, after the existing `if (!store_id || !product_data?.title) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

In `update_product_full`, after the existing `if (!store_id || !product_id || !updates) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

In `bulk_price`, after the existing `if (!store_id || !product_shopify_ids?.length || !new_price) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/products-permissions.test.js`

Expected: PASS (8/8).

- [ ] **Step 5: Add permission checks to `lib/actions/publications.js`**

Edit `lib/actions/publications.js`. Add the import (after existing imports):

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
```

In `runBulkPublicationChange`, immediately after the existing `if (!store_id || !Array.isArray(product_shopify_ids) || ...)` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:publications')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:publications permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

- [ ] **Step 6: Update `tests/publications.test.js` to inject `req.user`**

Edit `tests/publications.test.js`. In the `mockReqRes` helper, change:

```javascript
function mockReqRes(body) {
  const req = { body, headers: {} };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}
```

to:

```javascript
const ADMIN_USER = { role: 'admin', permissions: [], store_access: [] };

function mockReqRes(body, user = ADMIN_USER) {
  const req = { body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}
```

(All existing calls to `mockReqRes(body)` keep working unchanged — they now default to an admin user, preserving every existing assertion. No other line in this file needs to change.)

Append 3 new tests at the end of the file (after the last `describe('bulk_make_listed', ...)` block, before the file ends):

```javascript
describe('bulk_make_unlisted / bulk_make_listed — permission checks', () => {
  let bulk_make_unlisted;

  beforeEach(async () => {
    vi.resetModules();
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_unlisted = mod.bulk_make_unlisted;
  });

  it('403s without products:publications', async () => {
    const user = { role: 'member', permissions: ['products:edit'], store_access: ['s1'] };
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] }, user);
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403s when store not in store_access', async () => {
    const user = { role: 'member', permissions: ['products:publications'], store_access: ['s2'] };
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] }, user);
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('passes the permission gate for admin (falls through to existing 400 store-not-found logic)', async () => {
    getStoreMock.mockResolvedValue(null);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
```

- [ ] **Step 7: Run test — expect PASS**

Run: `npm test -- tests/publications.test.js`

Expected: PASS (13/13 — 10 pre-existing + 3 new).

- [ ] **Step 8: Add permission checks to `lib/actions/exports.js`**

Edit `lib/actions/exports.js`. Add the import (after existing imports):

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
```

In `export_products_csv`, after the existing `if (!store_id) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:publications')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:publications permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

- [ ] **Step 9: Update `tests/exports.test.js` to inject `req.user`**

Edit `tests/exports.test.js`. In the `mockReqRes` helper, change:

```javascript
function mockReqRes(body) {
  const headers = {};
  const req = { body, headers: {} };
```

to:

```javascript
const ADMIN_USER = { role: 'admin', permissions: [], store_access: [] };

function mockReqRes(body, user = ADMIN_USER) {
  const headers = {};
  const req = { body, headers: {}, user };
```

Append 2 new tests at the end of the `describe('export_products_csv', ...)` block:

```javascript
  it('403s without products:publications', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const user = { role: 'member', permissions: ['products:read'], store_access: ['s1'] };
    const { req, res } = mockReqRes({ store_id: 's1' }, user);
    await export_products_csv(req, res);
    expect(res._status).toBe(403);
  });

  it('403s when store not in store_access', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const user = { role: 'member', permissions: ['products:publications'], store_access: ['s2'] };
    const { req, res } = mockReqRes({ store_id: 's1' }, user);
    await export_products_csv(req, res);
    expect(res._status).toBe(403);
  });
```

- [ ] **Step 10: Run test — expect PASS**

Run: `npm test -- tests/exports.test.js`

Expected: PASS (7/7 — 5 pre-existing + 2 new).

- [ ] **Step 11: Add permission checks to `lib/actions/optimizations.js`**

Read `lib/actions/optimizations.js` first to confirm each function's exact guard clause and parameter names before editing (it was not excerpted in this plan — apply the same pattern used above: `hasPermission(req.user, 'products:read')` for `pending_optimizations` right after its existing required-field guard, keyed on its `store_id` query/body param; `hasPermission(req.user, 'products:edit')` + `hasStoreAccess(req.user, store_id)` for `optimize_product`, `approve_optimization`, `reject_optimization`, `save_optimization`, each right after their existing required-field guard, using whatever `store_id` variable name that function already destructures from `req.body`/`req.query`). Add the same import line:

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
```

- [ ] **Step 12: Add permission checks to `lib/actions/pricing.js`**

Edit `lib/actions/pricing.js`. Add the import (after existing imports):

```javascript
import { hasPermission } from '../permissions.js';
```

In `update_cogs`, after the existing `if (!product_id) ...` guard, insert:

```javascript
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
```

(No `hasStoreAccess` call here — `update_cogs` takes only `product_id`, not `store_id`; enforcing per-store scoping on this action is deferred, matching the "Note on `update_cogs`" above, since resolving the product's store first would require an extra query this action doesn't currently make. Flag as tech debt in Task 11's CLAUDE.md update, don't silently expand scope here.)

In `manual_adspend`, after the existing `if (!date || !channel || amount === undefined) ...` guard, insert:

```javascript
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', hint: 'admin only' });
  }
```

- [ ] **Step 13: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass. Count grows by the 8 new `products-permissions.test.js` tests + 3 publications + 2 exports = 13 more than Task 4's total.

- [ ] **Step 14: Commit**

```bash
git add lib/actions/products.js lib/actions/publications.js lib/actions/exports.js lib/actions/optimizations.js lib/actions/pricing.js tests/products-permissions.test.js tests/publications.test.js tests/exports.test.js
git commit -m "feat(permissions): enforce products:read/edit/publications + store access — Wave 1 (products, publications, exports, optimizations, pricing)"
```

---

### Task 6: Backend permission enforcement — Wave 2 (remaining ~15 action modules)

**Files:**
- Modify: `lib/actions/creatives.js`, `lib/actions/skills.js`, `lib/actions/avatars.js`, `lib/actions/custom-styles.js`, `lib/actions/size-chart.js`, `lib/actions/reviews.js`, `lib/actions/reviews-import.js`, `lib/actions/reviews-ai.js`, `lib/actions/reviews-photo.js`, `lib/actions/reviews-push.js`, `lib/actions/sync.js`, `lib/actions/webhooks.js`, `lib/actions/docs.js`, `lib/actions/proposals.js`, `lib/actions/analytics.js`, `lib/actions/profit.js`, `lib/actions/stores.js`
- Test: `tests/wave2-permissions.test.js` (new file)

**Interfaces:**
- Consumes: `hasPermission(user, perm)`, `hasStoreAccess(user, storeId)` from `lib/permissions.js` (Task 1)
- Produces: every action below 403s without the right permission/store access

**Permission mapping locked for this task (verbatim, do not deviate):**

| Action | File | Permission | Store check |
|---|---|---|---|
| `product_reviews_list` | reviews.js | `products:read` | yes |
| `add_review_manual`, `update_review`, `delete_review`, `set_review_status`, `seed_reviews_helpful` | reviews.js | `products:edit` | yes |
| `import_reviews_csv` | reviews-import.js | `products:edit` | yes |
| `generate_reviews_ai` | reviews-ai.js | `products:edit` | yes |
| `upload_review_photo`, `delete_review_photo` | reviews-photo.js | `products:edit` | yes |
| `push_reviews_to_shopify` | reviews-push.js | `products:edit` | yes |
| `read_size_chart`, `refresh_size_charts` | size-chart.js | `products:read` | yes |
| `save_size_chart`, `parse_size_chart_image` | size-chart.js | `products:edit` | yes |
| `upload_avatar`, `set_avatar_reference`, `set_avatar_active`, `delete_avatar` | avatars.js | `products:images` | yes |
| `persona_avatars`, `poll_avatar_generations` | avatars.js | `products:read` | yes |
| `generate_avatar` | avatars.js | `creatives:generate` | yes |
| `push_creative_to_shopify` | creatives.js | `products:images` | yes |
| `update_creative` | creatives.js | `creatives:generate` | yes |
| `generate_branded` | creatives.js | `creatives:generate` | yes |
| `poll_generations`, `cleanup_stale` | creatives.js | ADMIN ONLY | no |
| `custom_styles` | custom-styles.js | `products:read` | yes |
| `analyze_style`, `create_custom_style`, `delete_custom_style`, `describe_style`, `scrape_style` | custom-styles.js | `creatives:generate` | yes |
| `get_skills` | skills.js | `products:read` | yes |
| `generate_skills`, `regenerate_skill`, `save_skill` | skills.js | `creatives:generate` | yes |
| `sync_products` | sync.js | ADMIN ONLY | no |
| `list_webhooks` | webhooks.js | `products:read` | yes |
| `register_webhooks`, `unregister_webhooks` | webhooks.js | ADMIN ONLY | no |
| `store_docs`, `store_docs_download` | docs.js | `products:read` | yes |
| `upload_store_doc`, `process_single_file`, `process_inbox` | docs.js | ADMIN ONLY | no |
| `proposals_list` | proposals.js | `products:read` | yes |
| `approve_proposal`, `reject_proposal`, `approve_all_proposals`, `scan_events` | proposals.js | ADMIN ONLY | no |
| `kpi`, `meta_overview`, `insights` | analytics.js | `products:read` | yes |
| `profit_summary` | profit.js | `products:read` | yes (Profit tab is sensitive margin data — still gated by `products:read` per spec's tab-visibility rule, not a separate permission since `PERMISSION_LIST` is locked to 6 entries) |
| `stores_list` | stores.js | none (ANY authenticated user) — but result MUST be filtered to `user.store_access` unless admin/master | n/a (filters internally) |

- [ ] **Step 1: Write the failing test**

Create `tests/wave2-permissions.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn().mockReturnThis(),
    }),
  }),
}));
vi.mock('../lib/store-context.js', () => ({ getStore: vi.fn().mockResolvedValue({ id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com' }), getAllStores: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/shopify-admin.js', () => ({ createShopifyClient: () => ({}) }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const NO_PERMS = { role: 'member', permissions: [], store_access: ['s1'] };
const READER = { role: 'member', permissions: ['products:read'], store_access: ['s1'] };
const ADMIN = { role: 'admin', permissions: [], store_access: [] };

describe('Wave 2 — spot-check permission gates', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key'); });

  it('get_skills: 403s without products:read', async () => {
    const { get_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: NO_PERMS });
    await get_skills(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('get_skills: passes gate for reader with store access', async () => {
    const { get_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: READER });
    await get_skills(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('generate_skills: 403s without creatives:generate', async () => {
    const { generate_skills } = await import('../lib/actions/skills.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await generate_skills(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sync_products: 403s for non-admin', async () => {
    const { sync_products } = await import('../lib/actions/sync.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await sync_products(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sync_products: passes gate for admin', async () => {
    const { sync_products } = await import('../lib/actions/sync.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: ADMIN });
    await sync_products(req, res);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('manual proposals scan_events: 403s for non-admin', async () => {
    const { scan_events } = await import('../lib/actions/proposals.js');
    const { req, res } = mockReqRes({ body: { store_id: 's1' }, user: READER });
    await scan_events(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('stores_list: member sees only their store_access, admin sees all', async () => {
    const { getAllStores } = await import('../lib/store-context.js');
    getAllStores.mockResolvedValue([
      { id: 's1', name: 'Isola' }, { id: 's2', name: 'Elegance House' },
    ]);
    const { stores_list } = await import('../lib/actions/stores.js');

    const { req: reqMember, res: resMember } = mockReqRes({ user: { role: 'member', permissions: [], store_access: ['s1'] } });
    await stores_list(reqMember, resMember);
    const memberBody = resMember.json.mock.calls[0][0];
    expect(memberBody.stores.map((s) => s.id)).toEqual(['s1']);

    const { req: reqAdmin, res: resAdmin } = mockReqRes({ user: ADMIN });
    await stores_list(reqAdmin, resAdmin);
    const adminBody = resAdmin.json.mock.calls[0][0];
    expect(adminBody.stores.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/wave2-permissions.test.js`

Expected: FAIL — no permission gates exist yet in any Wave 2 module, and `stores_list` doesn't filter by `store_access`.

- [ ] **Step 3: Read each target file, then apply the mapping-table pattern**

For each of the 17 files in the mapping table: read the file first (none were excerpted verbatim in this plan except `stores.js` below), identify each exported action function's existing required-field guard (the first `if (!x) return res.status(400)...` line), and insert the permission check immediately after it, using the exact pattern already applied in Task 5:

```javascript
  if (!hasPermission(req.user, '<perm-from-table>')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires <perm-from-table> permission' });
  }
```

and, where the table marks a store check "yes", also insert (using whatever `store_id` variable that function already destructures — do not introduce a new query if the function doesn't already have one; if it takes `product_id` only, resolve `store_id` via a `supabase.from('products').select('store_id').eq('id', product_id).single()` lookup first, same as the Task 5 Note on `update_cogs` pattern):

```javascript
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
```

For "ADMIN ONLY" rows, use:

```javascript
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', hint: 'admin only' });
  }
```

Add `import { hasPermission, hasStoreAccess } from '../permissions.js';` (or just `hasPermission` for admin-only-only files) to the top of every modified file.

- [ ] **Step 4: Rewrite `lib/actions/stores.js` to filter by `store_access`**

Read `lib/actions/stores.js` first to get its exact current implementation (it strips `admin_token` per CLAUDE.md — that logic MUST be preserved). Add the import:

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
```

Inside `stores_list`, after the existing stores are fetched (via `getAllStores()`) and `admin_token` is stripped/`has_admin` computed, add a filter step before the response is sent:

```javascript
  const visibleStores = (req.user?.role === 'admin' || req.user?.master)
    ? sanitized
    : sanitized.filter((s) => hasStoreAccess(req.user, s.id));
```

(`sanitized` stands in for whatever variable name the existing code uses for the post-strip array — read the file and use its actual variable name; do not rename it.) Then return `{ stores: visibleStores }` instead of the previous full list.

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/wave2-permissions.test.js`

Expected: PASS (7/7).

- [ ] **Step 6: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass. Any pre-existing test for the 17 modified files that constructs `req` WITHOUT a `user` field will now fail its 403 gate before reaching the original assertion — for each such pre-existing test file, add `user: { role: 'admin', permissions: [], store_access: [] }` to its `mockReqRes`/request-builder helper (same fix pattern as Task 5 Steps 6 and 9). Re-run `npm test` after each fix until the full suite is green.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/creatives.js lib/actions/skills.js lib/actions/avatars.js lib/actions/custom-styles.js lib/actions/size-chart.js lib/actions/reviews.js lib/actions/reviews-import.js lib/actions/reviews-ai.js lib/actions/reviews-photo.js lib/actions/reviews-push.js lib/actions/sync.js lib/actions/webhooks.js lib/actions/docs.js lib/actions/proposals.js lib/actions/analytics.js lib/actions/profit.js lib/actions/stores.js tests/wave2-permissions.test.js
git commit -m "feat(permissions): enforce permission + store-access checks — Wave 2 (remaining 17 action modules)"
```

---

### Task 7: Frontend — Login.jsx username field + UserContext + `me` action

**Files:**
- Modify: `apps/dashboard/src/pages/Login.jsx`
- Create: `apps/dashboard/src/hooks/useUser.jsx`
- Modify: `lib/auth.js` is NOT touched again — instead add a tiny `me` action
- Create: nothing new backend — reuse `api/system.js` GET dispatch for `me`
- Modify: `api/system.js` (register `me` action)
- Modify: `apps/dashboard/src/lib/api.js` (add `getMe()`)

**Interfaces:**
- Consumes: `req.user` (populated by `withAuth`, Task 4)
- Produces:
  - GET action `me` → `200 { user: {master:true,role:'admin'} | {user_id,username,role,permissions,store_access} }`
  - `useUser()` hook → `{ user, loading, refreshUser }`
  - `<UserProvider>` — wraps children, fetches `me` once on mount

- [ ] **Step 1: Add the `me` action (no new file — inline in `api/system.js`)**

Edit `api/system.js`. Add after the last import line:

```javascript
function me(req, res) {
  return res.status(200).json({ user: req.user });
}
```

Add `me,` to `GET_ACTIONS` (after `users_list,`):

```javascript
  me,
```

- [ ] **Step 2: Write the failing test for `me`**

Add to `tests/system-routing.test.js` — first read that file to confirm its existing mock shape, then append (matching its existing pattern) a test that GETs `?action=me` with a stubbed `req.user` and asserts the response echoes `{ user: req.user }`. Since this file's exact mock harness wasn't read in full during planning, the implementer must inspect `tests/system-routing.test.js` before writing this step's assertions — use the same `vi.mock`/dispatch pattern already present in that file rather than inventing a new one.

- [ ] **Step 3: Run test — expect FAIL then PASS**

Run: `npm test -- tests/system-routing.test.js`

Expected: FAIL before Step 1's edit is picked up by a fresh module load, PASS after (the edit in Step 1 must land before this step for it to go green — reorder if the test was written first).

- [ ] **Step 4: Add `getMe()` to `apps/dashboard/src/lib/api.js`**

Add near the other GET wrappers (grouped with `getStores` — search for `export function getStores`):

```javascript
export function getMe() {
  return fetchJSON('/api/system?action=me');
}
```

- [ ] **Step 5: Create `apps/dashboard/src/hooks/useUser.jsx`**

Create `apps/dashboard/src/hooks/useUser.jsx`:

```javascript
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { getMe } from '../lib/api';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const { user: u } = await getMe();
      setUser(u);
    } catch (err) {
      console.error('[useUser] Failed to load current user:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  return (
    <UserContext.Provider value={{ user, loading, refreshUser: loadUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
```

- [ ] **Step 6: Add username field to `Login.jsx`**

Edit `apps/dashboard/src/pages/Login.jsx`. Replace the full contents:

```javascript
import { useState } from 'react';
import './Login.css';

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() || undefined, password, remember }),
      });

      if (!res.ok) {
        setError('Invalid username or password');
        setLoading(false);
        return;
      }

      const { token } = await res.json();
      localStorage.setItem('auth_token', token);
      onSuccess();
    } catch {
      setError('Connection error');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <div className="login-logo-mark">T</div>
          <div className="login-logo-brand">Titan Commerce</div>
          <div className="login-logo-sub">Command Center</div>
        </div>

        <input
          className="login-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username (leave blank for master login)"
          autoFocus
        />

        <input
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={loading || !password}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <div className="login-hint">Wrong password? Contact admin.</div>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (Login.jsx and useUser.jsx have no Vitest coverage — `vitest.config.js` runs `env: node`, no jsdom — matching the reference plan's precedent for React components; verified manually in Task 11).

- [ ] **Step 8: Commit**

```bash
git add api/system.js apps/dashboard/src/lib/api.js apps/dashboard/src/hooks/useUser.jsx apps/dashboard/src/pages/Login.jsx tests/system-routing.test.js
git commit -m "feat(users): username login field + me action + UserProvider/useUser hook"
```

---

### Task 8: Frontend — store filter + tab visibility (App.jsx) + PermissionGate

**Files:**
- Modify: `apps/dashboard/src/App.jsx`
- Modify: `apps/dashboard/src/hooks/useActiveStore.jsx`
- Modify: `apps/dashboard/src/lib/api.js` (403 handling in `fetchJSON`)
- Create: `apps/dashboard/src/components/PermissionGate.jsx`

**Interfaces:**
- Consumes: `useUser()` from Task 7
- Produces: `<PermissionGate perm="products:edit">...</PermissionGate>` — renders children only if `hasPermission(user, perm)` is true (client-side mirror of backend enforcement — cosmetic only, backend is the real gate per D-02)

- [ ] **Step 1: Create `apps/dashboard/src/components/PermissionGate.jsx`**

Create `apps/dashboard/src/components/PermissionGate.jsx`:

```javascript
import { useUser } from '../hooks/useUser.jsx';

// Client-side mirror of lib/permissions.js hasPermission — cosmetic UI gating ONLY.
// The real enforcement is server-side (every lib/actions/* checks hasPermission()
// again); this component just avoids showing controls the user can't use.
function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export default function PermissionGate({ perm, fallback = null, children }) {
  const { user } = useUser();
  return hasPermission(user, perm) ? children : fallback;
}
```

- [ ] **Step 2: Add 403 handling to `apps/dashboard/src/lib/api.js`**

Edit `apps/dashboard/src/lib/api.js`. In `fetchJSON`, after the existing `if (res.status === 429) { ... }` block, insert:

```javascript
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hint || body.error || 'You don\'t have permission to do that');
  }
```

- [ ] **Step 3: Filter stores by `store_access` in `useActiveStore.jsx`**

Edit `apps/dashboard/src/hooks/useActiveStore.jsx`. The `getStores()` backend call (Task 6, Step 4) already returns only the caller's visible stores — no frontend filtering is needed since `stores_list` now filters server-side. No change required to this file's logic; this step is a verification step, not a code step.

Run: `grep -n "getStores" apps/dashboard/src/hooks/useActiveStore.jsx apps/dashboard/src/lib/api.js`

Expected: confirms `getStores()` calls `stores_list` (via `fetchJSON`) with no client-side params — the server does the filtering per Task 6 Step 4. If `getStores()` is instead found to pass a hardcoded query param that bypasses this, flag it — do not silently change store isolation logic.

- [ ] **Step 4: Wrap `App.jsx` in `UserProvider` + filter tabs + add Settings tab**

Edit `apps/dashboard/src/App.jsx`. Add the import (after the `useActiveStore` import):

```javascript
import { UserProvider, useUser } from './hooks/useUser.jsx';
```

Add the lazy Settings import (after the `Avatars` lazy import):

```javascript
const Settings = lazy(() => import('./pages/Settings'));
```

Replace the `TABS` constant and add a permission-aware tab filter. Change:

```javascript
const TABS = ['Cockpit', 'Shopify', 'Studio', 'Avatars', 'Products', 'Profit'];
```

to:

```javascript
const ALL_TABS = ['Cockpit', 'Shopify', 'Studio', 'Avatars', 'Products', 'Profit'];

function visibleTabs(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...ALL_TABS, 'Settings'];
  const perms = user.permissions || [];
  const tabs = [];
  if (perms.includes('products:read')) tabs.push('Cockpit', 'Shopify', 'Products', 'Profit');
  if (perms.includes('creatives:generate')) tabs.push('Studio', 'Avatars');
  return ALL_TABS.filter((t) => tabs.includes(t));
}
```

In `AppContent()`, add the `useUser()` call (after the `useActiveStore()` line):

```javascript
  const { user } = useUser();
  const TABS = visibleTabs(user);
```

Add the Settings route to the `<Suspense>` block, after the existing `{activeTab === 'Profit' && ...}` line:

```javascript
            {activeTab === 'Settings' && user?.role === 'admin' && <Settings />}
```

Wrap `<AppContent />` in `<UserProvider>` inside the default-exported `App()` function. Change:

```javascript
  return (
    <StoreProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </StoreProvider>
  );
```

to:

```javascript
  return (
    <UserProvider>
      <StoreProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </StoreProvider>
    </UserProvider>
  );
```

- [ ] **Step 5: Create the Settings page shell (full UI comes in Task 10)**

Create `apps/dashboard/src/pages/Settings.jsx`:

```javascript
import { lazy, Suspense } from 'react';

const UsersManager = lazy(() => import('../components/settings/UsersManager'));

export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <UsersManager />
      </Suspense>
    </div>
  );
}
```

(`UsersManager` doesn't exist yet — created in Task 10. This shell keeps `App.jsx`'s Settings route wired without a build error, since `React.lazy` only evaluates the import when the tab is actually rendered.)

- [ ] **Step 6: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (no backend logic changed in this task; frontend has no Vitest coverage per Task 7 Step 7 note).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/App.jsx apps/dashboard/src/lib/api.js apps/dashboard/src/components/PermissionGate.jsx apps/dashboard/src/pages/Settings.jsx
git commit -m "feat(users): permission-filtered tabs, Settings tab shell, PermissionGate component, 403 toast handling"
```

---

### Task 9: Frontend — Products.jsx / ProductDetail.jsx per-permission button visibility

**Files:**
- Modify: `apps/dashboard/src/pages/Products.jsx`
- Modify: `apps/dashboard/src/components/ProductDetail.jsx`
- Modify: `apps/dashboard/src/components/VariantEditor.jsx`
- Modify: `apps/dashboard/src/components/ImageManager.jsx`
- Modify: `apps/dashboard/src/components/MetafieldEditor.jsx`

**Interfaces:**
- Consumes: `<PermissionGate perm="...">` from Task 8; `useUser()` from Task 7

- [ ] **Step 1: Read each target file's current button/toolbar markup**

Before editing, read `apps/dashboard/src/pages/Products.jsx` (full file — it's 421+ lines per the reference plan's constraint note), `apps/dashboard/src/components/ProductDetail.jsx`, `apps/dashboard/src/components/VariantEditor.jsx`, `apps/dashboard/src/components/ImageManager.jsx`, `apps/dashboard/src/components/MetafieldEditor.jsx` in full. This plan cannot enumerate exact line numbers for markup not yet read in full during planning — the implementer must locate each interactive control and apply the gating rule below verbatim.

- [ ] **Step 2: Gate the Products.jsx `SelectionToolbar` bulk actions**

In `apps/dashboard/src/pages/Products.jsx`, the `<SelectionToolbar>` component (imported from `../components/products/SelectionToolbar`, already wired per the publications-manager feature) receives `onMakeUnlisted`, `onMakeListed`, `onExportCsv` props. Wrap the entire `<SelectionToolbar ... />` render in:

```javascript
import PermissionGate from '../components/PermissionGate';
```

```jsx
<PermissionGate perm="products:publications">
  <SelectionToolbar
    selectedCount={selectedIds.size}
    onMakeUnlisted={...}
    onMakeListed={...}
    onExportCsv={...}
    onClear={...}
  />
</PermissionGate>
```

(Keep every existing prop wiring unchanged — only add the wrapping `<PermissionGate>`.)

- [ ] **Step 3: Gate the "Optimize" / "+Image" / "▶ Video" buttons**

In `ProductWorkspace.jsx` (per `CLAUDE.md` App Flow: `[+ Image] / [▶ Video]` and `[✨ Optimize]` buttons live in the per-product workspace, not `Products.jsx` itself). Locate each button element and wrap:

```jsx
<PermissionGate perm="creatives:generate">
  {/* existing +Image / ▶Video button JSX, unchanged */}
</PermissionGate>
```

```jsx
<PermissionGate perm="products:edit">
  {/* existing ✨ Optimize button JSX, unchanged */}
</PermissionGate>
```

Add the same `import PermissionGate from '../components/PermissionGate';` line to `ProductWorkspace.jsx`.

- [ ] **Step 4: Gate `ImageManager.jsx` upload/delete/reorder controls**

In `apps/dashboard/src/components/ImageManager.jsx`, wrap every interactive control that mutates images (upload input, delete button per image, drag-reorder handles) in `<PermissionGate perm="products:images">`. Per the spec's Gherkin acceptance criteria ("ImageManager is visible but all buttons are disabled"), prefer a `disabled` prop over hiding when the control benefits from being visible-but-inert (matches the spec's exact wording "buttons (upload/delete/reorder) are disabled" — NOT hidden). Implement as:

```javascript
import { useUser } from '../hooks/useUser.jsx';

function hasImagesPermission(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes('products:images');
}
```

Then in the component body:

```javascript
  const { user } = useUser();
  const canEditImages = hasImagesPermission(user);
```

And on each button: `disabled={!canEditImages}` (added alongside any existing `disabled` condition — combine with `||` if one already exists, never replace it).

- [ ] **Step 5: Gate `VariantEditor.jsx` and `MetafieldEditor.jsx` edit controls**

Same pattern as Step 4 but keyed on `products:edit` — every input/save button in `VariantEditor.jsx` and `MetafieldEditor.jsx` gets `disabled={!canEdit}` where `canEdit` is computed the same way (`hasPermission(user, 'products:edit')`, admin trumps).

- [ ] **Step 6: Gate `ProductDetail.jsx` inline editor save controls**

Same `disabled={!canEdit}` pattern on the top-level save/publish controls in `ProductDetail.jsx` — read the file first to find them (title/description/tags/status/price editors mentioned in `CLAUDE.md`'s Products tab description).

- [ ] **Step 7: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (no backend logic in this task; no frontend Vitest coverage).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/pages/Products.jsx apps/dashboard/src/components/ProductDetail.jsx apps/dashboard/src/components/VariantEditor.jsx apps/dashboard/src/components/ImageManager.jsx apps/dashboard/src/components/MetafieldEditor.jsx
git commit -m "feat(users): gate product edit/image/publication controls behind PermissionGate + disabled states"
```

---

### Task 10: Admin Users Management UI

**Files:**
- Modify: `apps/dashboard/src/pages/Settings.jsx` (already has the shell from Task 8)
- Create: `apps/dashboard/src/components/settings/UsersManager.jsx` (+ `.css`)
- Create: `apps/dashboard/src/components/settings/UserForm.jsx` (+ `.css`)
- Create: `apps/dashboard/src/components/settings/PermissionCheckboxes.jsx`
- Create: `apps/dashboard/src/components/settings/StoreAccessCheckboxes.jsx`
- Modify: `apps/dashboard/src/lib/api.js` — add `listUsers`, `createUser`, `updateUser`, `deleteUser`, `resetPassword`

**Interfaces:**
- Consumes: `users_list`/`create_user`/`update_user`/`delete_user`/`reset_password` actions from Task 3; `useToast()` (existing hook, per `CLAUDE.md`); `useActiveStore()` for the store list to populate `StoreAccessCheckboxes`
- Produces: fully working Users CRUD UI reachable at Settings tab (admin-only, gated in Task 8)

- [ ] **Step 1: Add API wrappers to `apps/dashboard/src/lib/api.js`**

Add near the other action wrappers:

```javascript
// Users & Permissions
export function listUsers() {
  return fetchJSON('/api/system?action=users_list');
}

export function createUser(payload) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'create_user', ...payload }),
  });
}

export function updateUser(payload) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_user', ...payload }),
  });
}

export function deleteUser(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_user', user_id: userId }),
  });
}

export function resetPassword(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset_password', user_id: userId }),
  });
}
```

- [ ] **Step 2: Create `PermissionCheckboxes.jsx`**

Create `apps/dashboard/src/components/settings/PermissionCheckboxes.jsx`:

```javascript
const PERMISSION_LIST = [
  'products:read',
  'products:edit',
  'products:images',
  'products:publications',
  'creatives:generate',
  'admin:users',
];

const LABELS = {
  'products:read': 'View products',
  'products:edit': 'Edit products (title, description, price, tags, status)',
  'products:images': 'Manage images (upload, delete, reorder, push creatives)',
  'products:publications': 'Bulk publish/unpublish, CSV export',
  'creatives:generate': 'Generate AI creatives (Studio, Avatars)',
  'admin:users': 'Manage users (admin only, implicit for role=admin)',
};

export default function PermissionCheckboxes({ value, onChange, disabled }) {
  const toggle = (perm) => {
    if (value.includes(perm)) onChange(value.filter((p) => p !== perm));
    else onChange([...value, perm]);
  };

  return (
    <div className="permission-checkboxes">
      {PERMISSION_LIST.map((perm) => (
        <label key={perm} className="permission-checkbox-row">
          <input
            type="checkbox"
            checked={value.includes(perm)}
            onChange={() => toggle(perm)}
            disabled={disabled}
          />
          <span className="permission-checkbox-key">{perm}</span>
          <span className="permission-checkbox-label">{LABELS[perm]}</span>
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `StoreAccessCheckboxes.jsx`**

Create `apps/dashboard/src/components/settings/StoreAccessCheckboxes.jsx`:

```javascript
export default function StoreAccessCheckboxes({ stores, value, onChange, disabled }) {
  const toggle = (storeId) => {
    if (value.includes(storeId)) onChange(value.filter((id) => id !== storeId));
    else onChange([...value, storeId]);
  };

  return (
    <div className="store-access-checkboxes">
      {(stores || []).map((s) => (
        <label key={s.id} className="store-access-checkbox-row">
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={() => toggle(s.id)}
            disabled={disabled}
          />
          {s.name}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `UserForm.jsx`**

Create `apps/dashboard/src/components/settings/UserForm.jsx`:

```javascript
import { useState } from 'react';
import PermissionCheckboxes from './PermissionCheckboxes';
import StoreAccessCheckboxes from './StoreAccessCheckboxes';
import './UserForm.css';

export default function UserForm({ user, stores, onSubmit, onCancel, busy }) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'member');
  const [permissions, setPermissions] = useState(user?.permissions || []);
  const [storeAccess, setStoreAccess] = useState(user?.store_access || []);
  const [active, setActive] = useState(user?.active ?? true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isEdit) {
      onSubmit({ user_id: user.id, role, permissions, store_access: storeAccess, active, full_name: fullName, email });
    } else {
      onSubmit({ username, password, full_name: fullName, email, role, permissions, store_access: storeAccess });
    }
  };

  return (
    <form className="user-form" onSubmit={handleSubmit}>
      <h2>{isEdit ? `Edit ${user.username}` : 'Create user'}</h2>

      {!isEdit && (
        <>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required disabled={busy} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} minLength={8} />
          </label>
        </>
      )}

      <label>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      {role === 'member' && (
        <>
          <fieldset>
            <legend>Permissions</legend>
            <PermissionCheckboxes value={permissions} onChange={setPermissions} disabled={busy} />
          </fieldset>
          <fieldset>
            <legend>Store access</legend>
            <StoreAccessCheckboxes stores={stores} value={storeAccess} onChange={setStoreAccess} disabled={busy} />
          </fieldset>
        </>
      )}

      {isEdit && (
        <label className="user-form-active">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
          Active
        </label>
      )}

      <div className="user-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" disabled={busy}>{isEdit ? 'Save' : 'Create user'}</button>
      </div>
    </form>
  );
}
```

Create `apps/dashboard/src/components/settings/UserForm.css` with minimal styling consistent with the Nextbyte Dark Luxe design system (dark/light via CSS variables, per `CLAUDE.md` Frontend conventions):

```css
.user-form { display: flex; flex-direction: column; gap: 12px; max-width: 480px; }
.user-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
.user-form input, .user-form select { padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--surface-2); color: var(--text-primary); }
.user-form fieldset { border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; }
.user-form-active { flex-direction: row !important; align-items: center; gap: 8px !important; }
.user-form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
```

- [ ] **Step 5: Create `UsersManager.jsx`**

Create `apps/dashboard/src/components/settings/UsersManager.jsx`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import { listUsers, createUser, updateUser, deleteUser, resetPassword } from '../../lib/api';
import { useActiveStore } from '../../hooks/useActiveStore.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import UserForm from './UserForm';
import './UsersManager.css';

export default function UsersManager() {
  const { stores } = useActiveStore();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { users: u } = await listUsers();
      setUsers(u || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload) => {
    setBusy(true);
    try {
      await createUser(payload);
      toast.success(`User "${payload.username}" created`);
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (payload) => {
    setBusy(true);
    try {
      await updateUser(payload);
      toast.success('User updated');
      setEditingUser(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(user.id);
      toast.success(`User "${user.username}" deleted`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleResetPassword = async (user) => {
    try {
      const { temp_password } = await resetPassword(user.id);
      toast.success(`Temp password for "${user.username}": ${temp_password} (copy it now — it won't be shown again)`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div className="users-manager">
      <div className="users-manager-header">
        <h2>Users</h2>
        <button onClick={() => { setEditingUser(null); setFormOpen(true); }}>Create user</button>
      </div>

      <table className="users-table">
        <thead>
          <tr>
            <th>Username</th><th>Full name</th><th>Role</th><th>Permissions</th>
            <th>Store access</th><th>Active</th><th>Last login</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.full_name || '—'}</td>
              <td>{u.role}</td>
              <td>{u.role === 'admin' ? 'all' : (u.permissions || []).join(', ') || '—'}</td>
              <td>{u.role === 'admin' ? 'all' : (u.store_access || []).map((id) => stores.find((s) => s.id === id)?.name || id).join(', ') || '—'}</td>
              <td>{u.active ? 'Yes' : 'No'}</td>
              <td>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
              <td className="users-table-actions">
                <button onClick={() => { setEditingUser(u); setFormOpen(true); }}>Edit</button>
                <button onClick={() => handleResetPassword(u)}>Reset password</button>
                <button onClick={() => handleDelete(u)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {formOpen && (
        <div className="users-manager-modal">
          <UserForm
            user={editingUser}
            stores={stores}
            busy={busy}
            onSubmit={editingUser ? handleUpdate : handleCreate}
            onCancel={() => { setFormOpen(false); setEditingUser(null); }}
          />
        </div>
      )}
    </div>
  );
}
```

Create `apps/dashboard/src/components/settings/UsersManager.css`:

```css
.users-manager { padding: 16px; }
.users-manager-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.users-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.users-table th, .users-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color); }
.users-table-actions { display: flex; gap: 6px; }
.users-manager-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
```

- [ ] **Step 6: Run full test suite — expect no regressions**

Run: `npm test`

Expected: all tests pass (no backend logic in this task; no frontend Vitest coverage for these components).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib/api.js apps/dashboard/src/components/settings/ apps/dashboard/src/pages/Settings.jsx
git commit -m "feat(users): admin Users Management UI (list/create/edit/delete/reset password)"
```

---

### Task 11: E2E manual verification + docs + ship

**Files:**
- Create: `scripts/create-first-admin.mjs`
- Modify: `CLAUDE.md`
- Move: `features/active/02-users-and-permissions.md` → `features/shipped/02-users-and-permissions.md`

**Interfaces:**
- Consumes: everything from Tasks 1-10
- Produces: a working production login flow + documented feature

- [ ] **Step 1: Write the one-shot first-admin bootstrap script**

Create `scripts/create-first-admin.mjs`:

```javascript
// One-shot: creates the first admin user after the users table migration is applied.
// Usage: node scripts/create-first-admin.mjs <username> <password>
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../lib/password.js';

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: node scripts/create-first-admin.mjs <username> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const password_hash = await hashPassword(password);

const { data, error } = await supabase
  .from('users')
  .insert({
    username, password_hash, role: 'admin', permissions: [], store_access: [], active: true,
  })
  .select('id, username, role')
  .single();

if (error) {
  console.error('Failed to create admin user:', error.message);
  process.exit(1);
}

console.log(`Created admin user "${data.username}" (id: ${data.id}). Log in with this username + the password you provided.`);
```

- [ ] **Step 2: Verify script is syntactically valid**

Run: `node --check scripts/create-first-admin.mjs`

Expected: exits with code 0 (no output on success).

- [ ] **Step 3: Manual step — apply the SQL migration**

- [ ] **Manual step:** Open Supabase SQL Editor for the Titan Commerce project → paste and run `sql/add-users-and-permissions.sql` → verify the `users` table exists with `SELECT * FROM users;` (expect 0 rows).

- [ ] **Step 4: Manual step — create the first admin user (Dan)**

- [ ] **Manual step:** Run `node scripts/create-first-admin.mjs dan <a-strong-password-dan-chooses>` locally (with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in the local `.env`) → confirm the script prints "Created admin user".

- [ ] **Step 5: Manual step — verify master login still works**

- [ ] **Manual step:** `vercel dev` (or local dev server) → open the dashboard → clear `localStorage.auth_token` (old-shape tokens are invalid against the new `verifyAuth`) → log in with blank username + `APP_PASSWORD` → confirm dashboard loads with all 6 tabs + Settings visible (master = admin-equivalent).

- [ ] **Step 6: Manual step — verify admin login works**

- [ ] **Manual step:** Log out → log in with `dan` / the password set in Step 4 → confirm dashboard loads identically to master login (all tabs + Settings).

- [ ] **Step 7: Manual step — create a test member user via UI**

- [ ] **Manual step:** In Settings > Users, click "Create user" → username `isola-editor`, password `test12345678`, role `member`, permissions `products:read` + `products:edit`, store_access = Isola only → Create → confirm success toast + row appears in the table.

- [ ] **Step 8: Manual step — verify member sees only Products tab + Isola store**

- [ ] **Manual step:** Log out → log in as `isola-editor` → confirm ONLY the Products tab is visible (no Cockpit/Shopify/Studio/Avatars/Profit/Settings) → confirm the store switcher does not appear (only 1 store in `store_access`, matching the existing `stores.length > 1` guard) or shows only Isola.

- [ ] **Step 9: Manual step — verify member is blocked from Elegance House**

- [ ] **Manual step:** While logged in as `isola-editor`, open browser DevTools → attempt `fetch('/api/system', {method:'POST', headers:{Authorization:'Bearer '+localStorage.auth_token,'Content-Type':'application/json'}, body: JSON.stringify({action:'update_product_full', store_id:'<elegance-house-store-id>', product_id:'x', updates:{title:'hack'}})})` → confirm response is `403` with `error: 'forbidden'`.

- [ ] **Step 10: Update `CLAUDE.md`**

Edit `CLAUDE.md`. In the **Database Schema > Tables** table, add a row after `rate_limits`:

```
| `users` | Per-user login: `username` (unique), `password_hash` (scrypt `salt:key`, never leaves backend), `role` (`admin`\|`member`, admin trumps explicit permissions), `permissions` (`TEXT[]`, subset of `PERMISSION_LIST`), `store_access` (`UUID[]`), `active`, `last_login`. Migration: `sql/add-users-and-permissions.sql`. |
```

In **Important Patterns > Auth Flow**, replace the existing paragraph with:

```markdown
### Auth Flow
Per-user login (`username` + `password`) → `api/auth/login.js` → HMAC session token (with `expires`) → stored in localStorage `auth_token` → `withAuth()` middleware validates on every API call and re-fetches the user from `users` (must exist + `active=true`) on every request via `verifyAuth()`. `req.user` shape: `{master:true, role:'admin'}` (APP_PASSWORD fallback, master trumps everything) OR `{user_id, username, role, permissions, store_access}` (real user). No Supabase Auth for dashboard users. **`APP_SECRET` fails closed** — auth throws if it is unset. `APP_PASSWORD` remains a permanent master-login kill switch (blank username + password match → master token).
- **Permission enforcement:** `lib/permissions.js` exports `PERMISSION_LIST` (`products:read`, `products:edit`, `products:images`, `products:publications`, `creatives:generate`, `admin:users`), `hasPermission(user, perm)`, `hasStoreAccess(user, storeId)`. `role='admin'` implicitly grants all permissions + all store access (explicit `permissions`/`store_access` on an admin row is ignored). Every action in `lib/actions/*` calls both at the top, before any business logic — enforcement is app-level since the backend uses the Supabase service-role key (bypasses RLS by design).
- **Admin user management:** Settings > Users tab (admin-only) — `lib/actions/users.js` (`users_list`, `create_user`, `update_user`, `delete_user`, `reset_password`), gated on `admin:users`. Passwords hashed with Node's built-in `crypto.scrypt` (`lib/password.js`) — zero external dependency. Deleting the last active admin is blocked. `password_hash` is stripped from every API response.
- **Public allow-list:** `withAuth` (`lib/auth.js`) checks a hardcoded `PUBLIC_ACTIONS` Set FIRST — those actions skip the token check (for unauthenticated storefront calls). Currently `submit_review_public`, `vote_review_helpful`, `review_helpful_counts`. Keep this list tiny/audited; CORS for those actions handled in `system.js` (`CORS_ACTIONS` + OPTIONS preflight, origin from `STOREFRONT_URL` env). Test coverage in `tests/auth.test.js` asserts a protected action still 401s without a token.
```

In **App Structure > Tabs**, update the header line:

```markdown
### Tabs: Cockpit | Shopify | Studio | Avatars | Products | Profit | Settings (admin-only)
```

Add a row to the tabs table:

```
| Settings | `Settings.jsx` | Admin-only: Users Management (`UsersManager.jsx`) — list/create/edit/delete users, reset passwords, assign permissions + store access |
```

In **Known Tech Debt & Planned Work**, add a row:

```
| 🟡 MED | `update_cogs` has no per-store `hasStoreAccess` check (only `product_id`, no `store_id` param) | Would need a `products.store_id` lookup first — deferred in the users-and-permissions feature to avoid scope creep on an unrelated action's signature |
```

In **Env Vars**, no change needed (`APP_PASSWORD`, `APP_SECRET` already documented).

In **Key Dependencies**, no change needed — this feature adds zero new npm dependencies (scrypt is Node built-in).

- [ ] **Step 11: Move the feature spec to shipped**

Run:

```bash
mkdir -p features/shipped
git mv features/active/02-users-and-permissions.md features/shipped/02-users-and-permissions.md
```

Edit the moved file's frontmatter — change:

```yaml
status: active
shipped: null
```

to (using today's actual ship date when this step is executed):

```yaml
status: shipped
shipped: 2026-07-XX
```

Append to the Changelog section:

```markdown
- `2026-07-XX` Shipped. Implementation deviated from D-01: used Node built-in `crypto.scrypt` instead of `bcryptjs` (zero-dep, no native build risk on Vercel — explicit decision by Dan during plan authoring, see `Docs/superpowers/plans/2026-07-24-users-and-permissions.md` Global Constraints).
```

- [ ] **Step 12: Run full test suite one final time**

Run: `npm test`

Expected: all tests pass, full green suite.

- [ ] **Step 13: Commit**

```bash
git add scripts/create-first-admin.mjs CLAUDE.md features/shipped/02-users-and-permissions.md
git rm -f features/active/02-users-and-permissions.md 2>/dev/null || true
git commit -m "docs(users): document users table + permissions in CLAUDE.md, ship feature spec, add first-admin bootstrap script"
```

---

### Task 12: Pre-deploy audit + deploy

**Files:** none (operational task)

**Interfaces:**
- Consumes: everything from Tasks 1-11

- [ ] **Manual step:** Run `/pre-deploy-audit` (per Dan's mandatory pre-deploy ritual, `feedback_predeploy_audit_required.md`) — explicit audit of task completeness + architecture + full-suite-green verdict, recorded before deploy.

- [ ] **Step 1: Verify local build succeeds**

Run: `cd apps/dashboard && npm run build`

Expected: build succeeds with no errors (output to `apps/dashboard/dist`).

- [ ] **Step 2: Verify full test suite is green**

Run: `npm test`

Expected: all tests pass.

- [ ] **Manual step:** If the pre-deploy audit verdict is SAFE, push to `main`:

```bash
git push origin main
```

Vercel auto-deploys on push to `main`.

- [ ] **Manual step:** Post-deploy — open the production dashboard, clear `localStorage.auth_token` (old-shape tokens are invalid against the new backend), log in with blank username + production `APP_PASSWORD` → confirm the master login safety net works in production BEFORE relying on real user accounts.

- [ ] **Manual step:** Post-deploy — run `node scripts/create-first-admin.mjs dan <production-password>` against the PRODUCTION `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (from Vercel env vars, run locally with those values exported, or via a one-off Vercel CLI invocation) → confirm the script succeeds.

- [ ] **Manual step:** Dan logs into production with the new admin username + password → confirms full dashboard access → begins onboarding real member users per the feature's success metric ("Dan creates ≥ 2 member users within 14 days").

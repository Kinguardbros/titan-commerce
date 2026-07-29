# Amazon Userscript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-based (Tampermonkey userscript) Amazon reviews import to Titan — bypasses the datacenter-IP block that limited feature-03's server-side scraper. Uses Dan's residential IP + logged Amazon session + per-user API tokens for bearer auth from the userscript to Titan.

**Architecture:** Reuses the existing `import_amazon_reviews` action from `lib/actions/reviews-amazon.js` (F03) unchanged — it already accepts a pre-scraped `reviews[]` array in the POST body, which is exactly what the userscript will send after scraping the Amazon DOM client-side. New per-user API tokens (`users.api_token` column) authenticate userscript POSTs via a bearer-token lookup path added to `lib/auth.js`, running in parallel to (not replacing) the existing HMAC session-token flow — detected by the presence of a `.` separator in the token (session tokens are `base64payload.hexsignature`; API tokens are a flat 64-char hex string with no `.`). CORS is extended per-action so `import_amazon_reviews` (and only that action) also allows the `amazon.com` origin; note this is defense-in-depth, not the real security boundary — `GM_xmlhttpRequest` (the Tampermonkey API the userscript uses to POST) is a browser-extension-mediated request that bypasses page-level CORS enforcement entirely, so the actual authorization gate is the bearer `api_token` check server-side, same as any other action. The existing session-token dashboard login path is untouched. The userscript itself is hosted via a GitHub raw URL with `@updateURL` so Tampermonkey auto-updates it on version bumps.

**Tech Stack:** Backend: existing (Node, Supabase, Vercel serverless). Userscript: plain JS using Tampermonkey's `GM_*` sandbox APIs (`GM_setValue`, `GM_getValue`, `GM_xmlhttpRequest`, `GM_registerMenuCommand`). No new npm dependencies anywhere.

## Global Constraints

- **Vercel Hobby 12/12 routes** — the new `generate_api_token` action is registered in `api/system.js` (`POST_ACTIONS` map), no new route file
- **`catch (e) {}` is FORBIDDEN** — always `console.error` + structured context, then respond or rethrow
- **Bearer token detection heuristic** in `verifyAuth` (`lib/auth.js`): token contains `.` → existing HMAC session-token path (unchanged); else → new `api_token` DB-lookup path
- **`api_token` = 64-char hex** — `crypto.randomBytes(32).toString('hex')`
- **`admin:users` permission required** for `generate_api_token` (same gate as `create_user`/`update_user`/`reset_password` in `lib/actions/users.js`)
- **CORS per-action origins** — `import_amazon_reviews` additionally allows `https://www.amazon.com` (+ `https://smile.amazon.com`); all other CORS-enabled actions (`submit_review_public`, `vote_review_helpful`, `review_helpful_counts`) keep their existing `STOREFRONT_URL`-derived origins, unchanged
- **CORS is not the security boundary here** — `GM_xmlhttpRequest` bypasses browser CORS enforcement; the bearer `api_token` check in `verifyAuth` is what actually blocks unauthorized callers
- **Files ≤ 300 lines** (existing project rule; `AmazonInstallGuide.jsx` and `ApiTokenDisplayModal.jsx` are new and must stay under this from the start)
- **Full test suite baseline: 191/191** (verified live before starting this plan) — every task must end at 191 + (this task's new tests), no regressions
- **`pipeline_log` agent names:** `AMAZON_SCRAPER` for `import_amazon_reviews` submits (unchanged from F03 — the action is not modified), `AUTH_ADMIN` for `generate_api_token` (matches the existing convention for all other user-admin actions in `lib/actions/users.js`)
- **Feature flag:** `FEATURE_AMAZON_USERSCRIPT` (env var, default off) is the backend flag for this feature's own surface (currently just a marker — this plan adds no new backend action that reads it, since `import_amazon_reviews` is reused unmodified). CORRECTION vs the original spec sketch: the "Amazon" tab in `ImportReviews.jsx` has **no frontend flag-gating today** (verified — F03's `FEATURE_AMAZON_REVIEWS_SCRAPER` doesn't hide the tab either, it only 503s the backend actions when off) and this plan does not add any, to stay consistent with the existing precedent and avoid scope creep (a real frontend gate would need a `VITE_`-prefixed build-time var or a flags-serving endpoint, neither of which exists and neither is in this feature's file list). The tab is always visible; `import_amazon_reviews` still gates on `FEATURE_AMAZON_REVIEWS_SCRAPER` (F03's flag, unchanged) — both `FEATURE_AMAZON_REVIEWS_SCRAPER=true` and `FEATURE_AMAZON_USERSCRIPT=true` must be set in production for the end-to-end flow to work end to end; documented precisely in Task 9.
- **Reuses F03 code without modification:** `import_amazon_reviews` action body, `reviews-shared.js` helpers (`validateImageBuffer`, `uploadReviewImage`, `dropExistingDuplicates`), the photo-download-and-reupload pipeline
- **Alethe VPS `147.93.56.72` = NEVER touched** — absolute rule, restated here even though this feature doesn't touch any VPS (Titan's own Amazon scraper VPS at `37.27.189.60` is also untouched by this feature — the userscript replaces that VPS's *use case* for future imports without modifying or decommissioning it)
- **`api_token` security:** never logged in plaintext (pipeline_log entries reference the *action*, never the token value); returned in the HTTP response body only once, at generation time; treated like a password everywhere else
- **`--legacy-peer-deps`** for any `npm install` (Higgsfield peer dep conflict) — not expected to be needed in this plan (no new deps), noted for completeness
- Language: UI text = English; code + comments = English; `CLAUDE.md` = English

---

## File Structure

**Create:**
- `sql/add-user-api-token.sql` — adds `users.api_token` column + partial index
- `scripts/titan-amazon-userscript.user.js` — the Tampermonkey userscript (external deliverable, lives in the Titan repo for version control + `@updateURL` raw-GitHub hosting)
- `apps/dashboard/src/components/settings/ApiTokenDisplayModal.jsx` (+ `.css`) — one-time-reveal modal, mirrors `TempPasswordModal` in `UsersManager.jsx`
- `apps/dashboard/src/components/AmazonInstallGuide.jsx` (+ `.css`) — new install-guide content component
- `tests/api-token.test.js` — tests for `generate_api_token` + the bearer `api_token` path in `verifyAuth`

**Modify:**
- `lib/auth.js` — `verifyAuth` gains the parallel `api_token` lookup branch
- `lib/actions/users.js` — add `generate_api_token(req, res)` export
- `api/system.js` — register `generate_api_token` in `POST_ACTIONS`; convert `CORS_ACTIONS` from a `Set` to a per-action origins map; `applyCors` takes the resolved origin list for the current action
- `apps/dashboard/src/components/settings/UsersManager.jsx` — add a "Generate API token" button per user row + wire the reveal modal
- `apps/dashboard/src/components/AmazonImport.jsx` — replace the VPS-scrape UI with a thin wrapper rendering `AmazonInstallGuide` (component name/props preserved so `ImportReviews.jsx`'s 4th-tab wiring needs zero changes)
- `apps/dashboard/src/lib/api.js` — add `generateApiToken(userId)` wrapper
- `CLAUDE.md` — document `api_token` bearer auth path, `generate_api_token` action, per-action CORS model, userscript file, new env vars

---

### Task 1: SQL migration — `users.api_token` column

**Files:**
- Create: `sql/add-user-api-token.sql`
- Test: `tests/api-token.test.js` (schema-shape assertion only — no live DB in CI, so this test asserts the migration file's SQL text, matching how other `sql/*.sql` files in this repo are verified, e.g. `grep`-based checks in the F03 plan)

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: `users.api_token TEXT UNIQUE NULL` column (documented contract that Task 2 and Task 3 both depend on — `generate_api_token` writes it, `verifyAuth` reads it)

- [ ] **Step 1: Write the failing test**

Create `tests/api-token.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/api-token.test.js`
Expected: FAIL with `ENOENT: no such file or directory, open 'sql/add-user-api-token.sql'`

- [ ] **Step 3: Write the migration**

Create `sql/add-user-api-token.sql`:

```sql
-- Add api_token column for userscript bearer auth (2026-07-29)
-- Allows generating a per-user token for external tools (Tampermonkey userscript).
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single statements.

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token) WHERE api_token IS NOT NULL;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/api-token.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add sql/add-user-api-token.sql tests/api-token.test.js
git commit -m "feat(userscript): add users.api_token column migration"
```

---

### Task 2: `generate_api_token` action

**Files:**
- Modify: `lib/actions/users.js`
- Modify: `api/system.js:29` (import), `api/system.js:114-118` (POST_ACTIONS)
- Test: `tests/api-token.test.js` (append)

**Interfaces:**
- Consumes: `hasPermission(user, perm)` from `lib/permissions.js` (existing); `supabase` service-role client (existing pattern in `lib/actions/users.js`)
- Produces: `generate_api_token(req, res)` — POST body `{user_id}` → `200 {api_token: '<64-char-hex>'}`. Later tasks (Task 3's tests, the frontend in Task 5) rely on this exact response shape and the `admin:users` 403 gate.

- [ ] **Step 1: Write the failing test**

Append to `tests/api-token.test.js`:

```javascript
describe('lib/actions/users.js — generate_api_token', () => {
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
```

Add the required imports at the top of `tests/api-token.test.js` (the file now needs `vi`, `beforeEach` alongside `describe`, `it`, `expect`):

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
```

(This replaces the Task 1 import line — same file, now needs the additional vitest helpers.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/api-token.test.js`
Expected: FAIL — `generate_api_token is not a function` (not exported yet)

- [ ] **Step 3: Implement `generate_api_token` in `lib/actions/users.js`**

Add to `lib/actions/users.js`, after the existing `reset_password` function (end of file):

```javascript
export async function generate_api_token(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const api_token = randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('users')
    .update({ api_token })
    .eq('id', user_id)
    .select('id, username')
    .single();

  if (error) {
    console.error('[generate_api_token] update failed:', error);
    return res.status(500).json({ error: 'failed to generate API token' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} generated a new API token for user "${data.username}"`,
    metadata: { target_user_id: user_id },
  });

  return res.status(200).json({ api_token });
}
```

No new imports needed — `randomBytes` is already imported at the top of `lib/actions/users.js` (used by `randomTempPassword`), and `supabase`/`hasPermission` are already in scope.

- [ ] **Step 4: Register the action in `api/system.js`**

In `api/system.js`, find the import line (line 29):

```javascript
import { me, users_list, create_user, update_user, delete_user, reset_password } from '../lib/actions/users.js';
```

Replace with:

```javascript
import { me, users_list, create_user, update_user, delete_user, reset_password, generate_api_token } from '../lib/actions/users.js';
```

Find the end of `POST_ACTIONS` (around line 114-118):

```javascript
  create_user,
  update_user,
  delete_user,
  reset_password,
};
```

Replace with:

```javascript
  create_user,
  update_user,
  delete_user,
  reset_password,
  generate_api_token,
};
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/api-token.test.js`
Expected: PASS (7/7 — 2 from Task 1 + 5 from this task)

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test`
Expected: 198 passed (191 baseline + 7 new)

- [ ] **Step 7: Commit**

```bash
git add lib/actions/users.js api/system.js tests/api-token.test.js
git commit -m "feat(userscript): add generate_api_token admin action"
```

---

### Task 3: `lib/auth.js` — parallel bearer `api_token` flow

**Files:**
- Modify: `lib/auth.js:20-60` (`verifyAuth`)
- Test: `tests/api-token.test.js` (append)

**Interfaces:**
- Consumes: `users.api_token` column (Task 1); Supabase `users` table (existing)
- Produces: `verifyAuth(req)` now also resolves a flat-hex bearer token (no `.`) by looking up `users.api_token`. Returns the **same user object shape** as the session-token path: `{user_id, username, role, permissions, store_access}`. This is what `lib/actions/reviews-amazon.js`'s `import_amazon_reviews` (unmodified) receives as `req.user` — `hasPermission`/`hasStoreAccess` work identically regardless of which auth path populated it.

- [ ] **Step 1: Write the failing test**

Append to `tests/api-token.test.js`:

```javascript
describe('lib/auth.js — verifyAuth api_token bearer path', () => {
  const authState = { userRow: null, userError: null };

  const supabaseFromMock = vi.fn((table) => {
    if (table === 'users') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col, val) => {
            if (col === 'api_token') {
              return { eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: authState.userRow, error: authState.userError })) })) };
            }
            // session-token path (id lookup) — untouched by this test file
            return { single: vi.fn(async () => ({ data: null, error: { code: 'PGRST116' } })) };
          }),
        })),
      };
    }
    return { insert: vi.fn(async () => ({ error: null })) };
  });

  vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: supabaseFromMock }) }));

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
    // The users table select was never called with an api_token filter in this path
    // (only the try/catch's JSON.parse threw) — assert no api_token-shaped call happened.
    const apiTokenCalls = supabaseFromMock.mock.results
      .filter((r) => r.value?.select)
      .length;
    expect(apiTokenCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/api-token.test.js`
Expected: FAIL — the api_token bearer tests return `null` instead of a resolved user (branch doesn't exist yet)

- [ ] **Step 3: Implement the parallel bearer path in `lib/auth.js`**

Find the current `verifyAuth` function:

```javascript
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
```

Replace with:

```javascript
// Session tokens are "base64Payload.hexSignature" (always contain a "."). API tokens
// (generated by generate_api_token) are a flat 64-char hex string with no ".". This
// detection runs BEFORE any parsing, so a malformed session token never falls through
// to the api_token DB lookup, and a malformed api_token never hits the HMAC/JSON path.
async function verifyApiToken(token) {
  if (token.length < 40) return null; // short-circuit obviously-wrong input before a DB round-trip
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, role, permissions, store_access, active')
    .eq('api_token', token)
    .single();

  if (error || !user || !user.active) return null;

  return {
    user_id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions || [],
    store_access: user.store_access || [],
  };
}

export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : req.query?.token;
  if (!token) return null;

  if (!token.includes('.')) {
    return verifyApiToken(token);
  }

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
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/api-token.test.js`
Expected: PASS (11/11 — 2 + 5 + 4)

- [ ] **Step 5: Run full suite — no regressions**

Run: `npm test`
Expected: 202 passed (191 baseline + 11 new). Pay special attention to `tests/auth.test.js` (7 existing tests) — these must still pass unmodified since the session-token path is byte-for-byte unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/auth.js tests/api-token.test.js
git commit -m "feat(userscript): add parallel api_token bearer auth path to verifyAuth"
```

---

### Task 4: CORS refactor — per-action origins

**Files:**
- Modify: `api/system.js:120-133` (`CORS_ACTIONS`, `ALLOWED_ORIGINS`, `applyCors`), `api/system.js:139-143` (call sites)
- Test: `tests/system-routing.test.js` — check current content before editing (this file already tests routing/CORS shape; append new cases here rather than creating a new file, following the "fold into the task whose deliverable needs it" guidance)

**Interfaces:**
- Consumes: nothing new
- Produces: `applyCors(req, res, action)` — now takes the action name and looks up its allowed-origins list from `CORS_ACTIONS[action]` instead of a single shared `ALLOWED_ORIGINS`. `CORS_ACTIONS` is now `{ actionName: string[] }` instead of `Set<string>`. `import_amazon_reviews` origins come from `AMAZON_USERSCRIPT_ORIGINS` env var (comma-separated) if set, else the hardcoded default `['https://www.amazon.com', 'https://smile.amazon.com']`.

- [ ] **Step 1: Read the current test file to match its existing patterns**

Run: `cat tests/system-routing.test.js`

(No code shown here — read the actual file output before writing new test cases below, so naming/mock conventions match exactly. If the file does not check CORS behavior yet, add a new top-level `describe('CORS per-action origins', ...)` block; if it already has a CORS `describe` block, extend it.)

- [ ] **Step 2: Write the failing test**

Add to `tests/system-routing.test.js` (adjust the `describe` nesting to match what Step 1 revealed; this shape assumes a fresh top-level block):

```javascript
describe('CORS per-action origins', () => {
  let applyCorsForAction;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('STOREFRONT_URL', 'https://isolaswim.com,https://swimwear-brand.myshopify.com');
    vi.stubEnv('AMAZON_USERSCRIPT_ORIGINS', '');
    // api/system.js does not export applyCors directly (it's a module-private
    // function) — these tests exercise it indirectly via the OPTIONS preflight
    // response, matching how the file is actually invoked in production.
  });

  it('import_amazon_reviews preflight allows https://www.amazon.com', async () => {
    const mod = await import('../api/system.js');
    const handler = mod.default;
    const headers = {};
    const req = { method: 'OPTIONS', query: { action: 'import_amazon_reviews' }, headers: { origin: 'https://www.amazon.com' }, body: {} };
    const res = {
      setHeader: vi.fn((k, v) => { headers[k] = v; }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://www.amazon.com');
  });

  it('import_amazon_reviews preflight rejects an untrusted origin (falls back to first allowed)', async () => {
    const mod = await import('../api/system.js');
    const handler = mod.default;
    const headers = {};
    const req = { method: 'OPTIONS', query: { action: 'import_amazon_reviews' }, headers: { origin: 'https://evil.example.com' }, body: {} };
    const res = {
      setHeader: vi.fn((k, v) => { headers[k] = v; }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://evil.example.com');
  });

  it('submit_review_public preflight still allows the storefront origin (unchanged)', async () => {
    const mod = await import('../api/system.js');
    const handler = mod.default;
    const headers = {};
    const req = { method: 'OPTIONS', query: { action: 'submit_review_public' }, headers: { origin: 'https://isolaswim.com' }, body: {} };
    const res = {
      setHeader: vi.fn((k, v) => { headers[k] = v; }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://isolaswim.com');
  });

  it('submit_review_public preflight does NOT allow amazon.com (origins are per-action, not shared)', async () => {
    const mod = await import('../api/system.js');
    const handler = mod.default;
    const headers = {};
    const req = { method: 'OPTIONS', query: { action: 'submit_review_public' }, headers: { origin: 'https://www.amazon.com' }, body: {} };
    const res = {
      setHeader: vi.fn((k, v) => { headers[k] = v; }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };
    await handler(req, res);
    expect(headers['Access-Control-Allow-Origin']).not.toBe('https://www.amazon.com');
  });
});
```

Note: if `tests/system-routing.test.js` mocks `withAuth` or the action imports in a way that makes importing the real `api/system.js` default export impractical (e.g. it mocks every action module), adapt these 4 tests to that file's existing import/mock strategy rather than introducing a second, conflicting mock setup — the goal (assert per-action CORS headers) stays the same regardless of harness shape.

- [ ] **Step 3: Run test — expect FAIL**

Run: `npm test -- tests/system-routing.test.js`
Expected: FAIL — `import_amazon_reviews` preflight currently 405s (not in the old `CORS_ACTIONS` Set) so no `Access-Control-Allow-Origin` header is set at all

- [ ] **Step 4: Refactor `api/system.js`**

Find:

```javascript
// Actions callable cross-origin from the storefront need CORS headers.
const CORS_ACTIONS = new Set(['submit_review_public', 'vote_review_helpful', 'review_helpful_counts']);
// Allowed storefront origins (live custom domain + Shopify domain for theme previews).
// STOREFRONT_URL env can hold a comma-separated list to override/extend.
const ALLOWED_ORIGINS = (process.env.STOREFRONT_URL || 'https://isolaswim.com,https://swimwear-brand.myshopify.com')
  .split(',').map((o) => o.trim()).filter(Boolean);
function applyCors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
```

Replace with:

```javascript
// Actions callable cross-origin need CORS headers — each maps to the specific
// origins it trusts (NOT a single shared allow-list). Storefront actions get the
// storefront's own domain(s); import_amazon_reviews gets Amazon's domain(s) only.
// Note: for the userscript's actual request, GM_xmlhttpRequest bypasses browser-side
// CORS enforcement entirely — the real authorization gate is the bearer api_token
// check in verifyAuth. This CORS entry exists for correctness/defense-in-depth (e.g.
// if a future integration calls this action via plain fetch() from a browser tab).
const STOREFRONT_ORIGINS = (process.env.STOREFRONT_URL || 'https://isolaswim.com,https://swimwear-brand.myshopify.com')
  .split(',').map((o) => o.trim()).filter(Boolean);
const AMAZON_USERSCRIPT_ORIGINS = (process.env.AMAZON_USERSCRIPT_ORIGINS || 'https://www.amazon.com,https://smile.amazon.com')
  .split(',').map((o) => o.trim()).filter(Boolean);

const CORS_ACTIONS = {
  submit_review_public: STOREFRONT_ORIGINS,
  vote_review_helpful: STOREFRONT_ORIGINS,
  review_helpful_counts: STOREFRONT_ORIGINS,
  import_amazon_reviews: AMAZON_USERSCRIPT_ORIGINS,
};

function applyCors(req, res, action) {
  const allowedOrigins = CORS_ACTIONS[action] || [];
  const origin = req.headers.origin;
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
```

(`Authorization` added to `Access-Control-Allow-Headers` because the userscript sends the bearer token in that header — the existing storefront actions don't need it but the shared header list is harmless to extend.)

Find the call sites:

```javascript
  // CORS preflight for public storefront actions (must answer before auth/dispatch).
  if (req.method === 'OPTIONS') {
    if (CORS_ACTIONS.has(action)) { applyCors(req, res); return res.status(200).end(); }
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (CORS_ACTIONS.has(action)) applyCors(req, res);
```

Replace with:

```javascript
  // CORS preflight for public storefront actions (must answer before auth/dispatch).
  if (req.method === 'OPTIONS') {
    if (CORS_ACTIONS[action]) { applyCors(req, res, action); return res.status(200).end(); }
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (CORS_ACTIONS[action]) applyCors(req, res, action);
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/system-routing.test.js`
Expected: all pass, including the 4 new CORS cases

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test`
Expected: 206 passed (202 baseline from Task 3 + 4 new). Confirm `import_amazon_reviews` itself still requires the `products:edit`/`hasStoreAccess`/bearer-auth checks — CORS is additive, not a replacement for those.

- [ ] **Step 7: Commit**

```bash
git add api/system.js tests/system-routing.test.js
git commit -m "feat(userscript): per-action CORS origins, add amazon.com for import_amazon_reviews"
```

---

### Task 5: Settings > Users — API token UI

**Files:**
- Create: `apps/dashboard/src/components/settings/ApiTokenDisplayModal.jsx`, `apps/dashboard/src/components/settings/ApiTokenDisplayModal.css`
- Modify: `apps/dashboard/src/components/settings/UsersManager.jsx`
- Modify: `apps/dashboard/src/lib/api.js`

**Interfaces:**
- Consumes: `generate_api_token` action (Task 2) via a new `generateApiToken(userId)` wrapper
- Produces: `ApiTokenDisplayModal({ result, onClose })` component where `result = {username, api_token}` — mirrors the existing `TempPasswordModal({ result, onClose })` pattern already in `UsersManager.jsx` (`result = {username, temp_password}`)

- [ ] **Step 1: Add the `generateApiToken` wrapper to `apps/dashboard/src/lib/api.js`**

Find the `resetPassword` function:

```javascript
export function resetPassword(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset_password', user_id: userId }),
  });
}
```

Add immediately after it:

```javascript
export function generateApiToken(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'generate_api_token', user_id: userId }),
  });
}
```

- [ ] **Step 2: Create `ApiTokenDisplayModal.jsx`**

Create `apps/dashboard/src/components/settings/ApiTokenDisplayModal.jsx`:

```javascript
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import './ApiTokenDisplayModal.css';

// One-time reveal modal for a freshly generated api_token — mirrors TempPasswordModal
// in UsersManager.jsx. result = { username, api_token }.
export default function ApiTokenDisplayModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.api_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ApiTokenDisplayModal] Clipboard write failed:', err);
    }
  };

  return (
    <div className="api-token-backdrop" role="dialog" aria-modal="true" aria-label="API token">
      <div className="api-token-modal">
        <h2 className="api-token-title">API token for &quot;{result.username}&quot;</h2>
        <p className="api-token-warning">Copy it now — it won&apos;t be shown again. Paste it into the Tampermonkey userscript config.</p>
        <div className="api-token-value-row">
          <code className="api-token-value">{result.api_token}</code>
          <button type="button" className="api-token-copy" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="api-token-hint">Generating a new token immediately invalidates the previous one.</p>
        <div className="api-token-actions">
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ApiTokenDisplayModal.css`**

Create `apps/dashboard/src/components/settings/ApiTokenDisplayModal.css` (reuses the existing `.temp-pw-*` visual language from `UsersManager.css` under new class names, since that file is shared/modified elsewhere and this keeps the new component's styles self-contained per the "per-component .css file" convention):

```css
.api-token-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.api-token-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
}

.api-token-title {
  margin: 0 0 8px;
  font-size: 16px;
}

.api-token-warning {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.api-token-value-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface-hover);
  border-radius: 8px;
  padding: 10px 12px;
}

.api-token-value {
  flex: 1;
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  word-break: break-all;
}

.api-token-copy {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.api-token-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.api-token-actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 4: Wire the button + modal into `UsersManager.jsx`**

Find the import block:

```javascript
import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { listUsers, createUser, updateUser, deleteUser, resetPassword } from '../../lib/api';
import { useActiveStore } from '../../hooks/useActiveStore.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import UserForm from './UserForm';
import './UsersManager.css';
```

Replace with:

```javascript
import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { listUsers, createUser, updateUser, deleteUser, resetPassword, generateApiToken } from '../../lib/api';
import { useActiveStore } from '../../hooks/useActiveStore.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import UserForm from './UserForm';
import ApiTokenDisplayModal from './ApiTokenDisplayModal';
import './UsersManager.css';
```

Find the state declarations:

```javascript
  const [tempPasswordResult, setTempPasswordResult] = useState(null);
  const [busy, setBusy] = useState(false);
```

Replace with:

```javascript
  const [tempPasswordResult, setTempPasswordResult] = useState(null);
  const [apiTokenResult, setApiTokenResult] = useState(null);
  const [busy, setBusy] = useState(false);
```

Find the `handleResetPassword` function:

```javascript
  const handleResetPassword = async (user) => {
    try {
      const { temp_password } = await resetPassword(user.id);
      setTempPasswordResult({ username: user.username, temp_password });
    } catch (err) {
      toast.error(err.message);
    }
  };
```

Add immediately after it:

```javascript
  const handleGenerateApiToken = async (user) => {
    try {
      const { api_token } = await generateApiToken(user.id);
      setApiTokenResult({ username: user.username, api_token });
    } catch (err) {
      toast.error(err.message);
    }
  };
```

Find the actions cell in the table row:

```javascript
                <td className="users-table-actions">
                  <button type="button" onClick={() => { setEditingUser(u); setFormOpen(true); }}>Edit</button>
                  <button type="button" onClick={() => handleResetPassword(u)}>Reset password</button>
                  <button type="button" className="users-table-delete" onClick={() => setDeletingUser(u)}>Delete</button>
                </td>
```

Replace with:

```javascript
                <td className="users-table-actions">
                  <button type="button" onClick={() => { setEditingUser(u); setFormOpen(true); }}>Edit</button>
                  <button type="button" onClick={() => handleResetPassword(u)}>Reset password</button>
                  <button type="button" onClick={() => handleGenerateApiToken(u)}>Generate API token</button>
                  <button type="button" className="users-table-delete" onClick={() => setDeletingUser(u)}>Delete</button>
                </td>
```

Find where `TempPasswordModal` is rendered (near the end of the component, in the JSX return):

```javascript
      {tempPasswordResult && (
        <TempPasswordModal result={tempPasswordResult} onClose={() => setTempPasswordResult(null)} />
      )}
```

Add immediately after it:

```javascript
      {apiTokenResult && (
        <ApiTokenDisplayModal result={apiTokenResult} onClose={() => setApiTokenResult(null)} />
      )}
```

(If the exact surrounding JSX differs from this snippet when you open the file, locate the `{tempPasswordResult && (...)}` block by search — it is the anchor point, insert the new block as its sibling.)

- [ ] **Step 5: Vite build check**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds with no errors (no test framework covers this component — Settings/UsersManager has no existing `.test.jsx` file in this repo, so a clean build is the verification gate for this task, matching how other frontend-only tasks in this codebase are gated)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/settings/ApiTokenDisplayModal.jsx apps/dashboard/src/components/settings/ApiTokenDisplayModal.css apps/dashboard/src/components/settings/UsersManager.jsx apps/dashboard/src/lib/api.js
git commit -m "feat(userscript): add Generate API token button + reveal modal to Users settings"
```

---

### Task 6: Replace Amazon tab content with install guide

**Files:**
- Create: `apps/dashboard/src/components/AmazonInstallGuide.jsx`, `apps/dashboard/src/components/AmazonInstallGuide.css`
- Modify: `apps/dashboard/src/components/AmazonImport.jsx` (rewritten as a thin wrapper — keeps the exported component name and `{storeId, productId, onImported}` prop signature so `ImportReviews.jsx`'s 4th-tab wiring at `<AmazonImport storeId={storeId} productId={productId} onImported={...} />` needs zero changes)

**Interfaces:**
- Consumes: nothing new (static content component)
- Produces: `AmazonInstallGuide()` — no props, pure static instructional content. `AmazonImport({storeId, productId, onImported})` keeps its existing signature (all three props now unused by the new content, but kept so `ImportReviews.jsx` requires no edit) and renders `<AmazonInstallGuide />`.

- [ ] **Step 1: Create `AmazonInstallGuide.jsx`**

Create `apps/dashboard/src/components/AmazonInstallGuide.jsx`:

```javascript
import './AmazonInstallGuide.css';

const USERSCRIPT_RAW_URL = 'https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js';
const TAMPERMONKEY_URL = 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo';

// Replaces the old VPS-scrape UI (feature-03) — Amazon reviews now import via a
// browser-side Tampermonkey userscript (feature-04), since Amazon blocks the
// datacenter IP the old server-side scraper ran from. This component is pure
// static instructions; the actual scrape+import happens entirely client-side on
// Amazon.com via the userscript, POSTing to Titan's existing import_amazon_reviews
// action with a per-user API token (Settings > Users > Generate API token).
export default function AmazonInstallGuide() {
  return (
    <div className="az-guide">
      <div className="az-guide-sub">
        Amazon reviews now import via a browser userscript — it scrapes reviews directly
        on the Amazon page using your own logged-in session, so Amazon never blocks it.
      </div>

      <ol className="az-guide-steps">
        <li>
          <strong>Install Tampermonkey</strong> — the browser extension that runs userscripts.
          <div className="az-guide-action">
            <a href={TAMPERMONKEY_URL} target="_blank" rel="noopener noreferrer" className="rv-btn rv-btn--save">
              Get Tampermonkey
            </a>
          </div>
        </li>
        <li>
          <strong>Install the Titan userscript</strong> — click the link below, Tampermonkey will
          prompt you to install it.
          <div className="az-guide-action">
            <a href={USERSCRIPT_RAW_URL} target="_blank" rel="noopener noreferrer" className="rv-btn rv-btn--save">
              Install userscript
            </a>
          </div>
        </li>
        <li>
          <strong>Set your API token</strong> — go to <em>Settings → Users</em> in this dashboard,
          click <em>Generate API token</em> next to your own user row, copy it. Then click the
          Tampermonkey icon in your browser toolbar → <em>Titan Commerce — Amazon Reviews Importer</em> →
          <em> Configure Titan token</em>, and paste it in.
        </li>
        <li>
          <strong>Import from Amazon</strong> — visit any Amazon product page
          (e.g. <code>amazon.com/dp/B0EXAMPLE</code>), click the floating
          <em> Import to Titan</em> button in the bottom-right corner, pick the store + product,
          and confirm. Reviews land in this dashboard&apos;s Reviews queue as <strong>pending</strong>.
        </li>
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Create `AmazonInstallGuide.css`**

Create `apps/dashboard/src/components/AmazonInstallGuide.css`:

```css
.az-guide { display: flex; flex-direction: column; gap: 14px; }
.az-guide-sub { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.az-guide-steps { display: flex; flex-direction: column; gap: 14px; padding-left: 20px; margin: 0; }
.az-guide-steps li { font-size: 13px; line-height: 1.6; }
.az-guide-action { margin-top: 8px; }
.az-guide-steps code { background: var(--bg-surface-hover); padding: 2px 6px; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 12px; }
```

- [ ] **Step 3: Rewrite `AmazonImport.jsx` as a thin wrapper**

Replace the full contents of `apps/dashboard/src/components/AmazonImport.jsx` with:

```javascript
import AmazonInstallGuide from './AmazonInstallGuide';

// Kept as a thin wrapper (same component name + prop signature as feature-03's
// VPS-scrape version) so ImportReviews.jsx's 4th-tab wiring
// (<AmazonImport storeId={storeId} productId={productId} onImported={...} />)
// needs no changes. The actual scrape+import now happens client-side via the
// Tampermonkey userscript — this tab just shows install instructions.
// eslint-disable-next-line no-unused-vars
export default function AmazonImport({ storeId, productId, onImported }) {
  return <AmazonInstallGuide />;
}
```

- [ ] **Step 4: Delete the now-unused `AmazonImport.css` content (file stays, but the old `.az-form`/`.az-preview` rules are dead)**

Since `AmazonImport.jsx` no longer renders any of the `.az-form`/`.az-preview`/`.az-row` markup, and `AmazonInstallGuide.css` is the new component's own stylesheet, remove the now-dead import and file. Check first whether anything else imports `AmazonImport.css`:

Run: `grep -rn "AmazonImport.css" apps/dashboard/src/`
Expected: only `AmazonImport.jsx` referenced it, and Step 3's rewrite already dropped that import line — delete the file:

```bash
rm apps/dashboard/src/components/AmazonImport.css
```

- [ ] **Step 5: Vite build check**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds with no errors, no warnings about missing `AmazonImport.css`

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/AmazonInstallGuide.jsx apps/dashboard/src/components/AmazonInstallGuide.css apps/dashboard/src/components/AmazonImport.jsx
git rm apps/dashboard/src/components/AmazonImport.css
git commit -m "feat(userscript): replace Amazon VPS-scrape UI with userscript install guide"
```

---

### Task 7: Userscript scaffold — metadata + token config

**Files:**
- Create: `scripts/titan-amazon-userscript.user.js`

**Interfaces:**
- Consumes: nothing (this is the first userscript task; runs entirely outside the Titan test suite — Tampermonkey userscripts have no automated test harness in this repo, verified manually per Task 10)
- Produces: `GM_getValue('TITAN_API_TOKEN')`, `GM_getValue('TITAN_URL')` config contract that Task 8 depends on. A floating button injected on Amazon product/review pages with `id="titan-import-btn"` that Task 8 wires up.

- [ ] **Step 1: Write the userscript scaffold**

Create `scripts/titan-amazon-userscript.user.js`:

```javascript
// ==UserScript==
// @name         Titan Commerce — Amazon Reviews Importer
// @namespace    https://titan-commerce.vercel.app/
// @version      1.0.0
// @description  Scrape Amazon product reviews on this page and import them into Titan Commerce as pending reviews.
// @author       Dan
// @match        https://www.amazon.com/*
// @match        https://smile.amazon.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      titan-commerce.vercel.app
// @updateURL    https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_TITAN_URL = 'https://titan-commerce.vercel.app';

  function getConfig() {
    return {
      token: GM_getValue('TITAN_API_TOKEN', ''),
      titanUrl: GM_getValue('TITAN_URL', DEFAULT_TITAN_URL),
    };
  }

  function promptForToken() {
    const current = GM_getValue('TITAN_API_TOKEN', '');
    const next = window.prompt('Paste your Titan API token (Settings > Users > Generate API token):', current);
    if (next && next.trim()) {
      GM_setValue('TITAN_API_TOKEN', next.trim());
      window.alert('Titan API token saved.');
    }
  }

  function promptForUrl() {
    const current = GM_getValue('TITAN_URL', DEFAULT_TITAN_URL);
    const next = window.prompt('Titan dashboard URL:', current);
    if (next && next.trim()) {
      GM_setValue('TITAN_URL', next.trim().replace(/\/$/, ''));
      window.alert('Titan URL saved.');
    }
  }

  GM_registerMenuCommand('Configure Titan API token', promptForToken);
  GM_registerMenuCommand('Configure Titan URL', promptForUrl);

  // Amazon product pages: /dp/{ASIN} or /product-reviews/{ASIN}
  function extractAsin() {
    const m = window.location.pathname.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function injectButton(asin) {
    if (document.getElementById('titan-import-btn')) return; // already injected
    const btn = document.createElement('button');
    btn.id = 'titan-import-btn';
    btn.textContent = 'Import to Titan';
    btn.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
      'background:#1a1a2e', 'color:#fff', 'border:1px solid #4a4a6a',
      'border-radius:8px', 'padding:12px 18px', 'font-size:14px', 'font-weight:600',
      'cursor:pointer', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
    ].join(';');

    btn.addEventListener('click', () => {
      const { token } = getConfig();
      if (!token) {
        window.alert('No API token configured — go to Titan Settings > Users to generate one, then use the Tampermonkey menu (Configure Titan API token) to paste it in.');
        return;
      }
      // Step 8 replaces this placeholder with the real scrape + modal + POST flow.
      window.alert('Not implemented yet — scrape/import logic lands in the next userscript task.');
    });

    document.body.appendChild(btn);
  }

  function init() {
    const asin = extractAsin();
    if (!asin) return; // not a product/review page
    injectButton(asin);
  }

  init();
})();
```

- [ ] **Step 2: Verify syntax**

Run: `node --check scripts/titan-amazon-userscript.user.js`
Expected: exits 0, no output (the `// ==UserScript==` metadata block is a comment, valid JS; `GM_*` globals are undeclared identifiers but `--check` only validates syntax, not references, so this passes even though the globals only exist inside Tampermonkey's sandbox)

- [ ] **Step 3: Commit**

```bash
git add scripts/titan-amazon-userscript.user.js
git commit -m "feat(userscript): scaffold Tampermonkey userscript with token config + floating button"
```

---

### Task 8: Userscript — scrape + submit logic

**Files:**
- Modify: `scripts/titan-amazon-userscript.user.js`

**Interfaces:**
- Consumes: `GM_xmlhttpRequest` (Tampermonkey sandbox API); Titan's existing `products_list` reachable via `GET /api/system?action=stores_list` (for store dropdown) — NOTE: there is no `products_list_min` action in this codebase; the closest read action reachable via bearer auth for a product search is `GET /api/system?action=product_detail` (single product) or the paginated `api/products/list.js` route (`GET /api/products/list?store_id=&limit=&page=`). This task uses `api/products/list.js` since it's the actual products search/list endpoint (per `CLAUDE.md`'s Key Files table) — the outline's assumed `products_list_min` action does not exist and is not added by this plan (YAGNI: the existing paginated endpoint already returns `id, title, handle` per product, sufficient for a client-side filter).
- Produces: complete `Import to Titan` button behavior — scrape → confirm modal (store dropdown + product search + max-reviews) → paginated DOM scrape → POST to `import_amazon_reviews` with bearer token → toast result.

- [ ] **Step 1: Replace the placeholder click handler with the full flow**

In `scripts/titan-amazon-userscript.user.js`, find the placeholder block inside `injectButton`:

```javascript
    btn.addEventListener('click', () => {
      const { token } = getConfig();
      if (!token) {
        window.alert('No API token configured — go to Titan Settings > Users to generate one, then use the Tampermonkey menu (Configure Titan API token) to paste it in.');
        return;
      }
      // Step 8 replaces this placeholder with the real scrape + modal + POST flow.
      window.alert('Not implemented yet — scrape/import logic lands in the next userscript task.');
    });
```

Replace with:

```javascript
    btn.addEventListener('click', () => {
      const { token } = getConfig();
      if (!token) {
        window.alert('No API token configured — go to Titan Settings > Users to generate one, then use the Tampermonkey menu (Configure Titan API token) to paste it in.');
        return;
      }
      openImportModal(asin);
    });
```

- [ ] **Step 2: Add the anonymizer (mirrors `lib/actions/reviews-amazon.js`'s copy exactly, per D-07 in the spec)**

Add near the top of the IIFE, after `const DEFAULT_TITAN_URL = ...`:

```javascript
  // "John Smith" -> "John S." ; single-token/emoji-only/empty -> "Anonymous".
  // Mirrors the Titan-side copy in lib/actions/reviews-amazon.js (D-07) — this
  // client-side copy runs first so raw full names never leave the browser.
  function anonymizeAuthor(fullName) {
    if (!fullName || typeof fullName !== 'string') return 'Anonymous';
    const trimmed = fullName.trim();
    if (!trimmed) return 'Anonymous';
    if (trimmed.length === 1 || !/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
    const parts = trimmed.split(/\s+/);
    const first = parts[0];
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  function parseRating(text) {
    const first = String(text || '').trim().split(' ')[0].replace(',', '.');
    const n = parseFloat(first);
    return Number.isFinite(n) ? n : null;
  }

  function parseHelpfulCount(text) {
    const s = String(text || '').trim();
    if (!s) return 0;
    if (/^one person found this helpful/i.test(s)) return 1;
    const m = s.match(/(\d[\d,]*)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }

  function upgradePhotoUrl(url) {
    return url.replace(/\._[A-Z]{2}\d+_?\./, '._SL1600_.');
  }

  // Reuses feature-03's data-hook selector knowledge (lib/actions/reviews-amazon.js's
  // sibling VPS scraper, /root/titan-scraper/parser.js) — same DOM shape, different
  // execution context (real browser DOM here, not Puppeteer).
  const SELECTORS = {
    reviewCard: 'div[data-hook="review"]',
    starRating: 'i[data-hook="review-star-rating"] span.a-icon-alt',
    author: 'span.a-profile-name',
    reviewTitle: 'a[data-hook="review-title"] span:not([class*="a-color-secondary"])',
    reviewBody: 'span[data-hook="review-body"] span',
    verifiedBadge: 'span[data-hook="avp-badge"]',
    photos: 'div[data-hook="review-image-tile-section"] img',
    helpfulText: 'span[data-hook="helpful-vote-statement"]',
    reviewDate: 'span[data-hook="review-date"]',
    nextPageLink: 'ul.a-pagination li.a-last a',
  };

  function extractReviewsFromDom() {
    const cards = Array.from(document.querySelectorAll(SELECTORS.reviewCard));
    return cards.map((card) => {
      const starEl = card.querySelector(SELECTORS.starRating);
      const authorEl = card.querySelector(SELECTORS.author);
      const titleEl = card.querySelector(SELECTORS.reviewTitle);
      const bodyEl = card.querySelector(SELECTORS.reviewBody);
      const verifiedEl = card.querySelector(SELECTORS.verifiedBadge);
      const helpfulEl = card.querySelector(SELECTORS.helpfulText);
      const dateEl = card.querySelector(SELECTORS.reviewDate);
      const photoEls = Array.from(card.querySelectorAll(SELECTORS.photos));

      const rating = parseRating(starEl?.textContent?.trim());
      if (rating === null) return null;

      return {
        author: anonymizeAuthor(authorEl?.textContent?.trim()),
        rating,
        title: (titleEl?.textContent?.trim() || '').slice(0, 200),
        body: (bodyEl?.textContent?.trim() || '').slice(0, 2000),
        verified: !!verifiedEl,
        photo_urls: photoEls.map((img) => img.getAttribute('src')).filter(Boolean).slice(0, 1).map(upgradePhotoUrl),
        helpful_count: parseHelpfulCount(helpfulEl?.textContent?.trim()),
        review_date: dateEl?.textContent?.trim() || '',
      };
    }).filter(Boolean);
  }

  function gmFetch(url, options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers || {},
        data: options.body,
        timeout: 55000,
        onload: (resp) => resolve(resp),
        onerror: (err) => reject(new Error('Network error: ' + (err?.error || 'request failed'))),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  // Fetches up to maxReviews across paginated /product-reviews/{asin} pages by
  // navigating the actual browser tab (document.location) would lose script state,
  // so instead we fetch each page's HTML via GM_xmlhttpRequest and parse it with
  // DOMParser — keeps everything in one script execution, no page reloads.
  async function scrapeReviews(asin, maxReviews) {
    const collected = [];
    let pageNumber = 1;
    const { titanUrl } = getConfig(); // not used for scraping, kept for symmetry — Amazon URL below
    void titanUrl;

    while (collected.length < maxReviews && pageNumber <= 10) {
      const url = `https://${window.location.hostname}/product-reviews/${asin}/?sortBy=recent&pageNumber=${pageNumber}`;
      const resp = await gmFetch(url, { method: 'GET' });
      if (resp.status >= 400) break;

      const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
      const cards = Array.from(doc.querySelectorAll(SELECTORS.reviewCard));
      if (cards.length === 0) break;

      // Reuse the same extraction logic against the parsed page instead of the live DOM.
      const pageReviews = cards.map((card) => {
        const starEl = card.querySelector(SELECTORS.starRating);
        const authorEl = card.querySelector(SELECTORS.author);
        const titleEl = card.querySelector(SELECTORS.reviewTitle);
        const bodyEl = card.querySelector(SELECTORS.reviewBody);
        const verifiedEl = card.querySelector(SELECTORS.verifiedBadge);
        const helpfulEl = card.querySelector(SELECTORS.helpfulText);
        const dateEl = card.querySelector(SELECTORS.reviewDate);
        const photoEls = Array.from(card.querySelectorAll(SELECTORS.photos));
        const rating = parseRating(starEl?.textContent?.trim());
        if (rating === null) return null;
        return {
          author: anonymizeAuthor(authorEl?.textContent?.trim()),
          rating,
          title: (titleEl?.textContent?.trim() || '').slice(0, 200),
          body: (bodyEl?.textContent?.trim() || '').slice(0, 2000),
          verified: !!verifiedEl,
          photo_urls: photoEls.map((img) => img.getAttribute('src')).filter(Boolean).slice(0, 1).map(upgradePhotoUrl),
          helpful_count: parseHelpfulCount(helpfulEl?.textContent?.trim()),
          review_date: dateEl?.textContent?.trim() || '',
        };
      }).filter(Boolean);

      for (const r of pageReviews) {
        if (collected.length >= maxReviews) break;
        collected.push(r);
      }

      const hasNext = !!doc.querySelector(SELECTORS.nextPageLink);
      if (!hasNext) break;
      pageNumber += 1;
    }

    return collected.slice(0, maxReviews);
  }

  async function fetchProducts(titanUrl, token, storeId) {
    const resp = await gmFetch(`${titanUrl}/api/products/list?store_id=${encodeURIComponent(storeId)}&limit=200`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status >= 400) throw new Error(`Failed to load products (HTTP ${resp.status})`);
    const body = JSON.parse(resp.responseText);
    return body.products || [];
  }

  async function fetchStores(titanUrl, token) {
    const resp = await gmFetch(`${titanUrl}/api/system?action=stores_list`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status >= 400) throw new Error(`Failed to load stores (HTTP ${resp.status})`);
    const body = JSON.parse(resp.responseText);
    return body.stores || [];
  }

  function submitImport(titanUrl, token, storeId, productId, reviews) {
    return gmFetch(`${titanUrl}/api/system?action=import_amazon_reviews`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, product_id: productId, reviews }),
    });
  }

  function showToast(message, isError) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:24px', 'z-index:100000',
      `background:${isError ? '#5a1a1a' : '#1a3a1a'}`, 'color:#fff',
      'border-radius:8px', 'padding:12px 18px', 'font-size:13px', 'max-width:320px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function openImportModal(asin) {
    const { token, titanUrl } = getConfig();

    let stores;
    try {
      stores = await fetchStores(titanUrl, token);
    } catch (err) {
      showToast(`Could not load stores: ${err.message}`, true);
      return;
    }
    if (!stores.length) {
      showToast('No stores available for your account.', true);
      return;
    }

    const storeNames = stores.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const storeChoice = window.prompt(`Select a store (enter number):\n${storeNames}`, '1');
    const storeIdx = parseInt(storeChoice, 10) - 1;
    if (!Number.isFinite(storeIdx) || !stores[storeIdx]) {
      showToast('Import cancelled — no store selected.', true);
      return;
    }
    const store = stores[storeIdx];

    let products;
    try {
      products = await fetchProducts(titanUrl, token, store.id);
    } catch (err) {
      showToast(`Could not load products: ${err.message}`, true);
      return;
    }

    const search = window.prompt('Search Titan products by title (leave blank to list first 20):', '');
    const filtered = (search
      ? products.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
      : products
    ).slice(0, 20);

    if (!filtered.length) {
      showToast('No matching products found.', true);
      return;
    }

    const productNames = filtered.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const productChoice = window.prompt(`Select a product (enter number):\n${productNames}`, '1');
    const productIdx = parseInt(productChoice, 10) - 1;
    if (!Number.isFinite(productIdx) || !filtered[productIdx]) {
      showToast('Import cancelled — no product selected.', true);
      return;
    }
    const product = filtered[productIdx];

    const maxInput = window.prompt('How many reviews to import? (max 10)', '10');
    const maxReviews = Math.min(10, Math.max(1, parseInt(maxInput, 10) || 10));

    showToast(`Scraping up to ${maxReviews} reviews…`, false);
    let reviews;
    try {
      reviews = await scrapeReviews(asin, maxReviews);
    } catch (err) {
      showToast(`Scrape failed: ${err.message}`, true);
      return;
    }

    if (!reviews.length) {
      showToast('0 reviews found — DOM may have changed, check console.', true);
      console.warn('[titan-userscript] 0 reviews scraped for ASIN', asin);
      return;
    }

    try {
      const resp = await submitImport(titanUrl, token, store.id, product.id, reviews);
      if (resp.status === 401) {
        showToast('API token invalid — regenerate in Titan Settings > Users.', true);
        return;
      }
      if (resp.status === 429) {
        showToast('Titan rate limit hit — wait a bit and retry.', true);
        return;
      }
      if (resp.status >= 400) {
        showToast(`Import failed (HTTP ${resp.status}).`, true);
        return;
      }
      const body = JSON.parse(resp.responseText);
      showToast(`${body.inserted} reviews imported, ${body.duplicates} duplicates.`, false);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, true);
    }
  }
```

- [ ] **Step 3: Verify syntax**

Run: `node --check scripts/titan-amazon-userscript.user.js`
Expected: exits 0, no output

- [ ] **Step 4: Commit**

```bash
git add scripts/titan-amazon-userscript.user.js
git commit -m "feat(userscript): implement scrape + store/product picker + import POST flow"
```

---

### Task 9: CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing (documentation task)
- Produces: nothing consumed by later tasks — this is the terminal documentation update per the project's mandatory "update CLAUDE.md after every major change" rule

- [ ] **Step 1: Add the two new env vars**

In `CLAUDE.md`'s `## Env Vars` section, find:

```
AMAZON_SCRAPER_URL=***          # http://37.27.189.60:3100 — TC scraper VPS (Docker/Express/Puppeteer, NOT in this repo)
AMAZON_SCRAPER_TOKEN=***        # Shared bearer secret, must match /root/titan-scraper/.env on the VPS
FEATURE_AMAZON_REVIEWS_SCRAPER= # 'true' to enable the Amazon tab + backend actions, default off
```

Replace with:

```
AMAZON_SCRAPER_URL=***          # http://37.27.189.60:3100 — TC scraper VPS (Docker/Express/Puppeteer, NOT in this repo)
AMAZON_SCRAPER_TOKEN=***        # Shared bearer secret, must match /root/titan-scraper/.env on the VPS
FEATURE_AMAZON_REVIEWS_SCRAPER= # 'true' to enable the Amazon tab + import_amazon_reviews/scrape_amazon_preview actions, default off
FEATURE_AMAZON_USERSCRIPT=      # 'true' marks this feature as live in prod (no frontend gate exists — the Amazon tab is always visible, same as F03's precedent). import_amazon_reviews itself still gates on FEATURE_AMAZON_REVIEWS_SCRAPER (unchanged) — both must be 'true' for the userscript flow to work end to end.
AMAZON_USERSCRIPT_ORIGINS=      # optional comma-separated override for import_amazon_reviews CORS origins, default 'https://www.amazon.com,https://smile.amazon.com'
```

- [ ] **Step 2: Add the userscript file to the Key Files table**

Find the `**Backend libs** (`lib/`)` section header in the Key Files table and locate the row after the Action modules / API endpoints tables. Add a new row in an appropriate table section — after the `**API endpoints** (`api/`)` rows, before `**Agents** (`agents/`)`:

```
| **External deliverables** | |
| `scripts/titan-amazon-userscript.user.js` | Tampermonkey userscript — scrapes Amazon reviews client-side (Dan's residential IP + logged session), POSTs to `import_amazon_reviews` with a per-user bearer `api_token`. Hosted via GitHub raw URL + `@updateURL` for auto-update. Not deployed to Vercel — lives in the repo purely for version control + raw-URL hosting. |
```

- [ ] **Step 3: Document the auth flow addition**

In `CLAUDE.md`'s `### Auth Flow` subsection (under `## Important Patterns`), find the end of the existing bullet list (after the `**Public allow-list:**` bullet) and add:

```
- **Bearer `api_token` (userscript/API access):** `lib/auth.js`'s `verifyAuth` also accepts a flat 64-char hex token (no `.` — session tokens are `base64.hexsig` and always contain one) looked up directly against `users.api_token`. Generated via `generate_api_token` action (admin-only, `admin:users` perm), one-time reveal in Settings > Users. Used by `scripts/titan-amazon-userscript.user.js` to call `import_amazon_reviews` from the Amazon page. Regenerating overwrites the previous token (old one stops working immediately). Never replaces the session-token dashboard login path — fully parallel.
```

- [ ] **Step 4: Document the Amazon reviews section addition**

In the Reviews section of the `Database Schema` → `product_reviews` row or the `reviews*.js` action module description (wherever F03's Amazon scraper is documented — search for `reviews-amazon.js` in `CLAUDE.md`), find the sentence describing `reviews-amazon.js` and add a trailing note. Locate:

```
**`reviews-amazon.js`** = Phase 5: `scrape_amazon_preview` (calls TC scraper VPS at `AMAZON_SCRAPER_URL`, no DB write, `amazon_scrape:{user_id}` 10/hr) + `import_amazon_reviews` (downloads photos, inserts selected as `pending`/`source='amazon'`, author anonymized "John Smith"→"John S.", dedup via `dropExistingDuplicates`, max 10/import). Both gated on `products:edit` + `hasStoreAccess` + `FEATURE_AMAZON_REVIEWS_SCRAPER` env flag. `pipeline_log` agent=`AMAZON_SCRAPER`.
```

Append immediately after (same paragraph or a new sentence):

```
 **Alternative import path (feature-04):** `import_amazon_reviews` is also reachable from `scripts/titan-amazon-userscript.user.js` — a Tampermonkey userscript that scrapes the same review DOM client-side (bypassing the VPS/datacenter-IP block entirely) and POSTs with a bearer `api_token` instead of the dashboard session token. `AmazonImport.jsx` no longer runs the VPS scrape UI — it now renders `AmazonInstallGuide.jsx` (install instructions; the tab itself has no frontend flag-gate, same as before — `FEATURE_AMAZON_USERSCRIPT` is a backend-only marker env var, `import_amazon_reviews` still enforces `FEATURE_AMAZON_REVIEWS_SCRAPER`).
```

- [ ] **Step 5: Update the CORS comment in `api/system.js`**

Confirm the inline comment added in Task 4 Step 4 already explains the per-action model (it does — see Task 4's replacement code block). No further action needed here; this step exists only to close the loop explicitly per the outline.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document api_token bearer auth, generate_api_token, userscript, per-action CORS"
```

---

### Task 10: Deploy + smoke test

**Files:** none (deploy/manual verification task)

**Interfaces:**
- Consumes: everything from Tasks 1-9
- Produces: live, working end-to-end flow; `features/active/04-amazon-userscript.md` moved to `features/shipped/`

- [ ] **Manual step 1: Apply the SQL migration**

Open Supabase SQL Editor for the Titan project, paste and run the contents of `sql/add-user-api-token.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token) WHERE api_token IS NOT NULL;
```

Expected: no errors; `\d users` (or the Supabase table editor) shows the new `api_token` column.

- [ ] **Manual step 2: Merge to main + push**

```bash
git checkout main
git merge feat/amazon-userscript
git push origin main
```

Expected: Vercel auto-deploys from `main`.

- [ ] **Manual step 3: Set Vercel env vars**

In the Vercel project dashboard → Settings → Environment Variables, add:

```
FEATURE_AMAZON_USERSCRIPT=true
```

(`AMAZON_USERSCRIPT_ORIGINS` is optional — leave unset to use the default `https://www.amazon.com,https://smile.amazon.com`. `FEATURE_AMAZON_REVIEWS_SCRAPER` must already be `true` from the F03 deploy — verify it is; if not, set it too, since `import_amazon_reviews` still gates on it.)

Redeploy (Vercel → Deployments → ⋯ → Redeploy) to pick up the new env var.

- [ ] **Manual step 4: Generate Dan's own API token**

In the Titan dashboard: Settings → Users → find Dan's row → click "Generate API token" → copy the 64-char hex value from the modal (it will not be shown again).

- [ ] **Manual step 5: Install Tampermonkey + the userscript**

Install the Tampermonkey browser extension. Navigate to:
`https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js`
Tampermonkey should intercept and show an install prompt — click Install.

- [ ] **Manual step 6: Configure the token**

Click the Tampermonkey toolbar icon → "Titan Commerce — Amazon Reviews Importer" → "Configure Titan API token" → paste the token from Step 4.

- [ ] **Manual step 7: End-to-end smoke test**

Visit a real Amazon product page with reviews, e.g. `https://www.amazon.com/dp/B0EXAMPLE` (substitute a real ASIN with ≥10 reviews). Confirm:
- The floating "Import to Titan" button appears bottom-right
- Clicking it prompts for store selection, then product search/selection, then max-reviews
- After confirming, a toast shows scrape progress, then "N reviews imported, M duplicates"
- In the Titan dashboard, open the imported product's Reviews panel → confirm N new `pending`/`source='amazon'` reviews are visible, with photos (where present) uploaded to Supabase Storage

Expected: all of the above succeed with zero errors in the Tampermonkey console (accessible via the extension's icon → this script → inspect, or the browser devtools console since the userscript runs in the page context).

- [ ] **Manual step 8: Move the feature spec to shipped**

```bash
mkdir -p features/shipped
git mv features/active/04-amazon-userscript.md features/shipped/04-amazon-userscript.md
```

Add a changelog line to the moved file — open `features/shipped/04-amazon-userscript.md`, find the `## Changelog (append-only)` section:

```
## Changelog (append-only)

- `2026-07-29` Spec created.
```

Replace with:

```
## Changelog (append-only)

- `2026-07-29` Spec created.
- `2026-07-29` Shipped. `users.api_token` bearer auth, `generate_api_token` admin action, per-action CORS, userscript scaffold + scrape/import flow, install guide UI. `FEATURE_AMAZON_USERSCRIPT=true` in prod.
```

Also update the `status` and `shipped` frontmatter fields at the top of the file:

```yaml
status: active
...
shipped: null
```

Replace with:

```yaml
status: shipped
...
shipped: 2026-07-29
```

- [ ] **Manual step 9: Commit**

```bash
git add features/shipped/04-amazon-userscript.md
git rm features/active/04-amazon-userscript.md 2>/dev/null || true
git commit -m "docs: mark feature-04-amazon-userscript as shipped"
git push origin main
```

---

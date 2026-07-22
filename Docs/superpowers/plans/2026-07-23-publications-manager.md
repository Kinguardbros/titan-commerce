# Publications Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-unlist Shopify draft products from Online Store + CSV export of product visibility state, all from the Titan Products tab.

**Architecture:** New actions dispatched via `api/system.js` (Vercel 12-route Hobby cap already hit — NO new route files). GraphQL mutations `publishablePublish` / `publishableUnpublish` via a new `graphql()` method added to the `createShopifyClient` factory. Per-product try/catch pattern → partial success, never swallow errors. CSV = whitelisted columns (title, product_url, visibility) + RFC 4180 escaping + UTF-8 BOM for Excel. UI: 3 new extracted components (Products.jsx already 421 lines > 300 limit — do not grow beyond needed integration).

**Tech Stack:** React 19 + Vite (frontend, `apps/dashboard/`); Vercel Serverless Functions (Node, backend); Supabase Postgres (service-role from backend); Shopify Admin API 2024-01 (REST + GraphQL); Vitest (node env, no jsdom).

## Global Constraints

- **Vercel Hobby 12/12 routes** — NO new `api/*.js` files, everything via `api/system.js` (`?action=X` GET / `{ action }` POST body)
- **Auth** = password gate; `req.user = { authenticated: true }` — NO user_id
- **Store isolation** = require `store_id` in request body + resolve via `getStore(store_id)` from `lib/store-context.js`
- **`catch (e) {}` is FORBIDDEN** (CLAUDE.md rule 6) — always log via `console.error('[Module] ...', {context})` or re-throw
- **`npm install` always with `--legacy-peer-deps`** (Higgsfield peer conflict)
- **Files ≤ 300 lines** — Products.jsx already 421; add only what integration requires, extract new UI into `apps/dashboard/src/components/products/*`
- **Language** — UI text: English; code + comments: English; Docs/Briefs/Sprints: Czech
- **`pipeline_log.agent`** for this feature = `PUBLISHER` (already in the registered agent list in `CLAUDE.md` §Backend — currently "not wired yet"; this feature wires it up)
- **Action names** = flat `snake_case` (e.g. `bulk_make_unlisted`) — no dot-namespace
- **Rate-limit key** = `bulk_publish:{store_id}` — 10 calls per 60 000 ms (per-store)
- **Hard caps** — bulk publish/unpublish: 500 products / call; CSV export: 5 000 rows / call
- **Shopify Admin API version** — `2024-01` (matches existing `lib/shopify-admin.js:3`)
- **Shopify URLs** — must use `{handle}.myshopify.com` (Admin API rule, CLAUDE.md rule 8)
- **Feature flag** — `process.env.FEATURE_PUBLICATIONS_MANAGER` (env-var; Titan has no PostHog), default off; cleanup by 2026-09-01
- **CSV whitelist** — ONLY `title, product_url, visibility` columns (info-disclosure guardrail — NO price / COGS / cost / margin)
- **OAuth scope migration is a breaking change** — merchants must reautorize; documented as a manual step in Task 9

---

## File Structure

**Create (new files):**
- `sql/add-publications-manager.sql` — 2 ALTER TABLE statements
- `lib/actions/publications.js` — `bulk_make_unlisted`, `bulk_make_listed`
- `lib/actions/exports.js` — `export_products_csv`
- `lib/shopify-publications.js` — `getOnlineStorePublicationId(client)` helper
- `scripts/backfill-publication-ids.mjs` — one-shot script
- `apps/dashboard/src/components/products/StatusFilter.jsx` (+ `.css`)
- `apps/dashboard/src/components/products/SelectionToolbar.jsx` (+ `.css`)
- `apps/dashboard/src/components/products/BulkConfirmModal.jsx` (+ `.css`)
- `tests/publications.test.js`
- `tests/exports.test.js`
- `tests/shopify-graphql.test.js`
- `tests/product-upsert.test.js`

**Modify (existing files):**
- `lib/product-upsert.js:25` — hardcoded `status: 'active'` → `p.status`
- `lib/shopify-admin.js` — add `graphql(query, variables)` method to `createShopifyClient` factory + expose in return object
- `api/auth/shopify.js:6-12` — add `write_publications`, `read_publications` to `SCOPES`
- `api/system.js` — import + register new POST actions
- `apps/dashboard/src/pages/Products.jsx` — add `selectedIds` + `statusFilter` state, wire new components, add "Export CSV" button
- `apps/dashboard/src/lib/api.js` — add wrappers for new actions

---

### Task 1: DB migration + product-upsert status fix

**Files:**
- Create: `sql/add-publications-manager.sql`
- Modify: `lib/product-upsert.js:25`
- Test: `tests/product-upsert.test.js`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces:
  - New columns: `stores.online_store_publication_id TEXT NULL`, `products.publication_online_store BOOLEAN DEFAULT true`
  - `upsertProductFromShopify(storeId, storeUrl, p)` now preserves `p.status` verbatim (values: `'active'`, `'draft'`, `'archived'`)

- [ ] **Step 1: Write the failing test**

Create `tests/product-upsert.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: upsertMock,
    }),
  }),
}));

describe('upsertProductFromShopify — status handling', () => {
  let upsertProductFromShopify;

  beforeEach(async () => {
    vi.resetModules();
    upsertMock.mockClear();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/product-upsert.js');
    upsertProductFromShopify = mod.upsertProductFromShopify;
  });

  it('preserves DRAFT status from Shopify payload', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 111, handle: 'h1', title: 'T1', status: 'draft',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' }),
      expect.any(Object),
    );
  });

  it('preserves ARCHIVED status from Shopify payload', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 112, handle: 'h2', title: 'T2', status: 'archived',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' }),
      expect.any(Object),
    );
  });

  it('defaults to active when status is missing', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 113, handle: 'h3', title: 'T3',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/product-upsert.test.js`

Expected: FAIL — third test passes (already 'active'), but the first two fail because `lib/product-upsert.js:25` hardcodes `status: 'active'` regardless of `p.status`.

- [ ] **Step 3: Fix `lib/product-upsert.js:25`**

Change the line:

```javascript
    status: 'active',
```

to:

```javascript
    status: p.status || 'active',
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/product-upsert.test.js`

Expected: PASS (3/3).

- [ ] **Step 5: Write the SQL migration file**

Create `sql/add-publications-manager.sql`:

```sql
-- Publications Manager feature migration (2026-07-23)
-- Paste into Supabase SQL Editor. No BEGIN/COMMIT — Supabase editor runs single statements.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS online_store_publication_id TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS publication_online_store BOOLEAN DEFAULT true;
```

- [ ] **Step 6: Verify SQL migration is well-formed**

Run: `grep -c 'ADD COLUMN IF NOT EXISTS' sql/add-publications-manager.sql`

Expected output: `2`

(SQL must be applied against the live Supabase project as a manual step in Task 9 — no code execution here.)

- [ ] **Step 7: Commit**

```bash
git add sql/add-publications-manager.sql lib/product-upsert.js tests/product-upsert.test.js
git commit -m "feat(publications): DB migration + preserve Shopify status on upsert"
```

---

### Task 2: Add `graphql()` method to Shopify client factory

**Files:**
- Modify: `lib/shopify-admin.js`
- Test: `tests/shopify-graphql.test.js`

**Interfaces:**
- Consumes: nothing (extends existing factory)
- Produces: `createShopifyClient(storeUrl, token).graphql(query, variables?) → Promise<{data, errors}>` — throws on network error, returns raw GraphQL response body (with `data` + optional `errors`) on success

- [ ] **Step 1: Write the failing test**

Create `tests/shopify-graphql.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

describe('createShopifyClient — graphql()', () => {
  let createShopifyClient;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    globalThis.fetch = fetchMock;
    fetchMock.mockReset();
    const mod = await import('../lib/shopify-admin.js');
    createShopifyClient = mod.createShopifyClient;
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  it('POSTs GraphQL query with correct headers and returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { publications: { edges: [] } } }),
    });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    const result = await client.graphql('{ publications(first: 1) { edges { node { id } } } }');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://shop.myshopify.com/admin/api/2024-01/graphql.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Shopify-Access-Token': 'tok_123',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain('publications');
    expect(body.variables).toEqual({});
    expect(result).toEqual({ data: { publications: { edges: [] } } });
  });

  it('passes variables through', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    await client.graphql('mutation X($id: ID!) { x(id: $id) { id } }', { id: 'gid://x/1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: 'gid://x/1' });
  });

  it('returns null when token is missing', async () => {
    const client = createShopifyClient('shop.myshopify.com', null);
    const result = await client.graphql('{ __typename }');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when fetch response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    const client = createShopifyClient('shop.myshopify.com', 'tok_123');
    await expect(client.graphql('{ __typename }')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/shopify-graphql.test.js`

Expected: FAIL — `client.graphql is not a function`.

- [ ] **Step 3: Add `graphql()` to the factory**

Edit `lib/shopify-admin.js`. Inside `createShopifyClient(storeUrl, token)`, after the existing `rest()` inner function (near the top of the function, before `fetchOrders`), add:

```javascript
  async function graphql(query, variables = {}) {
    if (!token) return null;
    const res = await fetch(`https://${storeUrl}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[shopify] GraphQL ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`Shopify GraphQL failed: ${res.status}`);
    }
    return res.json();
  }
```

Then add `graphql,` to the return object at the bottom of the factory. Find the block:

```javascript
    listWebhooks, registerWebhook, deleteWebhook,
  };
```

Change it to:

```javascript
    listWebhooks, registerWebhook, deleteWebhook,
    graphql,
  };
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/shopify-graphql.test.js`

Expected: PASS (4/4).

- [ ] **Step 5: Verify existing tests still green**

Run: `npm test`

Expected: all pre-existing tests still pass; new tests (product-upsert, shopify-graphql) also pass.

- [ ] **Step 6: Commit**

```bash
git add lib/shopify-admin.js tests/shopify-graphql.test.js
git commit -m "feat(shopify): add graphql() method to createShopifyClient factory"
```

---

### Task 3: OAuth scopes + one-shot Online-Store publication-ID lookup

**Files:**
- Modify: `api/auth/shopify.js:6-12`
- Create: `lib/shopify-publications.js`
- Create: `scripts/backfill-publication-ids.mjs`

**Interfaces:**
- Consumes: `createShopifyClient(url, token).graphql(query, variables)` from Task 2
- Produces:
  - `getOnlineStorePublicationId(client) → Promise<string|null>` — GID like `"gid://shopify/Publication/12345"` or null if the `Online Store` publication isn't visible
  - Backfill script that populates `stores.online_store_publication_id` for every store with an `admin_token`
  - `SCOPES` in the OAuth flow now includes `read_publications, write_publications` (breaking — merchants must reauthorize)

- [ ] **Step 1: Add `write_publications` and `read_publications` to SCOPES**

Edit `api/auth/shopify.js`. Find:

```javascript
const SCOPES = [
  'read_all_orders', 'read_analytics', 'read_products', 'write_products',
  'read_customers', 'read_inventory', 'read_orders',
  'write_metaobjects', 'write_metaobject_definitions',
  'read_metaobjects', 'read_metaobject_definitions',
  'write_discounts', 'read_discounts', 'read_reports',
].join(',');
```

Replace with:

```javascript
const SCOPES = [
  'read_all_orders', 'read_analytics', 'read_products', 'write_products',
  'read_customers', 'read_inventory', 'read_orders',
  'write_metaobjects', 'write_metaobject_definitions',
  'read_metaobjects', 'read_metaobject_definitions',
  'write_discounts', 'read_discounts', 'read_reports',
  'read_publications', 'write_publications',
].join(',');
```

- [ ] **Step 2: Write the failing test for the helper**

Append to `tests/shopify-graphql.test.js` (same file — the helper wraps `client.graphql`, so it belongs in the same test module):

```javascript
describe('getOnlineStorePublicationId', () => {
  let getOnlineStorePublicationId;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/shopify-publications.js');
    getOnlineStorePublicationId = mod.getOnlineStorePublicationId;
  });

  it('returns the GID of the publication named "Online Store"', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({
        data: {
          publications: {
            edges: [
              { node: { id: 'gid://shopify/Publication/1', name: 'Point of Sale' } },
              { node: { id: 'gid://shopify/Publication/2', name: 'Online Store' } },
              { node: { id: 'gid://shopify/Publication/3', name: 'Shop' } },
            ],
          },
        },
      }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBe('gid://shopify/Publication/2');
    expect(client.graphql).toHaveBeenCalledWith(expect.stringContaining('publications(first:'));
  });

  it('returns null when there is no Online Store publication', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({
        data: { publications: { edges: [{ node: { id: 'gid://x/1', name: 'POS' } }] } },
      }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBeNull();
  });

  it('returns null when GraphQL returns errors', async () => {
    const client = {
      graphql: vi.fn().mockResolvedValue({ errors: [{ message: 'nope' }] }),
    };
    const id = await getOnlineStorePublicationId(client);
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `npm test -- tests/shopify-graphql.test.js`

Expected: FAIL — `Cannot find module '../lib/shopify-publications.js'`.

- [ ] **Step 4: Implement the helper**

Create `lib/shopify-publications.js`:

```javascript
// Shopify Publications API helpers — see docs/superpowers/plans/2026-07-23-publications-manager.md
// One-shot lookup: cache the returned GID in stores.online_store_publication_id.

const PUBLICATIONS_QUERY = `{
  publications(first: 20) {
    edges {
      node { id name }
    }
  }
}`;

/**
 * Return the GraphQL global ID of the "Online Store" publication for this shop.
 * @param {{graphql: (q: string, v?: object) => Promise<object|null>}} client — createShopifyClient()
 * @returns {Promise<string|null>} GID (e.g. "gid://shopify/Publication/12345") or null when missing
 */
export async function getOnlineStorePublicationId(client) {
  if (!client?.graphql) return null;
  const resp = await client.graphql(PUBLICATIONS_QUERY);
  if (!resp || resp.errors) {
    console.error('[publications] Failed to load publications list', { errors: resp?.errors });
    return null;
  }
  const edges = resp.data?.publications?.edges || [];
  const online = edges.find((e) => e.node?.name === 'Online Store');
  return online?.node?.id || null;
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/shopify-graphql.test.js`

Expected: PASS (7/7 total in this file now).

- [ ] **Step 6: Write the one-shot backfill script**

Create `scripts/backfill-publication-ids.mjs`:

```javascript
// One-shot: populate stores.online_store_publication_id for every store with an admin_token.
// Run AFTER merchants have reauthorized the Shopify app with the new scopes.
// Usage: node scripts/backfill-publication-ids.mjs
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { createShopifyClient } from '../lib/shopify-admin.js';
import { getOnlineStorePublicationId } from '../lib/shopify-publications.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: stores, error } = await supabase
  .from('stores')
  .select('id, name, shopify_url, admin_token, online_store_publication_id');

if (error) {
  console.error('Failed to load stores:', error);
  process.exit(1);
}

for (const store of stores || []) {
  if (!store.admin_token) {
    console.log(`[skip] ${store.name}: no admin_token`);
    continue;
  }
  if (store.online_store_publication_id) {
    console.log(`[skip] ${store.name}: already has publication_id (${store.online_store_publication_id})`);
    continue;
  }
  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const pubId = await getOnlineStorePublicationId(client);
  if (!pubId) {
    console.error(`[fail] ${store.name}: could not resolve Online Store publication (reauthorize with new scopes?)`);
    continue;
  }
  const { error: updErr } = await supabase
    .from('stores')
    .update({ online_store_publication_id: pubId })
    .eq('id', store.id);
  if (updErr) {
    console.error(`[fail] ${store.name}: DB update failed`, updErr);
    continue;
  }
  console.log(`[ok] ${store.name}: ${pubId}`);
}

console.log('Done.');
```

- [ ] **Step 7: Verify script file is syntactically valid**

Run: `node --check scripts/backfill-publication-ids.mjs`

Expected: exits with code 0 (no output on success).

- [ ] **Step 8: Commit**

```bash
git add api/auth/shopify.js lib/shopify-publications.js scripts/backfill-publication-ids.mjs tests/shopify-graphql.test.js
git commit -m "feat(publications): add read/write_publications scopes + publication-ID lookup helper + backfill script"
```

---

### Task 4: `bulk_make_unlisted` action (MVP core)

**Files:**
- Create: `lib/actions/publications.js`
- Modify: `api/system.js` (import + register in `POST_ACTIONS`)
- Test: `tests/publications.test.js`

**Interfaces:**
- Consumes:
  - `createShopifyClient(url, token).updateProductStatus(pid, 'active')` (existing REST wrapper, `lib/shopify-admin.js:266`)
  - `createShopifyClient(url, token).graphql(query, variables)` from Task 2
  - `getStore(store_id)` from `lib/store-context.js`
  - `rateLimit(key, max, windowMs)` from `lib/rate-limit.js`
  - `stores.online_store_publication_id` from Task 1 migration + Task 3 backfill
- Produces:
  - POST action `bulk_make_unlisted` — body `{ store_id, product_shopify_ids: number[] }`
  - Response shape: `{ success: true, updated: number, failed: [{id: number, error: string}] }`

- [ ] **Step 1: Write the failing test**

Create `tests/publications.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseState = { updated: [], logged: [], storeRow: null };
const supabaseFromMock = vi.fn(() => ({
  update: vi.fn((patch) => ({
    eq: vi.fn(async (_col, val) => {
      supabaseState.updated.push({ patch, shopify_id: val });
      return { error: null };
    }),
  })),
  insert: vi.fn(async (row) => {
    supabaseState.logged.push(row);
    return { error: null };
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: supabaseFromMock }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const graphqlMock = vi.fn();
const updateProductStatusMock = vi.fn();
vi.mock('../lib/shopify-admin.js', () => ({
  createShopifyClient: () => ({
    graphql: graphqlMock,
    updateProductStatus: updateProductStatusMock,
  }),
}));

function mockReqRes(body) {
  const req = { body, headers: {} };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

describe('bulk_make_unlisted', () => {
  let bulk_make_unlisted;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.updated = [];
    supabaseState.logged = [];
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_unlisted = mod.bulk_make_unlisted;
  });

  it('400s when store_id is missing', async () => {
    const { req, res } = mockReqRes({ product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when product_shopify_ids is empty', async () => {
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when store has no admin_token', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', admin_token: null });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when store has no online_store_publication_id', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: null,
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('429s when rate limit trips', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    rateLimitMock.mockResolvedValue(false);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [1] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('413s when batch exceeds 500', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: ids });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('happy path: unlists all products and returns success', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock.mockResolvedValue({
      data: { publishableUnpublish: { userErrors: [] } },
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, updated: 2, failed: [] });
    // Two products × two mutations each (status + unpublish)
    expect(updateProductStatusMock).toHaveBeenCalledTimes(2);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
    // DB updated per product
    expect(supabaseState.updated).toHaveLength(2);
    expect(supabaseState.updated[0].patch).toMatchObject({
      status: 'active', publication_online_store: false,
    });
    // pipeline_log written
    expect(supabaseState.logged).toHaveLength(1);
    expect(supabaseState.logged[0]).toMatchObject({ agent: 'PUBLISHER', level: 'info' });
  });

  it('partial success: one product fails, batch continues', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock
      .mockResolvedValueOnce({ data: { publishableUnpublish: { userErrors: [] } } })
      .mockResolvedValueOnce({
        data: { publishableUnpublish: { userErrors: [{ field: ['id'], message: 'Not found' }] } },
      });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 20, error: expect.stringContaining('Not found') }]);
  });

  it('marks product failed when updateProductStatus throws', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockRejectedValueOnce(new Error('boom'));
    updateProductStatusMock.mockResolvedValueOnce({ product: {} });
    graphqlMock.mockResolvedValue({ data: { publishableUnpublish: { userErrors: [] } } });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_unlisted(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 10, error: expect.stringContaining('boom') }]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/publications.test.js`

Expected: FAIL — `Cannot find module '../lib/actions/publications.js'`.

- [ ] **Step 3: Implement `lib/actions/publications.js`**

Create `lib/actions/publications.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { rateLimit } from '../rate-limit.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARD_CAP = 500;

const PUBLISHABLE_UNPUBLISH = `
mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
  publishableUnpublish(id: $id, input: $input) {
    publishable { availablePublicationsCount { count } }
    userErrors { field message }
  }
}`;

const PUBLISHABLE_PUBLISH = `
mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    publishable { availablePublicationsCount { count } }
    userErrors { field message }
  }
}`;

async function runBulkPublicationChange({ req, res, mode }) {
  // mode = 'unlist' | 'list'
  const { store_id, product_shopify_ids } = req.body || {};
  if (!store_id || !Array.isArray(product_shopify_ids) || product_shopify_ids.length === 0) {
    return res.status(400).json({ error: 'store_id and product_shopify_ids[] required' });
  }
  if (product_shopify_ids.length > HARD_CAP) {
    return res.status(413).json({ error: `Batch too large — max ${HARD_CAP} products per call` });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) {
    return res.status(400).json({
      error: 'Store has no admin token',
      hint: 'Publications require Shopify Admin API access.',
    });
  }
  if (!store.online_store_publication_id) {
    return res.status(400).json({
      error: 'Store missing online_store_publication_id',
      hint: 'Run scripts/backfill-publication-ids.mjs after reauthorizing the Shopify app.',
    });
  }

  if (!(await rateLimit(`bulk_publish:${store_id}`, 10, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 10 bulk publication calls per minute per store' });
  }

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const started = Date.now();
  const failed = [];
  let updated = 0;

  const mutation = mode === 'unlist' ? PUBLISHABLE_UNPUBLISH : PUBLISHABLE_PUBLISH;
  const mutationField = mode === 'unlist' ? 'publishableUnpublish' : 'publishablePublish';
  const nextPubState = mode === 'unlist' ? false : true;

  for (const pid of product_shopify_ids) {
    try {
      // 1. Ensure product is ACTIVE (unhide from DRAFT; a no-op if already ACTIVE)
      const statusResp = await client.updateProductStatus(pid, 'active');
      if (statusResp === null) throw new Error('updateProductStatus returned null (auth?)');

      // 2. Publish / unpublish on the Online Store publication
      const gqlResp = await client.graphql(mutation, {
        id: `gid://shopify/Product/${pid}`,
        input: [{ publicationId: store.online_store_publication_id }],
      });
      const userErrors = gqlResp?.data?.[mutationField]?.userErrors || [];
      if (userErrors.length > 0) {
        throw new Error(userErrors.map((e) => e.message).join('; '));
      }
      if (gqlResp?.errors?.length) {
        throw new Error(gqlResp.errors.map((e) => e.message).join('; '));
      }

      // 3. Mirror into Supabase (idempotent — matches Shopify)
      await supabase.from('products').update({
        status: 'active',
        publication_online_store: nextPubState,
      }).eq('shopify_id', pid);

      updated += 1;
    } catch (err) {
      console.error(`[publications/${mode}] product ${pid} failed:`, err);
      failed.push({ id: pid, error: err.message || String(err) });
    }
  }

  await supabase.from('pipeline_log').insert({
    store_id,
    agent: 'PUBLISHER',
    level: failed.length > 0 ? 'warn' : 'info',
    message: `Bulk ${mode === 'unlist' ? 'unlisted' : 'listed'} ${updated}/${product_shopify_ids.length} products`,
    metadata: {
      mode,
      requested: product_shopify_ids.length,
      updated,
      failed_ids: failed.map((f) => f.id),
      duration_ms: Date.now() - started,
    },
  });

  return res.status(200).json({ success: true, updated, failed });
}

export async function bulk_make_unlisted(req, res) {
  return runBulkPublicationChange({ req, res, mode: 'unlist' });
}

export async function bulk_make_listed(req, res) {
  return runBulkPublicationChange({ req, res, mode: 'list' });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/publications.test.js`

Expected: PASS (8/8).

- [ ] **Step 5: Register `bulk_make_unlisted` in `api/system.js`**

Edit `api/system.js`. Near the top import block (after the existing `import { bulk_price } from '../lib/actions/products.js';` line and grouped with the other action imports around line 15), add:

```javascript
import { bulk_make_unlisted, bulk_make_listed } from '../lib/actions/publications.js';
```

Then inside the `POST_ACTIONS` object (roughly lines 51-103), add both entries (registering both now avoids re-editing the router in Task 5):

```javascript
  bulk_make_unlisted,
  bulk_make_listed,
```

- [ ] **Step 6: Verify routing still green**

Run: `npm test -- tests/system-routing.test.js`

Expected: PASS (no regression — the routing test uses generic mocks and doesn't reference specific actions).

- [ ] **Step 7: Commit**

```bash
git add lib/actions/publications.js api/system.js tests/publications.test.js
git commit -m "feat(publications): bulk_make_unlisted + bulk_make_listed actions with partial-success handling"
```

---

### Task 5: Test coverage for `bulk_make_listed` (polish — reuses Task 4 impl)

**Files:**
- Modify: `tests/publications.test.js`

**Interfaces:**
- Consumes: `bulk_make_listed` (already implemented + registered in Task 4)
- Produces: happy-path + partial-success coverage for the listed variant

- [ ] **Step 1: Append the failing test to `tests/publications.test.js`**

Append at the end of the file:

```javascript
describe('bulk_make_listed', () => {
  let bulk_make_listed;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.updated = [];
    supabaseState.logged = [];
    getStoreMock.mockReset();
    rateLimitMock.mockReset().mockResolvedValue(true);
    graphqlMock.mockReset();
    updateProductStatusMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/publications.js');
    bulk_make_listed = mod.bulk_make_listed;
  });

  it('happy path: publishes products and sets publication_online_store=true', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock.mockResolvedValue({
      data: { publishablePublish: { userErrors: [] } },
    });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_listed(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(supabaseState.updated).toHaveLength(2);
    expect(supabaseState.updated[0].patch).toMatchObject({
      status: 'active', publication_online_store: true,
    });
    expect(supabaseState.logged[0].message).toContain('listed');
  });

  it('partial success on publishablePublish userErrors', async () => {
    getStoreMock.mockResolvedValue({
      id: 's1', admin_token: 't', shopify_url: 'x.myshopify.com',
      online_store_publication_id: 'gid://shopify/Publication/1',
    });
    updateProductStatusMock.mockResolvedValue({ product: {} });
    graphqlMock
      .mockResolvedValueOnce({ data: { publishablePublish: { userErrors: [] } } })
      .mockResolvedValueOnce({
        data: { publishablePublish: { userErrors: [{ message: 'archived' }] } },
      });
    const { req, res } = mockReqRes({ store_id: 's1', product_shopify_ids: [10, 20] });
    await bulk_make_listed(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.updated).toBe(1);
    expect(body.failed).toEqual([{ id: 20, error: expect.stringContaining('archived') }]);
  });
});
```

- [ ] **Step 2: Run test — expect PASS**

Run: `npm test -- tests/publications.test.js`

Expected: PASS (10/10 — the 8 existing `bulk_make_unlisted` tests + 2 new `bulk_make_listed` tests). The implementation was already added in Task 4.

- [ ] **Step 3: Commit**

```bash
git add tests/publications.test.js
git commit -m "test(publications): bulk_make_listed coverage"
```

---

### Task 6: `export_products_csv` action

**Files:**
- Create: `lib/actions/exports.js`
- Modify: `api/system.js` (import + register)
- Test: `tests/exports.test.js`

**Interfaces:**
- Consumes: `getStore(store_id)` from `lib/store-context.js`; Supabase `products` rows with `status` + `publication_online_store`
- Produces:
  - POST action `export_products_csv` — body `{ store_id, filters?: { status?, collection?, price?, creatives?, audience? } }`
  - Response = raw CSV (Content-Type `text/csv; charset=utf-8`, Content-Disposition attachment with `products-{slug}-{yyyy-mm-dd}.csv` filename)
  - Whitelist columns ONLY: `title, product_url, visibility`
  - `visibility` derivation:
    - `status === 'archived'` → `'archived'`
    - `status === 'draft'` → `'draft'`
    - `status === 'active'` AND `publication_online_store === false` → `'unlisted'`
    - `status === 'active'` AND `publication_online_store === true` (or null legacy) → `'listed'`
    - fallback → `'unknown'`
  - Hard cap 5 000 rows

- [ ] **Step 1: Write the failing test**

Create `tests/exports.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const productsRows = { rows: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: productsRows.rows, error: null })),
      };
      return chain;
    },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

function mockReqRes(body) {
  const headers = {};
  const req = { body, headers: {} };
  const res = {
    _status: 200,
    _body: null,
    _headers: headers,
    status: vi.fn(function (c) { this._status = c; return this; }),
    setHeader: vi.fn(function (k, v) { headers[k.toLowerCase()] = v; return this; }),
    send: vi.fn(function (b) { this._body = b; return this; }),
    end: vi.fn(function (b) { this._body = b; return this; }),
    json: vi.fn(function (o) { this._body = o; return this; }),
  };
  return { req, res, headers };
}

describe('export_products_csv', () => {
  let export_products_csv;

  beforeEach(async () => {
    vi.resetModules();
    productsRows.rows = [];
    getStoreMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/exports.js');
    export_products_csv = mod.export_products_csv;
  });

  it('400s when store_id missing', async () => {
    const { req, res } = mockReqRes({});
    await export_products_csv(req, res);
    expect(res._status).toBe(400);
  });

  it('returns CSV with header only when 0 rows (never 404)', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    productsRows.rows = [];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('text/csv');
    // Body starts with UTF-8 BOM + header row
    expect(res._body.startsWith('﻿title,product_url,visibility')).toBe(true);
    // Only header (+ trailing newline)
    expect(res._body.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('maps visibility correctly from status + publication_online_store', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    productsRows.rows = [
      { title: 'A', product_url: 'https://x/a', status: 'archived', publication_online_store: true },
      { title: 'B', product_url: 'https://x/b', status: 'draft', publication_online_store: true },
      { title: 'C', product_url: 'https://x/c', status: 'active', publication_online_store: false },
      { title: 'D', product_url: 'https://x/d', status: 'active', publication_online_store: true },
      { title: 'E', product_url: 'https://x/e', status: 'active', publication_online_store: null },
    ];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const lines = res._body.split('\n');
    expect(lines[1]).toBe('A,https://x/a,archived');
    expect(lines[2]).toBe('B,https://x/b,draft');
    expect(lines[3]).toBe('C,https://x/c,unlisted');
    expect(lines[4]).toBe('D,https://x/d,listed');
    // null publication_online_store on active → listed (legacy default)
    expect(lines[5]).toBe('E,https://x/e,listed');
  });

  it('RFC 4180-escapes titles with quotes, commas, and newlines', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    productsRows.rows = [
      { title: 'Say "hi"', product_url: 'https://x/a', status: 'active', publication_online_store: true },
      { title: 'Red, White & Blue', product_url: 'https://x/b', status: 'active', publication_online_store: true },
      { title: 'Multi\nline', product_url: 'https://x/c', status: 'active', publication_online_store: true },
    ];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const lines = res._body.split(/\r?\n/);
    expect(lines[1]).toBe('"Say ""hi""",https://x/a,listed');
    expect(lines[2]).toBe('"Red, White & Blue",https://x/b,listed');
    // Newline inside a quoted field — line split will not cleanly separate; assert it's quoted
    expect(res._body).toContain('"Multi\nline"');
  });

  it('sets Content-Disposition filename with store slug + today date', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const cd = res._headers['content-disposition'];
    expect(cd).toMatch(/attachment; filename="products-isola-\d{4}-\d{2}-\d{2}\.csv"/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/exports.test.js`

Expected: FAIL — `Cannot find module '../lib/actions/exports.js'`.

- [ ] **Step 3: Implement `lib/actions/exports.js`**

Create `lib/actions/exports.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARD_CAP = 5000;

// RFC 4180: wrap in double-quotes and double-escape internal quotes when the value
// contains a comma, newline, or quote. Empty / null values become empty string.
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function visibilityOf(row) {
  if (row.status === 'archived') return 'archived';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'active') {
    return row.publication_online_store === false ? 'unlisted' : 'listed';
  }
  return 'unknown';
}

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function export_products_csv(req, res) {
  const { store_id, filters } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store) return res.status(400).json({ error: 'store not found' });

  // Base query — whitelist only the columns we need (defense-in-depth against info-disclosure)
  let query = supabase
    .from('products')
    .select('title, product_url, status, publication_online_store')
    .eq('store_id', store_id);

  // Optional server-side filter (mirrors UI filters). Client-computed filters can be
  // applied post-fetch if needed; this covers the low-cardinality ones.
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  query = query.limit(HARD_CAP);

  const { data, error } = await query;
  if (error) {
    console.error('[exports] products query failed:', error);
    return res.status(500).json({ error: 'export query failed' });
  }

  const header = 'title,product_url,visibility';
  const rows = (data || []).map((r) =>
    [csvEscape(r.title), csvEscape(r.product_url), visibilityOf(r)].join(','),
  );
  // ﻿ = UTF-8 BOM — makes Excel recognize the file as UTF-8 (avoids mojibake on Windows)
  const body = '﻿' + [header, ...rows].join('\n') + '\n';

  const slug = store.slug || String(store_id).slice(0, 8);
  const filename = `products-${slug}-${todayIso()}.csv`;

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(body);
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/exports.test.js`

Expected: PASS (5/5).

- [ ] **Step 5: Register `export_products_csv` in `api/system.js`**

Edit `api/system.js`. Add near the other imports:

```javascript
import { export_products_csv } from '../lib/actions/exports.js';
```

Add inside `POST_ACTIONS`:

```javascript
  export_products_csv,
```

- [ ] **Step 6: Verify no regressions**

Run: `npm test`

Expected: all tests pass (pre-existing + product-upsert + shopify-graphql + publications + exports).

- [ ] **Step 7: Commit**

```bash
git add lib/actions/exports.js api/system.js tests/exports.test.js
git commit -m "feat(exports): export_products_csv with RFC 4180 escaping + UTF-8 BOM + visibility mapping"
```

---

### Task 7: Extract UI components — StatusFilter, SelectionToolbar, BulkConfirmModal

**Files:**
- Create: `apps/dashboard/src/components/products/StatusFilter.jsx` (+ `.css`)
- Create: `apps/dashboard/src/components/products/SelectionToolbar.jsx` (+ `.css`)
- Create: `apps/dashboard/src/components/products/BulkConfirmModal.jsx` (+ `.css`)

**Interfaces:**
- Consumes: nothing (pure presentational components — parent supplies state + handlers)
- Produces (props contracts — Task 8 depends on these):
  - `<StatusFilter value: 'all'|'draft'|'active'|'archived', onChange: (next) => void />`
  - `<SelectionToolbar selectedCount: number, onMakeUnlisted: () => void, onMakeListed: () => void, onExportCsv: () => void, onClear: () => void />`
  - `<BulkConfirmModal open: boolean, title: string, items: {id: number, title: string}[], confirmLabel: string, busy: boolean, onConfirm: () => void, onCancel: () => void />`

*(No unit tests — Vitest is configured for `env: node` per `vitest.config.js`; React components are verified manually + in Task 9 E2E.)*

- [ ] **Step 1: Create `StatusFilter.jsx`**

Create `apps/dashboard/src/components/products/StatusFilter.jsx`:

```javascript
import './StatusFilter.css';

const OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

export default function StatusFilter({ value, onChange }) {
  return (
    <div className="pf-group">
      <div className="pf-label">Status</div>
      <div className="pf-chips">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`pf-chip${value === o.key ? ' pf-chip--active' : ''}`}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

Create `apps/dashboard/src/components/products/StatusFilter.css`:

```css
/* StatusFilter — piggybacks on the existing .pf-chip / .pf-group styles from Products.css.
   No overrides needed today; keep the file so styles can grow here without touching Products.css. */
```

- [ ] **Step 2: Create `SelectionToolbar.jsx`**

Create `apps/dashboard/src/components/products/SelectionToolbar.jsx`:

```javascript
import { useState, useRef, useEffect } from 'react';
import './SelectionToolbar.css';

export default function SelectionToolbar({
  selectedCount, onMakeUnlisted, onMakeListed, onExportCsv, onClear,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  if (selectedCount === 0) return null;

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Bulk actions">
      <div className="selection-toolbar__count">{selectedCount} selected</div>
      <div className="selection-toolbar__actions" ref={menuRef}>
        <button
          type="button"
          className="selection-toolbar__btn selection-toolbar__btn--primary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          Bulk actions ▾
        </button>
        {open && (
          <div className="selection-toolbar__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMakeUnlisted(); }}>
              Make Unlisted
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMakeListed(); }}>
              Make Listed
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onExportCsv(); }}>
              Export selected as CSV
            </button>
          </div>
        )}
        <button
          type="button"
          className="selection-toolbar__btn"
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
```

Create `apps/dashboard/src/components/products/SelectionToolbar.css`:

```css
.selection-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin: 12px 0;
  background: var(--surface-2, #1a1a1e);
  border: 1px solid var(--border, #2a2a30);
  border-radius: 8px;
}

.selection-toolbar__count {
  font-weight: 600;
  color: var(--text-primary, #eee);
}

.selection-toolbar__actions {
  position: relative;
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.selection-toolbar__btn {
  background: transparent;
  color: var(--text-primary, #eee);
  border: 1px solid var(--border, #2a2a30);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font: inherit;
}

.selection-toolbar__btn--primary {
  background: var(--accent, #6c5ce7);
  border-color: var(--accent, #6c5ce7);
  color: #fff;
}

.selection-toolbar__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--surface-2, #1a1a1e);
  border: 1px solid var(--border, #2a2a30);
  border-radius: 6px;
  min-width: 220px;
  z-index: 20;
  overflow: hidden;
}

.selection-toolbar__menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: transparent;
  color: var(--text-primary, #eee);
  border: none;
  cursor: pointer;
  font: inherit;
}

.selection-toolbar__menu button:hover {
  background: var(--surface-3, #26262c);
}
```

- [ ] **Step 3: Create `BulkConfirmModal.jsx`**

Create `apps/dashboard/src/components/products/BulkConfirmModal.jsx`:

```javascript
import './BulkConfirmModal.css';

export default function BulkConfirmModal({
  open, title, items, confirmLabel, busy, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="bulk-modal__backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bulk-modal">
        <div className="bulk-modal__title">{title}</div>
        <div className="bulk-modal__body">
          <div className="bulk-modal__count">{items.length} products affected:</div>
          <ul className="bulk-modal__list">
            {items.slice(0, 50).map((it) => (
              <li key={it.id}>{it.title}</li>
            ))}
            {items.length > 50 && <li>… and {items.length - 50} more</li>}
          </ul>
        </div>
        <div className="bulk-modal__actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="bulk-modal__confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Create `apps/dashboard/src/components/products/BulkConfirmModal.css`:

```css
.bulk-modal__backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}

.bulk-modal {
  background: var(--surface-1, #111114);
  border: 1px solid var(--border, #2a2a30);
  border-radius: 10px;
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.bulk-modal__title {
  padding: 16px 20px;
  font-weight: 600;
  font-size: 1.05rem;
  border-bottom: 1px solid var(--border, #2a2a30);
  color: var(--text-primary, #eee);
}

.bulk-modal__body {
  padding: 16px 20px;
  overflow-y: auto;
  color: var(--text-primary, #eee);
}

.bulk-modal__count {
  margin-bottom: 10px;
  color: var(--text-secondary, #a8a8b0);
}

.bulk-modal__list {
  list-style: disc inside;
  padding: 0;
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.6;
}

.bulk-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border, #2a2a30);
}

.bulk-modal__actions button {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border, #2a2a30);
  background: transparent;
  color: var(--text-primary, #eee);
  cursor: pointer;
  font: inherit;
}

.bulk-modal__actions button:disabled { opacity: 0.5; cursor: not-allowed; }

.bulk-modal__confirm {
  background: var(--accent, #6c5ce7) !important;
  border-color: var(--accent, #6c5ce7) !important;
  color: #fff !important;
}
```

- [ ] **Step 4: Verify Vite build still succeeds**

Run: `cd apps/dashboard && npm run build`

Expected: build succeeds; the new components compile (unused-import warnings are fine — they'll be wired in Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/products/
git commit -m "feat(products-ui): extract StatusFilter, SelectionToolbar, BulkConfirmModal components"
```

---

### Task 8: Wire Products.jsx to new API + components

**Files:**
- Modify: `apps/dashboard/src/pages/Products.jsx`
- Modify: `apps/dashboard/src/lib/api.js`

**Interfaces:**
- Consumes:
  - Backend actions from Tasks 4/5/6: `bulk_make_unlisted`, `bulk_make_listed`, `export_products_csv`
  - Components from Task 7: `StatusFilter`, `SelectionToolbar`, `BulkConfirmModal`
- Produces: interactive Products tab that satisfies feature spec ACs (selection → confirm → bulk API call → toast → refetch; status filter chip row; export CSV button always visible)

- [ ] **Step 1: Add API wrappers in `apps/dashboard/src/lib/api.js`**

Open `apps/dashboard/src/lib/api.js` and append at the end of the file:

```javascript
// Publications Manager
export function bulkMakeUnlisted(storeId, productShopifyIds) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({
      action: 'bulk_make_unlisted',
      store_id: storeId,
      product_shopify_ids: productShopifyIds,
    }),
  });
}

export function bulkMakeListed(storeId, productShopifyIds) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({
      action: 'bulk_make_listed',
      store_id: storeId,
      product_shopify_ids: productShopifyIds,
    }),
  });
}

// CSV export — cannot use fetchJSON because response is text/csv, not JSON.
// Downloads via anchor with object URL.
export async function exportProductsCsv(storeId, filters = {}) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/system`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'export_products_csv', store_id: storeId, filters }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hint || body.details || body.error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  // Extract filename from Content-Disposition
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m ? m[1] : `products-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Wire selection + status filter + bulk actions into Products.jsx**

Open `apps/dashboard/src/pages/Products.jsx`. Apply three changes:

**A. Imports (top of file, after the existing imports):**

```javascript
import StatusFilter from '../components/products/StatusFilter';
import SelectionToolbar from '../components/products/SelectionToolbar';
import BulkConfirmModal from '../components/products/BulkConfirmModal';
import { bulkMakeUnlisted, bulkMakeListed, exportProductsCsv } from '../lib/api';
```

**B. State — inside `Products()` component, next to the other `useState` declarations (around lines 40-59), add:**

```javascript
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // Shopify product IDs
  const [statusFilter, setStatusFilter] = useState('all');
  const [bulkModal, setBulkModal] = useState(null); // null | { mode: 'unlist'|'list', items }
  const [bulkBusy, setBulkBusy] = useState(false);
```

**C. Handlers — inside `Products()` body, before the `return`, add:**

```javascript
  const toggleSelect = useCallback((shopifyId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(shopifyId)) next.delete(shopifyId); else next.add(shopifyId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const openBulk = useCallback((mode) => {
    const items = allProducts
      .filter((p) => selectedIds.has(p.shopify_id))
      .map((p) => ({ id: p.shopify_id, title: p.title }));
    setBulkModal({ mode, items });
  }, [allProducts, selectedIds]);

  const runBulk = useCallback(async () => {
    if (!bulkModal) return;
    setBulkBusy(true);
    try {
      const ids = bulkModal.items.map((i) => i.id);
      const fn = bulkModal.mode === 'unlist' ? bulkMakeUnlisted : bulkMakeListed;
      const result = await fn(storeId, ids);
      const verb = bulkModal.mode === 'unlist' ? 'unlisted' : 'listed';
      if (result.failed?.length > 0) {
        toast.info(`${result.updated} ${verb}, ${result.failed.length} failed`);
      } else {
        toast.success(`${result.updated} products ${verb}`);
      }
      setBulkModal(null);
      clearSelection();
      // Refetch first page so DB status/publication changes surface in UI
      fetchProducts(1, false);
    } catch (err) {
      toast.error(`Bulk failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  }, [bulkModal, storeId, toast, clearSelection, fetchProducts]);

  const handleExportCsv = useCallback(async () => {
    try {
      await exportProductsCsv(storeId, {
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      toast.success('CSV downloaded');
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    }
  }, [storeId, statusFilter, toast]);
```

**D. Rendering — three insertions:**

1. Add an "Export CSV" button to the `products-actions` block. Find the block that renders the Sync button (`<button className="products-sync-btn" onClick={handleSync} ...>Sync Shopify</button>`) and insert BEFORE it:

```javascript
          <button className="products-sync-btn" onClick={handleExportCsv} title="Download filtered products as CSV">
            Export CSV
          </button>
```

2. Add `<StatusFilter />` at the top of the `.pf-bar` block (immediately after `<div className="pf-bar">` opens, before the Collection group):

```javascript
        <StatusFilter value={statusFilter} onChange={setStatusFilter} />
```

3. Add `<SelectionToolbar />` and `<BulkConfirmModal />` right BEFORE the `{loading ? ...}` conditional in the render tree:

```javascript
      <SelectionToolbar
        selectedCount={selectedIds.size}
        onMakeUnlisted={() => openBulk('unlist')}
        onMakeListed={() => openBulk('list')}
        onExportCsv={handleExportCsv}
        onClear={clearSelection}
      />
      <BulkConfirmModal
        open={!!bulkModal}
        title={bulkModal?.mode === 'unlist' ? 'Make Unlisted' : 'Make Listed'}
        items={bulkModal?.items || []}
        confirmLabel={bulkModal?.mode === 'unlist' ? 'Unlist' : 'List'}
        busy={bulkBusy}
        onConfirm={runBulk}
        onCancel={() => setBulkModal(null)}
      />
```

**E. Client-side statusFilter application** — Find the block where `filtered` is derived (search for `filtered.length` in the JSX or the `useMemo` producing `filtered`). Inside that filter chain, add a `statusFilter` guard (matches on `p.status`; treat `'all'` as no filter). Example insertion into the existing `useMemo`:

```javascript
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
```

**F. Product row checkbox** — Find where each product row renders (grid/list/cards). For the primary rendering (list mode is the default per `localStorage.getItem('products_view') || 'list'`), add a checkbox as the first child of each row element with:

```jsx
<input
  type="checkbox"
  checked={selectedIds.has(p.shopify_id)}
  onChange={(e) => { e.stopPropagation(); toggleSelect(p.shopify_id); }}
  onClick={(e) => e.stopPropagation()}
  aria-label={`Select ${p.title}`}
  className="products-row-checkbox"
/>
```

Add the corresponding CSS to `apps/dashboard/src/pages/Products.css` (append):

```css
.products-row-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--accent, #6c5ce7);
}
```

- [ ] **Step 3: Build to verify no compile errors**

Run: `cd apps/dashboard && npm run build`

Expected: production build succeeds.

- [ ] **Step 4: Manual smoke test (dev)**

Run: `cd apps/dashboard && npm run dev` (in one shell), and separately `vercel dev` (in another) so the API is served.

Verify in the browser:
1. Products tab loads.
2. Status chip row shows All / Draft / Active / Archived; clicking Draft filters the grid.
3. Clicking a row checkbox increments the SelectionToolbar count.
4. "Bulk actions ▾" dropdown opens with Make Unlisted / Make Listed / Export selected as CSV.
5. Confirm modal lists the selected titles. Cancel closes; Confirm calls the API (watch the network tab).
6. "Export CSV" button in header downloads a file `products-<slug>-YYYY-MM-DD.csv`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/Products.jsx apps/dashboard/src/pages/Products.css apps/dashboard/src/lib/api.js
git commit -m "feat(products-ui): wire StatusFilter + SelectionToolbar + bulk actions + Export CSV"
```

---

### Task 9: E2E verification, deploy, docs, ship

**Files:**
- Modify: `CLAUDE.md`
- Move: `features/active/01-publications-manager.md` → `features/shipped/01-publications-manager.md` + set `status: shipped` + `shipped: 2026-07-XX`

**Interfaces:**
- Consumes: everything from Tasks 1-8
- Produces: shipped feature, docs sync, feature file relocated

- [ ] **Step 1: Manual — apply SQL migration on Supabase**

Open Supabase SQL Editor for the Titan Commerce project. Paste the contents of `sql/add-publications-manager.sql` and run.

Verify:
- `SELECT column_name FROM information_schema.columns WHERE table_name='stores' AND column_name='online_store_publication_id';` returns 1 row.
- `SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='publication_online_store';` returns 1 row.

- [ ] **Step 2: Manual — reauthorize the Shopify app**

For each store (Elegance House, Isola, Eleganz Haus):
1. Go to Shopify Partners → the Titan Commerce custom app → App setup.
2. Trigger the OAuth install flow (via `{APP_URL}/api/auth/shopify?store_id=<id>` or the equivalent Titan UI action).
3. Approve the new scopes (Shopify will show the delta including `read_publications` + `write_publications`).

Verify: the OAuth callback logs a `pipeline_log` entry with `agent='AUTH'` including the new scopes in `metadata.scopes`.

- [ ] **Step 3: Manual — run the backfill script**

Run: `node scripts/backfill-publication-ids.mjs`

Expected: `[ok] <store name>: gid://shopify/Publication/<id>` for each store with an admin token. Verify with:

```sql
SELECT name, online_store_publication_id FROM stores;
```

- [ ] **Step 4: Manual — trigger a fresh Shopify sync**

In the Products tab, click "Sync Shopify". Verify:
- Draft products in Shopify land with `status='draft'` in Titan (this exercises the Task 1 fix). Confirm via `SELECT status, COUNT(*) FROM products GROUP BY status;`.

- [ ] **Step 5: Manual — smoke-test bulk unlist**

Pick 5 draft products in Isola. Select them → Bulk actions → Make Unlisted → confirm. Verify:
- Toast reads `5 products unlisted`.
- In Shopify Admin, all 5 are now `Active` and unpublished from Online Store (Sales channels panel).
- The direct product URL (`https://isolaswim.com/products/<handle>`) returns 200 and renders the product.
- The collection/catalog page does NOT show them.
- `SELECT status, publication_online_store FROM products WHERE shopify_id IN (...);` returns `active` + `false` for all 5.
- A `pipeline_log` row exists with `agent='PUBLISHER'` + `metadata.updated=5, failed_ids=[]`.

- [ ] **Step 6: Manual — smoke-test CSV export**

Click Export CSV. Open the file in Excel and in a text editor. Verify:
- First byte is UTF-8 BOM (`﻿`).
- Columns: `title, product_url, visibility`.
- The 5 previously-unlisted products show `visibility=unlisted`.
- Titles with commas / quotes appear correctly quoted.

- [ ] **Step 7: Update `CLAUDE.md`**

Apply the following edits:

1. In the **Key Files** table under `lib/actions/`, add rows:
   ```
   | `publications.js` | `bulk_make_unlisted`, `bulk_make_listed` — GraphQL `publishablePublish`/`publishableUnpublish` on Online Store publication, per-product try/catch |
   | `exports.js` | `export_products_csv` — RFC 4180 + UTF-8 BOM, whitelisted columns (title, product_url, visibility) |
   ```

2. In the **Key Files** table under Backend libs, add row:
   ```
   | `shopify-publications.js` | `getOnlineStorePublicationId(client)` — one-shot GraphQL lookup of the Online Store publication GID |
   ```

3. In the `lib/shopify-admin.js` row, update the description to mention the new `graphql()` factory method:
   Change `createShopifyClient(url, token) factory, read (...) + write (...)` to also include `+ graphql() for Publications mutations`.

4. In the **Backend** conventions section, agent names list, remove `PUBLISHER` from the "not wired yet" characterization (it's now wired).

5. In the **Database Schema** table:
   - Update the `stores` row to append `, online_store_publication_id (GraphQL GID for Online Store publication)`.
   - Update the `products` row to append `, publication_online_store (BOOLEAN, cached Online Store publication state; false = unlisted)`.

6. In the **App Structure** table, update the Products tab row purpose to add "bulk publications management (Make Unlisted / Make Listed) + CSV export".

7. In the **DB migrations** area (near the `product_reviews` migration list), add: `sql/add-publications-manager.sql` (adds `stores.online_store_publication_id` + `products.publication_online_store`).

- [ ] **Step 8: Ship the feature spec — move to `features/shipped/`**

Run:

```bash
mkdir -p features/shipped
git mv features/active/01-publications-manager.md features/shipped/01-publications-manager.md
```

Then edit `features/shipped/01-publications-manager.md` frontmatter:
- Change `status: active` → `status: shipped`
- Change `shipped: null` → `shipped: 2026-07-XX` (today's actual date)
- Append to the Changelog: `- 2026-07-XX Shipped. Backfill run, all 3 stores reauthorized, bulk unlist verified on 5 Isola drafts.`

- [ ] **Step 9: Final regression sweep**

Run: `npm test`

Expected: full suite green (all pre-existing tests + new: product-upsert, shopify-graphql (with getOnlineStorePublicationId), publications, exports).

- [ ] **Step 10: Commit + deploy**

```bash
git add CLAUDE.md features/
git commit -m "docs(publications): update CLAUDE.md + ship feature spec to features/shipped/"
```

Deploy via the project's normal Vercel deploy flow (push to main / `vercel --prod`). Post-deploy, verify:
- The Products tab in production loads with the new UI.
- A canary bulk-unlist on 1 real Isola draft returns a successful toast.
- `pipeline_log` in production has a `PUBLISHER` row from the canary run.

---

## Self-Review

**1. Spec coverage — all sub-scopes traced:**
- MVP: upsert fix (Task 1) · migration + publication-ID lookup (Tasks 1, 3) · scopes + reauthorize (Tasks 3, 9) · `bulk_make_unlisted` + router registration (Task 4) · StatusFilter + checkboxes + SelectionToolbar + BulkConfirmModal UI (Tasks 7, 8) · `store_id` validation via `getStore()` (Task 4 code) · happy-path Gherkin (Task 9 smoke) ✅
- Polish: `bulk_make_listed` (Tasks 4 impl + 5 test) · CSV export action + button (Tasks 6, 8) · toast styling (Task 8) · loading state (`bulkBusy` in Task 8 modal + `Working…` label) ✅
- Hardening: per-product try/catch never-swallow (Task 4 impl) · rate limit per-store 10/min (Task 4) · audit log with agent=PUBLISHER + duration + failed_ids (Task 4) · single retry: NOT implemented in MVP — kept out per "cut order under time pressure" and to avoid amplifying user-visible failures; documented as a future improvement in the shipped feature's changelog if needed · full edge-case grid: partial success + missing publication_id + hostile-D 500 cap all covered ✅
- Instrumentation: pipeline_log with success/failed counts + duration_ms covers NSM tracking; guardrail alert on 5%+ error rate is manual (Titan has no alerting) — acceptable per env-var flag ✅

**2. Gherkin scenario coverage:**
- "Bulk make draft products unlisted" → Tasks 4 (impl) + 8 (UI wiring) + 9 (E2E) ✅
- "Per-product error handling in bulk operation" → Task 4 test cases (`partial success`, `updateProductStatus throws`) ✅
- "Export filtered products to CSV" → Task 6 test cases (visibility mapping, RFC 4180) + Task 8 (filter passthrough in `handleExportCsv`) ✅

**3. Edge cases (matrix):**
- Rate limit mid-batch: rate-limit is per-call, not per-product; batch itself is a single call. Exponential backoff on Shopify GraphQL THROTTLE was scoped down — MVP relies on the 10/min per-store gate + upstream throttling. Documented via failed_ids in pipeline_log.
- Product already archived / not found: caught by per-product `try/catch` → `failed[]` (Task 4 test `partial success on userErrors`).
- Prazdny filter → export: Task 6 test `returns CSV with header only when 0 rows`.
- Titles with quotes/commas/newlines/emoji: Task 6 test `RFC 4180-escapes...`.
- Cross-store product manipulation: Task 4 uses `store.online_store_publication_id` from the resolved store — a foreign product ID would still be sent to the current store's admin token and Shopify would 404. Belt-and-braces `store_id` cross-check on `products` was deferred (Shopify rejects mismatched product IDs on its own, and the 404 becomes a `failed[]` entry). Called out as follow-up.
- CSV info-disclosure: whitelist in Task 6 SQL select — only 4 columns leave the DB.

**4. Placeholder scan:** ripgrep-in-my-head over the plan for "TBD" / "TODO" / "similar to" / "add appropriate" — none present. All code steps have complete code, all commands have expected output, all manual steps are explicit.

**5. Type/name consistency:**
- `bulk_make_unlisted` / `bulk_make_listed` / `export_products_csv` — same spelling in publications.js, api/system.js, api.js, tests.
- `online_store_publication_id` (snake_case in DB) vs `store.online_store_publication_id` (JS property) — consistent (Supabase returns column names as-is).
- `publication_online_store` (BOOLEAN) — consistent everywhere.
- `visibility` mapping (`archived | draft | unlisted | listed | unknown`) — identical in Task 6 impl + test + spec.
- `PUBLISHER` agent name — consistent with CLAUDE.md registry.

Gaps found and folded in: Task 5 originally scoped as full re-implementation of `bulk_make_listed`, downsized to test-only because Task 4's shared `runBulkPublicationChange` helper already implements both — DRY.

## Verified open questions (post-plan review 2026-07-23)

- **OAuth reinstall entrypoint:** ✅ Existing button `<a href="/api/auth/shopify?store_id={id}">Connect Shopify Admin</a>` in `apps/dashboard/src/components/ShopifyDashboard.jsx:29`. Task 9 Step 2 manual reautorizace = click this button per store (nebo přímý URL). Není potřeba nová UI.
- **stores.slug column:** ✅ Existuje jako `TEXT UNIQUE NOT NULL` v `sql/add-stores.sql:8` (defaultně vyplněno pro všechny 3 stores). Fallback `String(store_id).slice(0, 8)` v `lib/actions/exports.js` je defensive-only — nikdy nespustí.

## Reuse pattern discovery (post-plan)

- **Selection UI již existuje v `apps/dashboard/src/pages/Shopify.jsx` (Pricing panel):** `selected` Set state, `toggleSelect` handler, select-all checkbox v header, `sh-pricing-row--selected` row styling. Task 7's `SelectionToolbar.jsx` může výrazně ušetřit čas když si tenhle pattern zkopíruje/zobecní místo psaní od nuly. Implementer v Task 7 by měl nejdřív přečíst `Shopify.jsx:120-140` a přenést pattern.

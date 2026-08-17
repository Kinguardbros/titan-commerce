# Runbook — New store onboarding

Step-by-step checklist for adding a store to Titan Commerce (4th, 5th, 6th...). Multi-step process
that's currently tribal knowledge — this is the fix for that.

Source: `Docs/AUDIT-2026-08.md` P1-12 — "No new-store onboarding playbook / runbook."

Related work not yet shipped that affects this flow, called out inline where relevant:
- **P1-11** (Isola-specific hardcodes) — still open. See the gotcha in section 2 and section 11.
- **P1-10** (`STOREFRONT_URL` is a single global env var, not per-store) — still open. See section 4.
- **P1-13** (daily cron scans all stores sequentially in one 60s function) — still open. See section 10.

---

## 1. Pre-flight checklist

Gather these before touching the DB:

- [ ] **Shopify domain** — confirm it's `{handle}.myshopify.com`, not a custom domain. Titan's
      `createShopifyClient()` (`lib/shopify-admin.js`) builds every Admin API URL from `stores.shopify_url`
      directly — a custom domain there breaks every Admin API call. See CLAUDE.md Don't Rule #8.
- [ ] **Shopify Admin API access token** — create a custom app in the store's Shopify Admin
      (Settings → Apps and sales channels → Develop apps → Create an app → Configure Admin API scopes).
      Minimum scopes actually exercised by the code: `read_products`, `write_products` (updates, variants,
      images, metafields, status), `read_orders` (Profit/Shopify analytics), plus webhook read/write
      (bundled with `write_products` in Shopify's scope model). `read_customers` is **not required** —
      `getCustomerCount()` (`lib/shopify-admin.js:207`) is called `.catch(() => 0)` in
      `api/shopify/overview.js:58`, so a token without it degrades gracefully to a `0` customer count
      instead of failing. If the bulk publish/unpublish feature (`publications.js`) errors with a
      permission-denied on `publishablePublish`/`publishableUnpublish`, add `write_publications` — not
      confirmed required by current stores, flag if you hit it.
- [ ] **Shopify Storefront API access token** — same custom app, enable Storefront API access. Not
      currently read anywhere in the backend (no `storefront_token` usage found outside the `stores`
      column itself) — stored for future use / parity with the schema. Get it anyway, cheap now vs. a
      re-visit to the Shopify admin later.
- [ ] **Shopify client_secret** — same custom app's API credentials page. Required for webhook HMAC
      verification (section 5) — without it, `api/webhooks/shopify.js` can't verify incoming webhooks
      for this store and requests from it are rejected.
- [ ] **Store slug** — URL-safe, lowercase, unique (e.g. `swanswaywear`). Used as: the `stores.slug`
      column, the frontend `localStorage['active_store']` value (`apps/dashboard/src/hooks/useActiveStore.jsx`),
      and (preferentially — `store.slug || store.name`) the Storage folder name in `lib/actions/avatars.js`
      and `lib/actions/reviews-photo.js`. **Caveat:** `lib/actions/docs.js` and `lib/actions/custom-styles.js`
      still use `store.name` (not `.slug`) for Storage paths — inconsistent, tracked as a known gap (audit
      P2 "Custom styles Storage path uses store.name instead of store.slug"). Don't "fix" this silently while
      onboarding a store; it's a separate, cross-cutting change.
- [ ] **Store display name** — human-readable, goes in `stores.name`, shown in the store switcher and
      in generated brand-context prompts as a fallback (`BRAND: ${brandName}`).
- [ ] **Currency** — `EUR`, `USD`, whatever the store actually charges in. No CHECK constraint on the
      column (plain `TEXT DEFAULT 'EUR'`), but `lib/actions/profit.js` and the frontend just display
      whatever string is there — use a real ISO code.
- [ ] **Storefront domain(s) that will submit public reviews** — the custom domain the storefront
      actually runs on (e.g. `https://swanswaywear.com`) **and** the `.myshopify.com` fallback, comma-
      separated. Needed for section 4 (CORS). Get this even if reviews aren't launching day one — it's
      needed the moment the review widget goes live on that storefront, and it's a manual step easy to
      forget under section 4.

---

## 2. Insert the `stores` row

Current `stores` schema (base: `sql/add-stores.sql`; extended by `sql/add-oauth-columns.sql`,
`sql/add-publications-manager.sql`):

```sql
INSERT INTO stores (
  name, slug, shopify_url, shopify_handle,
  storefront_token, admin_token, client_id, client_secret,
  currency, brand_config, is_active
) VALUES (
  'Swans Way',                          -- display name
  'swansway',                           -- slug — url-safe, lowercase, unique
  'swans-way-store.myshopify.com',      -- MUST be {handle}.myshopify.com, never a custom domain
  'swans-way-store',                    -- shopify_handle — used by export CSV Admin-URL builder
                                         -- (lib/actions/exports.js), falls back to shopify_url
                                         -- subdomain if omitted, but set it explicitly
  'shpat_xxx_storefront',               -- storefront API token (see section 1)
  'shpat_xxx_admin',                    -- admin API token — leave NULL for a read-only store, see section 3
  NULL,                                 -- client_id — only used by the OAuth install flow, not the
                                         -- custom-app path most stores use; leave NULL unless doing OAuth
  'shpss_xxx_client_secret',            -- REQUIRED for webhook HMAC verification (section 5)
  'USD',
  '{}'::jsonb,                          -- brand_config — see template below, fill in before first
                                         -- branded-content generation
  true
)
ON CONFLICT (slug) DO NOTHING;
```

**`slug` must match what the frontend uses.** `useActiveStore.jsx`'s `StoreProvider` persists the
active store as `localStorage['active_store'] = store.slug` and matches it back against `stores_list`
on load — get the slug right the first time, changing it later silently breaks anyone's saved
selection until they re-pick a store.

**The frontend requires NO code change for a new store.** `stores_list` (`lib/actions/stores.js`)
reads `getAllStores()` (`is_active=true`, ordered by name) and the store switcher / `StoreProvider`
render whatever comes back. This is confirmed working today — Eleganz Haus (the 3rd store) required no
frontend changes to appear. The exceptions that DO need code or manual follow-up are listed in section 11.

### `brand_config` JSONB — template

```json
{
  "brand_voice": "BRAND: Swans Way — minimalist swimwear for women 25-45. Monochrome palette, clean studio or coastal settings, understated confidence. Model: natural, unretouched-looking, size 6-14.",
  "brand_prompt": "Same or a shorter variant used as the product-optimizer system-prompt context (lib/actions/products.js:156, auto_optimize on import). Optional — falls back to '' if unset.",
  "logo_white": "https://.../logo-white.png",
  "payment_fees": { "shopify_payments": 0.029, "paypal": 0.034, "default": 0.035 },
  "transaction_fee_pct": 0.035
}
```

Keys actually read by the code today (grep-verified, `lib/actions/creatives.js:54-62`,
`lib/actions/products.js:156`, `lib/actions/profit.js:72-74`):
- `brand_voice` — branded-content generation (`generate_branded` action) uses this as the
  `BRAND_CONTEXTS[store.slug] || brandConfig.brand_voice || 'BRAND: ${brandName}'` fallback chain.
  Isola and Elegance House have hand-written entries baked into `BRAND_CONTEXTS` in
  `lib/actions/creatives.js`; every other store (including Eleganz Haus today) runs on `brand_voice`.
  **Write a real one** — the bare `BRAND: ${brandName}` fallback with no `brand_voice` set produces
  generic, undirected creative.
- `brand_prompt` — optional system-prompt context for the product optimizer on auto-optimize-on-import.
- `logo_white` — optional, appended to the branded-content prompt if present.
- `payment_fees` (object, keyed by Shopify gateway name from `order.payment_gateway_names[]`) and/or
  `transaction_fee_pct` (flat rate) — P&L transaction-fee calculation in `profit_summary`. Without
  either, defaults to a flat 3.5%.

**There is no `features.high_waist_navel_hide` (or similar) key today.** P1-11 (Isola-specific
hardcodes) has not landed as of this runbook. The "high-waist navel-hide" prompt block in
`api/creatives/generate.js` currently triggers on `(isIsola || isHighWaistTummy-title-regex) &&
swimwear-product`, where `isIsola` is a hardcoded `store.name.toLowerCase().includes('isola')` check —
not a `brand_config` flag. A new swimwear store gets the navel-hide behavior automatically **only if**
its product titles match the regex (`tummy.?control|high.?wais?t|high.?rise|...` —
`api/creatives/generate.js`, search `isHighWaistTummy`), not by any config toggle. If this matters for
the new store and titles don't match the pattern, that's a code change (P1-11 territory), not a config
step — don't try to work around it with a fake `brand_config` key that nothing reads.

---

## 3. Set the admin token (if this store needs admin operations)

If you already set `admin_token` in the `INSERT` above, skip this — this section is for read-only →
admin upgrades, or if you deliberately left it NULL initially.

```sql
UPDATE stores SET admin_token = 'shpat_xxx' WHERE slug = 'swansway';
```

**Read-only stores are a real, supported case** — Elegance House ("Elegance House Shopify app disabled"
per project memory) is currently read-only in practice. `lib/store-context.js`'s `hasAdminAccess(store)`
returns `!!(store.has_admin || store.admin_token)`. Without `admin_token`:
- Product editing, publications (bulk list/unlist), webhook registration, and Shopify writes are all
  blocked at the action level (`if (!store?.admin_token) return res.status(400)...` — same pattern
  across `webhooks.js`, `publications.js`, `profit.js`).
- `stores_list` strips `admin_token` from the API response and returns `has_admin: boolean` instead —
  the frontend uses that flag to hide admin-only UI (e.g. Products tab publications controls) without
  ever seeing the token.
- Read paths (product sync, KPIs, analytics) still work with no `admin_token` at all in some cases, but
  most meaningfully useful flows (sync, webhooks, publications, reviews push) require it. If the intent
  is "just track this store, don't manage it," that's a valid end state — don't force an admin token
  onto a store that shouldn't have write access.

---

## 4. CORS — add the storefront domain to `STOREFRONT_URL`

`STOREFRONT_URL` is a **single global comma-separated env var** shared by all stores' public review
actions (`submit_review_public`, `vote_review_helpful`, `review_helpful_counts` — `api/system.js:130`).
This is the P1-10 gap (per-store column would be cleaner, not built yet) — for now it's manual, and it's
additive: you're appending to the existing list, not replacing it.

```bash
# 1. See the current value first — don't guess what's already there.
vercel env pull .env.vercel.tmp --environment production
grep STOREFRONT_URL .env.vercel.tmp
# e.g. STOREFRONT_URL="https://isolaswim.com,https://swimwear-brand.myshopify.com"
rm .env.vercel.tmp

# 2. Remove the old value (Vercel CLI has no "append" — full replace only).
vercel env rm STOREFRONT_URL production --yes

# 3. Re-add with the new domain(s) appended — keep every existing origin.
printf 'https://isolaswim.com,https://swimwear-brand.myshopify.com,https://swansway.com,https://swans-way-store.myshopify.com' | vercel env add STOREFRONT_URL production

# 4. Redeploy for the env change to take effect (Vercel doesn't hot-reload env vars on already-deployed functions).
vercel --prod
```

**This is REQUIRED before the public review widget goes live on the new store's storefront.** If
skipped, `submit_review_public` gets silently CORS-blocked in the visitor's browser — the request never
even reaches the rate limiter or the DB, so `pipeline_log` shows nothing and it looks like the widget is
just "not working" with zero server-side signal. Include both the custom domain and the
`.myshopify.com` fallback — whichever one the storefront's JS actually calls from should be covered, and
having both costs nothing.

If the fallback hardcoded in `api/system.js` (`'https://isolaswim.com,https://swimwear-brand.myshopify.com'`,
used only when `STOREFRONT_URL` is completely unset) ever needs updating for a stores test/dev
environment, that's a code change, not an env change — don't rely on it in production.

---

## 5. Register Shopify webhooks

Dashboard → Shopify tab → **Webhooks — auto-sync on Shopify changes** panel
(`apps/dashboard/src/components/ShopifyServices.jsx`) → **Register** button. Or via API directly:

```bash
curl -X POST "https://<app-url>/api/system?action=register_webhooks" \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"store_id": "<new-store-uuid>"}'
```

Requires: admin caller (`req.user.role === 'admin'`, `register_webhooks`/`unregister_webhooks` are
**admin-only**, not just `products:edit`) and the store must already have `admin_token` set (section 3).

Registers exactly 3 topics — `products/create`, `products/update`, `products/delete` — at
`${APP_URL}/api/webhooks/shopify` (`lib/actions/webhooks.js`), idempotent (skips topics already pointing
at our endpoint). Verify:

```bash
curl "https://<app-url>/api/system?action=list_webhooks&store_id=<new-store-uuid>" \
  -H "Authorization: Bearer <session-token>"
# ours_count should be 3
```

The receiver is `api/webhooks/shopify.js` — signs against **the new store's `client_secret`** (routed by
`X-Shopify-Shop-Domain` header → DB lookup), so if `client_secret` was left blank in section 2, every
webhook from this store fails HMAC verification silently (no user-facing error, just a rejected request
— check `pipeline_log` if webhooks seem registered but nothing's syncing).

---

## 6. Run first product sync

Dashboard → Products tab → **Sync Shopify** button (`apps/dashboard/src/pages/Products.jsx`, or the
empty-state "Sync Shopify →" CTA on a store with zero products).

This runs `sync_products` (`lib/actions/sync.js`): fetches collections (REST) → maps products to
collections (GraphQL, paginated) → fetches all products (REST, `since_id` pagination) → upserts each via
`upsertProductFromShopify()` → sets `tags` = collection titles → archives anything no longer in Shopify.

- [ ] Products appear in the Products grid after sync completes.
- [ ] Check `pipeline_log` (Cockpit tab → TerminalLog, or `pipeline_log` table filtered
      `store_id = <new-store-uuid>`) for per-product errors. As of the P0-4 fix
      (`sql/fix-products-composite-unique.sql`, live), `products.handle`/`shopify_id` uniqueness is
      scoped per-store, so a generic handle colliding with another store's product (e.g. two stores both
      importing a `black-dress` product) no longer silently fails the whole sync — but still watch
      `pipeline_log` for the `IMPORTER`/`OPTIMIZER` agent entries to confirm a clean run.

---

## 7. Grant user access

Settings tab (admin-only) → Users → edit the target user → **Store access** fieldset
(`StoreAccessCheckboxes.jsx`) → check the new store → Save. Or via API:

```bash
curl -X POST "https://<app-url>/api/system?action=update_user" \
  -H "Authorization: Bearer <admin-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "<user-uuid>", "store_access": ["<existing-store-uuid-1>", "<existing-store-uuid-2>", "<new-store-uuid>"]}'
```

`store_access` is a **full replace**, not an append — include every store the user should keep access
to, not just the new one, or you'll silently revoke the others.

- **Admins bypass this entirely** — `hasStoreAccess()` (`lib/permissions.js`) returns `true`
  unconditionally for `role='admin'`, regardless of `store_access` contents.
- **Non-admin members need the explicit grant.** Without it, `hasStoreAccess()` returns `false` and
  every `lib/actions/*` call for this store 403s for that user, and the store won't appear in their
  store switcher (`stores_list` filters to `user.store_access` for non-admins).
- **Also consider `finance:read`** (P0-5, `lib/permissions.js` `PERMISSION_LIST`) — a user with
  `products:read` but not `finance:read` cannot see the Profit tab, the Shopify analytics tab, or
  Cockpit's revenue/margin KPI cards for ANY store, including the new one. `finance:read` is a
  permission (global to the user, not per-store) — granting store access to the new store doesn't imply
  financial visibility into it. If this user should see the new store's P&L, grant `finance:read`
  explicitly (not auto-granted anywhere per the P0-5 migration note in `sql/add-finance-read-permission.sql`).

---

## 8. Test-run creative generation (optional but recommended)

Pick 1 product on the new store → Products tab → open it → **Studio →** (or Studio tab → select the
product) → `CreativeStudio` → pick a style (e.g. `product_catalog` / Product Catalog) → **Generate**.

Confirms in one shot: `FAL_KEY` is valid, the new store's `admin_token` can pull product images, and
(if using a persona avatar) `persona_avatars` reference lookup works. Fire-and-forget — creative row
lands as `generating`, poll via `poll_generations` (automatic on next Cockpit/cron tick, or manually
trigger a refresh) to see it resolve to `pending` for review.

---

## 9. Documentation updates

- [ ] **CLAUDE.md** — "Multi-Store Architecture" section: add the new store to the 3-store list (name,
      market/segment, currency), and to the currency note in Coding Style & Conventions
      (`Currency: per-store (stores.currency) — EUR for Elegance House / Eleganz Haus, USD for Isola`).
      Also bump the "Supports 3 stores" line in Project Overview.
- [ ] **`Docs/Stores/`** — there is **no `Docs/Stores/{slug}.md` file convention today** (checked:
      existing entries are folders — `Docs/Stores/Isola/`, `Docs/Stores/Elegance House/`,
      `Docs/Stores/Eleganz Haus/` — holding raw creative-brief source material: `Brand/`, `Audience/`,
      `Ads/`, `Creative/`, `Logos/`, `Products/{persona}/`, and an `Inbox/` for docs not yet processed
      into `store_knowledge`). If the new store has brand research / creative briefs, create
      `Docs/Stores/{Store Name}/` with the same subfolder pattern and drop the source docs in — the
      in-app **Docs** browser (`BrandKnowledge.jsx`/`DocsBrowser.jsx`, `lib/doc-processor.js`) ingests
      uploaded `.docx`/etc. into `store_knowledge` separately via the dashboard's own doc upload, not by
      reading this filesystem folder directly. Treat `Docs/Stores/` as human/source-material storage, not
      a live data path.

---

## 10. Post-launch monitoring

- [ ] **First 24h** — watch `pipeline_log` for repeated errors on the new store's `store_id` (Cockpit →
      TerminalLog, or filter the table directly). Structured logging convention:
      `console.error('[Module] Description:', { context })` — errors carry enough context to trace.
- [ ] **Cron blast radius** — `api/cron/detect-events.js` (daily, `0 8 * * *`) iterates `for (const store
      of stores)` **sequentially**, one Shopify API call chain per store, inside a single 60s Vercel
      function. This is the P1-13 gap: one store with a slow/rate-limited Shopify API response delays or
      starves every store scanned after it in the loop. Not yet fixed. If the new store's event detection
      silently stops running or times out, this is the first thing to check — it may not be specific to
      the new store at all.
- [ ] **Profit tab** shows the new store's revenue correctly, scoped only to it — `profit_summary`
      (P0-3, already live) filters by `store_id` throughout (`products`, `performance`, `manual_adspend`
      queries all `.eq('store_id', storeId)` when a store is selected). Spot-check a known order total
      against the Shopify admin directly.

---

## 11. Common gotchas

- **Custom Shopify domains vs `{handle}.myshopify.com`** — CLAUDE.md Don't Rule #8. Every Admin API call
  goes through `createShopifyClient(store.shopify_url, ...)` which builds
  `https://${storeUrl}/admin/api/${API_VERSION}/...` directly from `stores.shopify_url` — a custom
  domain (e.g. `shop.swansway.com`) there returns errors or wrong data, not an obvious failure.
- **Webhook HMAC is base64, not hex.** `api/webhooks/shopify.js` verifies with `digest('base64')`
  against the raw request body. This is a **different convention** from the Shopify OAuth callback
  (`api/auth/shopify.js`), which uses hex. If you're a 3rd-party integrator or writing anything that
  calls into the webhook receiver directly, don't copy the OAuth HMAC code path — they compute
  differently and neither works for the other's endpoint.
- **`finance:read` is separate from `products:read`.** A non-admin user with product/image permissions
  but no `finance:read` sees the Products tab fine and gets a blank/gated Profit + Shopify + Cockpit
  financial view for every store they otherwise have access to, including a brand-new one. This is
  intentional (P0-5) — don't treat it as a bug when a freshly-granted store doesn't show P&L for a user
  who only has `products:read`.
- **`brand_config.brand_voice` unset ≠ error, just generic output.** There's no validation forcing you
  to fill in `brand_config` before a store goes live — branded-content generation will run with the bare
  `BRAND: ${brandName}` fallback and produce noticeably generic creative. Fill in `brand_voice` before
  anyone actually uses Studio on the new store, not after someone complains about quality.
- **`online_store_publication_id` is NOT set by the `INSERT` in section 2.** It's a Shopify GraphQL GID,
  looked up once via `getOnlineStorePublicationId()` (`lib/shopify-publications.js`) and cached on the
  row. Bulk publish/unpublish (`lib/actions/publications.js`, Products tab bulk actions) hard-fails with
  `"Store missing online_store_publication_id"` until it's populated. Run once after the store has an
  `admin_token`:
  ```bash
  node scripts/backfill-publication-ids.mjs
  ```
  Idempotent across all stores — safe to re-run any time, it skips stores that already have the ID set.
- **Reviews via the Amazon/Judge.me userscript need a 3rd-layer registration**, not just a `stores` row —
  only relevant if this store will use `scripts/titan-amazon-userscript.user.js` for review import. A
  new *source* (not just a new store using an existing source like `amazon`) needs all 3: the userscript
  `SCRAPERS` registry entry, `ALLOWED_SOURCES` in `lib/actions/reviews-amazon.js`, and a DB CHECK
  migration (`sql/add-review-<source>-source.sql`). A new store scraping an *already-supported* source
  (Amazon, Temu, Cupshe, or a Judge.me-powered competitor) needs none of that — just the store's own
  product data to scrape against.

---

## Related runbooks

- **`Docs/RUNBOOK-backup-restore.md`** — read before any destructive operation on the shared Supabase
  DB. Nothing in this runbook is destructive (all `INSERT`/`UPDATE` on `stores`, additive `STOREFRONT_URL`
  changes), but if something goes wrong mid-onboarding and you're tempted to hand-fix data, `pg_dump`
  first per that runbook's section 3/7.
- **`Docs/RUNBOOK-reviews-abuse.md`** — once the new store's public review widget is live (section 4),
  it inherits the same **shared, cross-store** rate limits (submit `5/hr`/IP + `200/hr` global, vote
  caps) as every other store. If the new store gets abuse traffic, see that runbook for moderation and
  be aware a flood on the new store can exhaust the global budget for existing stores too (documented
  trade-off, not a bug specific to onboarding).

---

## Quick reference

| Step | Action |
|---|---|
| 1 | Gather Shopify domain, admin token, storefront token, client_secret, slug, name, currency |
| 2 | `INSERT INTO stores (...)` — section 2 SQL, fill `brand_config.brand_voice` |
| 3 | `UPDATE stores SET admin_token = ...` (skip for read-only stores) |
| 4 | `vercel env rm/add STOREFRONT_URL production` + `vercel --prod` — REQUIRED before public reviews go live |
| 5 | Shopify tab → Register webhooks, verify `ours_count === 3` |
| 6 | Products tab → Sync Shopify, check `pipeline_log` for errors |
| 7 | Settings → Users → grant `store_access` (+ `finance:read` if needed) — full replace, not append |
| 8 | Studio → generate 1 test creative, confirms fal.ai + admin_token wired |
| 9 | Update CLAUDE.md store list + currency notes; add `Docs/Stores/{Name}/` if creative briefs exist |
| 10 | Watch `pipeline_log` 24h; know P1-13 cron sequential-scan risk; verify Profit tab is store-scoped |
| — | `node scripts/backfill-publication-ids.mjs` before using bulk publish/unpublish |

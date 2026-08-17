# CLAUDE.md — Titan Commerce Limited

> **Rule:** After every major change (new file, new screen/component, dependency add/remove, architecture change, new pattern, app flow change) **update this CLAUDE.md** to reflect the current project state. Specifically check and update: Key Files table, Key Dependencies, Important Patterns, App Structure, App Flow, Database Schema, and Known Tech Debt. Do this automatically at the end of implementation — don't wait for the user to ask.

---

## Developer Role

You ARE a senior fullstack developer on this project. Not an assistant — a developer.

### How you think
- Read and understand existing code before proposing changes
- Consider side effects, edge cases, and regressions before touching anything
- If unsure about the impact, say so — don't guess
- Propose before implementing: explain WHAT you want to change, WHY, and what COULD break
- Self-review: before presenting code, review it as if someone else wrote it

### How you code
- Follow existing patterns in the codebase — don't introduce new conventions without discussion
- Smallest possible change that solves the problem
- No gold-plating: don't refactor, add tests, or improve code you weren't asked to touch
- If you spot a bug or tech debt outside your task, mention it — don't fix it silently
- Every change must be reversible or explicitly flagged as destructive

### How you communicate
- Be direct: "This will break X" not "This might potentially cause issues"
- When you disagree with a request, say so with reasoning — then do what's asked if overruled
- No fluff: skip "Great question!" and "Let me help you with that"
- Estimate confidence: "I'm 90% sure this is correct" vs "I think this might work"

### Architecture decisions
- Propose trade-offs, not single solutions: "Option A is faster but harder to maintain, Option B is..."
- Default to simplicity — add complexity only when the problem demands it
- Respect existing architecture: understand WHY something was built that way before suggesting changes
- No premature abstractions, no speculative features

---

## Skills Policy

Skills in `.claude/skills/` are product-knowledge mentors — they advise, you decide.

### Rules
- Skills are READ-ONLY consultants: they analyze and recommend, never auto-implement
- One skill per consultation — don't combine multiple skills in one task
- Skill output = recommendation that requires explicit user approval before any code changes
- Skills must reference specific files and line numbers, not generic advice
- If a skill contradicts this project's CLAUDE.md rules, CLAUDE.md wins
- Skills never modify: auth flows, database schemas, payment logic, API contracts, or multi-store architecture without explicit approval

### How to use
- User asks: "What would the Isola brand skill say about our beach creatives?"
- Claude consults the skill, presents findings as a structured report
- User approves specific items → Claude implements only those

> Note: there is also a wider personal skill library (`~/Desktop/Projects/Skills/Usable Skills/01-Titan-Commerce/`) with engineering/marketing skills (senior-frontend, senior-fullstack, ui-design-system, ads-multi-platform, page-cro, database-designer, etc.). The Nextbyte design system skill lives at `skills/nextbyte-design/`.

---

## Project Overview

**Titan Commerce Limited** — multi-store SaaS dashboard for e-commerce ad creative management. Generates AI ad creatives (image + video), optimizes product listings with AI, tracks Shopify analytics and profit, manages branded content + persona avatars, and integrates with Meta Ads. Supports **3 stores** (Elegance House, Isola, Eleganz Haus) with full store isolation via `store_id` FK on all data tables.

---

## Architecture

- **Framework:** React 19 + Vite (frontend dashboard, in `apps/dashboard/`)
- **Deployment:** Vercel Serverless Functions (API layer, Hobby plan — 12 route max, 1 cron)
- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **AI — Images/Video (primary):** fal.ai — Nano Banana 2 / Nano Banana Pro for images (`/edit` variants, fire-and-forget polling), plus FLUX.2 edit, FLUX Kontext, Ideogram v3. **`resolution: "2K"` is the fallback for Nano Banana** when `resolution` is unset or invalid (fal.ai's own default is 1K — too soft for product photos); an explicit `"1K"` or other valid value passes through unchanged.
- **AI — Images/Video (fallback / legacy):** Higgsfield — Soul / Soul Reference (`/v1/text2image/soul`) for text-to-image, Flux Kontext Max, DOP Turbo (`dop-turbo`) for video. Used when fal.ai isn't a fit (e.g. no reference image → HF Flux Kontext Max).
- **AI — Text:** Anthropic Claude API (`claude-sonnet-4-20250514`) for product optimization, product-skill auto-generation, Claude Vision (size chart parsing, style analysis)
- **E-commerce:** Shopify Admin API (REST v2024-01 + some GraphQL Admin v2024-01) — MUST use `{handle}.myshopify.com` URLs (not custom domains)
- **Ads:** Meta Marketing API (v21.0) — read-only, awaiting credentials
- **Amazon reviews scraping:** TC scraper VPS (Hetzner `37.27.189.60`, ex-Yomi box repurposed 2026-07-29) — standalone Docker/Express/Puppeteer service, NOT in this repo (`/root/titan-scraper/`), bearer-token auth. Titan calls it from `lib/actions/reviews-amazon.js`. **Alethe VPS `147.93.56.72` is a different box — never touch it for Titan work.**
- **Auth:** Per-user login (username+password) with `crypto.scrypt` password hashing; `APP_PASSWORD` retained as master fallback backdoor. `withAuth()` middleware on all endpoints. See users table + RBAC below.
- **Design:** Nextbyte Dark Luxe — Michroma (gradient headings), Plus Jakarta Sans (body), Space Mono (data). Light/dark theme toggle (`data-theme` attr on `<html>`, persisted in localStorage `titan-theme`).

---

## Multi-Store Architecture

3 stores in `stores` table, each with own Shopify credentials:
- **Elegance House** (women's fashion, EU, EUR)
- **Isola** (tummy-control swimwear, US, USD)
- **Eleganz Haus** (fashion, DE, EUR)

Key patterns:
- `store_id` FK on: `products`, `creatives`, `events`, `proposals`, `product_optimizations`, `pipeline_log`, `store_skills`, `store_knowledge`, `persona_avatars`, `manual_adspend`
- `lib/store-context.js` — `getStore(id)`, `getAllStores()`, `hasAdminAccess(store)`
- `useActiveStore` hook + `StoreProvider` context with localStorage persistence
- Store switcher dropdown in App.jsx header (shown only when >1 store)
- Shopify Admin features only available for stores with `admin_token`
- `stores_list` API strips `admin_token`, returns `has_admin` boolean instead

---

## Language Rules

- **UI text:** English
- **Code, comments, variable names:** English
- **Docs/Briefs/, Docs/Sprints/:** Czech (team language)
- **This file:** English

---

## Coding Style & Conventions

### General
- Vercel serverless: `export default handler`, max 60s timeout (use 55s safe limit). Long ops are fire-and-forget (submit job → poll later via `poll_generations`).
- Supabase server-side: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`
- Frontend API: all calls through `apps/dashboard/src/lib/api.js` (`fetchJSON` wrapper with auth token)
- `npm install` always with `--legacy-peer-deps` (Higgsfield peer dep conflict)
- Currency: per-store (`stores.currency`) — EUR for Elegance House / Eleganz Haus, USD for Isola

### Frontend (React 19)
- Functional components only, hooks order: `useState → useRef → useEffect → custom → callbacks → render`
- CSS: per-component `.css` file next to the `.jsx`, dark/light theme via CSS variables, Nextbyte Dark Luxe design system
- No chart libraries — pure CSS bars for charts
- HTML in descriptions: sanitize with DOMPurify before rendering
- Toast notifications via `useToast()` hook for all user-facing feedback
- Skeleton loaders (`Skeleton.jsx`) for loading states — no "Loading..." text
- Code splitting: `React.lazy` + `Suspense` for all page components (and some heavy components like `ProductDetail`)
- Icons: `lucide-react`

### Backend
- Error handling: `try/catch` everywhere, structured logging: `console.error('[Module] Description:', { context })`
- `catch (e) {}` is **FORBIDDEN** — always log or re-throw
- Pipeline activity → `pipeline_log` table (agent, message, level, metadata). Agent names in use: `OPTIMIZER`, `IMPORTER`, `PRICING`, `CLEANUP`, `AUTH`, `AUTH_ADMIN`, `MASTER`, `SKILL_GEN`, `STYLE_GEN`, `SCRAPER`, `AMAZON_SCRAPER`, `FORGE`, `PUBLISHER`, `LOOPER`, `AVATAR`, `EDITOR`, `SIZE_CHART`, `DOC_PROCESSOR`, `REVIEWS`, `AGENT` (proposals). All 20 values enforced by `pipeline_log_agent_check` (fixed 2026-08-17 via `sql/fix-pipeline-log-agent-check.sql` — P0-7 from AUDIT-2026-08).
- **Audit trail (P1-16, AUDIT-2026-08, fixed 2026-08-17):** every `pipeline_log` insert also records `initiator` (`'user'` / `'system'` / `'webhook'` / `'cron'`, CHECK-constrained) and `user_id` (UUID FK to `users.id`, nullable). `initiator: 'user'` covers every dashboard-triggered action (`lib/actions/*.js` dispatched via `api/system.js`, plus the standalone routes `api/creatives/*.js` / `api/ads/action.js` / `api/auth/login.js` / `api/auth/shopify.js`) — `user_id` is `req.user?.user_id || null` (`null` for the master-password fallback token, which has no backing `users` row, and for the unauthenticated `submit_review_public`/OAuth-connect flows, which have no session to attribute to). `initiator: 'cron'` is `api/cron/detect-events.js`'s single aggregated scan-summary log (`user_id: null` — cron auth is `CRON_SECRET`, not a session). `initiator: 'webhook'` is `api/webhooks/shopify.js`'s per-webhook log (`user_id: null` — Shopify calls this, not a person). No central `logPipeline()` helper exists — each of the ~73 call sites does its own `supabase.from('pipeline_log').insert({...})`, so attribution was added additively at every site rather than via one signature change. Pre-migration rows keep `user_id`/`initiator` `NULL` (history not reconstructed). Check when auditing who did what. Migration: `sql/add-pipeline-log-user-attribution.sql`. Test: `tests/pipeline-log-attribution.test.js` (one case per initiator category, driven through the real handler).
- Shopify writes: always log to pipeline_log before and after
- Rate limiting via `lib/rate-limit.js` (Supabase-backed, async): generate 20/hr, video 10/hr, optimize 30/hr, import_reviews_csv 20/hr, generate_reviews 20/hr, public `review_submit:{ip}` 5/hr + `review_submit_global` 200/hr, `helpful_vote:{ip}` 30/hr + `helpful_vote_global` 500/hr + `helpful_one:{ip}:{review_id}` 1/24h (per-review dedup)
- Vercel 12-route limit: consolidated endpoints in `api/system.js` thin router (~156 lines) → 73 actions across 24 files in `lib/actions/`, dispatched by `?action=X` (GET) or `{ action }` body (POST). Errors are sanitized (strip API keys, DB strings) before returning to the client.
- Error monitoring (P1-21, AUDIT-2026-08): `lib/sentry.js` wraps `@sentry/node`, fail-open no-op unless `SENTRY_DSN` is set. `api/system.js`'s catch-all, `api/cron/detect-events.js`'s catch-all, and `api/webhooks/shopify.js`'s handler-error catch all call `captureException(err, { tags: {...} })` alongside the existing `console.error`. See `Docs/RUNBOOK-monitoring.md`.

---

## Don't Rules

1. **Don't push to Shopify without approval** — Product Optimizer saves to DB as `pending`, only `approve_optimization` writes to Shopify. (Product *import* and the inline Product Editor write directly — different flows.)
2. **Don't install new dependencies** without asking first (approved exceptions: frontend `xlsx`/SheetJS for parsing review imports in-browser — keeps the backend dependency-free)
3. **Don't use chart libraries** — CSS bars for all charts
4. **Don't hardcode store-specific data** — all store data from `stores` table, brand voice from `store_skills`
5. **Don't make files longer than ~300 lines** — extract hooks, utils, sub-components (several files already exceed this; flag, don't silently fix)
6. **Don't swallow errors** — `catch (e) {}` is forbidden
7. **Don't use `npm install` without `--legacy-peer-deps`**
8. **Don't use custom Shopify domains** — always `{handle}.myshopify.com` for Admin API
9. **Don't touch `lib/higgsfield.js` prompt logic** beyond surgical additions — the existing `STYLE_PROMPTS` and `cs_`-prefix handling are fragile
10. **Don't modify the Product Catalog / Realistic Beach prompt blocks in `api/creatives/generate.js` casually** — they were churned heavily; changes there directly affect creative quality. Understand the git history first.

---

## App Structure

### Tabs: Cockpit | Shopify | Studio | Avatars | Products | Profit

| Tab | Page | Purpose |
|-----|------|---------|
| Cockpit | `Cockpit.jsx` | Command center: KPI cards, pipeline bars, proposal queue (events → approve/dismiss/approve all + Scan Now), TerminalLog (pipeline activity) |
| Shopify | `Shopify.jsx` | ShopifyDashboard (KPIs, revenue chart, top products, traffic, orders) + inline Pricing (bulk price editor) |
| Studio | `Studio.jsx` | Branded content + product creatives via `CreativeStudio` component (style picker, model, pose, framing, count) + collapsible **Bulk Generate** panel (multi-product) + `CreativeDetailModal` review |
| Avatars | `Avatars.jsx` | Persona avatars: per-persona reference photos for model consistency. `AvatarBuilder` (generate / "From Photo" / custom builder), `AvatarDetail` (manage variants, set reference) |
| Products | `Products.jsx` → `ProductWorkspace.jsx` | Paginated product grid (50/page, load more, filters, sort, search, sync, import, 3 view modes) → per-product workspace (creatives by style via `CreativeStudio`, optimize via `OptimizePanel`, PhotoStory via `PhotoStoryModal`, size chart, full product detail + editor); bulk publications management (Make Unlisted / Make Listed) + CSV export |
| Profit | `Profit.jsx` | P&L dashboard: daily revenue/returns/COGS/shipping/per-gateway fees/adspend/profit, accuracy indicators, COGS management, manual adspend, CSV export, storage cleanup |

> `apps/dashboard/src/pages/Overview.jsx` is **dead code** (superseded by `Cockpit.jsx`) — safe to delete.

---

## Key Files

| File | Purpose |
|------|---------|
| **Pages** (`apps/dashboard/src/pages/`) | |
| `App.jsx` | Root — auth gate, StoreProvider, ToastProvider, 6-tab nav, store switcher, light/dark toggle, NotificationBell, cross-tab navigation, URL state (`?tab=X&product=Y`) |
| `Cockpit.jsx` | Command center: KPIs + pipeline + proposal queue + TerminalLog |
| `Shopify.jsx` | Shopify analytics dashboard + bulk pricing |
| `Studio.jsx` | Branded + product creative generation (`CreativeStudio`) + Bulk Generate |
| `Avatars.jsx` | Persona avatar management |
| `Products.jsx` | Paginated product grid with filters/sort/search/sync/import/view modes; loads full catalog when search or any filter is active |
| `ProductWorkspace.jsx` | Per-product workspace: creatives, generate image/video, optimize, photo story, size chart, product detail/editor |
| `Profit.jsx` | P&L dashboard with accuracy indicators + CSV export |
| `Login.jsx` | Password gate login screen. On `must_change_password:true` from the login response (P1-14), renders `ChangePasswordForm` (`forced`, prefilled `initialCurrentPassword`) instead of calling `onSuccess()` — blocks the dashboard until a temp password is changed. |
| `Settings.jsx` | Settings tab shell — visible to every logged-in user (P1-14). Always renders `ChangePasswordForm` (skipped for master, no backing `users` row); `UsersManager` (admin user table) is gated inside on `user?.role === 'admin'`. |
| **Components** (`apps/dashboard/src/components/`) | |
| `CreativeStudio.jsx` | Main creative generation UI — style picker (incl. `product-catalog`, v2–v8 variants, `realistic-beach`, `cs_*` custom), model picker (Nano Banana 2/Pro, FLUX.2, Ideogram, Kontext), pose/framing/model presets (catalog only), A/B mode, color variant, audience. v8 adds Fill intensity pill row (Light/Medium/Strong → backend `v8_fill_intensity`). ⚠️ large file. |
| `CreativeDetailModal.jsx` | Full-screen creative review: preview, edit, approve, reject, convert to video, push to Shopify |
| `CreativeEditor.jsx` | Inline creative review (preview, edit, approve, reject) |
| `GeneratePanel.jsx` | Older creative gen panel (image + video modes) — still used in some flows |
| `PhotoStoryModal.jsx` | Photo Story Studio — generates one of 3 multi-shot sets via `storyMode` toggle: BEACH (lifestyle, outdoor with `STORY_SHOTS`), STUDIO (clean white backdrop e-commerce angles with `STUDIO_SHOTS`), CELESTE (close-up studio with warm peach/cream backdrop, intimate apparel style with `CELESTE_SHOTS`). Prompts in `lib/photo-story-prompts.js` |
| `OptimizePanel.jsx` | Product optimizer: AI rewrite review + approve/reject/save draft |
| `ReviewsPanel.jsx` + `ReviewDetail.jsx` + `ImportReviews.jsx` + `GenerateReviews.jsx` | Product reviews manager modal (opened from ProductWorkspace topbar): summary header, reviews table (incl. photo thumbnail), editable detail panel (`ReviewDetail` — incl. photo upload + verified toggle). Phase 1 = manual add/edit/approve/reject/delete. Phase 3 = **Import** → `ImportReviews` (paste CSV, upload .csv/.xlsx parsed in-browser via `xlsx`/SheetJS, or Google Sheets link). Phase 4 = photo upload in `ReviewDetail` (FileReader → base64 → `upload_review_photo`) + **Generate (AI)** → `GenerateReviews` (count 3/5/10 + tone positive/mix → `generate_reviews_ai`). All inputs land as `pending`. `ImportReviews` + `GenerateReviews` are `React.lazy` (xlsx loads only on import). No Shopify push yet. |
| `ImportModal.jsx` | 4-step product import wizard (scrape URL → preview → import → done); collection URLs scrape multiple products |
| `SizeChartEditor.jsx` | Size chart: read/edit/import from image (Claude Vision) → Shopify metafield |
| `ProductDetail.jsx` | Full product detail + inline editor (all Shopify fields) — lazy-loaded |
| `VariantEditor.jsx` / `ImageManager.jsx` / `MetafieldEditor.jsx` / `TagInput.jsx` | Product editor sub-components |
| `AvatarBuilder.jsx` / `AvatarDetail.jsx` | Persona avatar create / manage |
| `StyleBuilder.jsx` | Custom Style Builder modal: drag & drop photos or scrape URL → Claude Vision → reusable `cs_` style |
| `BrandKnowledge.jsx` / `DocsBrowser.jsx` | View store skills / browse store docs |
| `ApprovalQueue.jsx` / `ProposalCard.jsx` | Pending creatives queue / event proposal cards |
| `ShopifyDashboard.jsx` / `ShopifyPanel.jsx` / `ShopifyServices.jsx` | Shopify analytics (full / compact / service-status grid) |
| `MetaPanel.jsx` | Meta Ads KPIs + campaigns (shows "not connected" placeholder) |
| `TerminalLog.jsx` | Pipeline activity log with smart date formatting. Shows an `initiator` + `user_email` suffix per line when present (P1-16, AUDIT-2026-08) — `user_email` comes from `pipeline_log`'s JOIN on the initial fetch; realtime-appended rows (raw Postgres `INSERT` payload, no JOIN) fall back to showing just the `initiator` label until the next full refetch. |
| `NotificationBell.jsx` | Notification dropdown — clickable, navigates to product |
| `Breadcrumbs.jsx` / `Skeleton.jsx` / `Tooltip.jsx` | Navigation breadcrumbs / skeleton loaders / info tooltip |
| **Hooks** (`apps/dashboard/src/hooks/`) | |
| `useActiveStore.jsx` | StoreContext + StoreProvider, localStorage persistence |
| `useToast.jsx` | Toast provider with success/error/info types |
| `useShopifyOverview.js` | Fetch Shopify analytics (60s client cache TTL) |
| `useProposals.js` | Fetch proposals (cached + Supabase Realtime) |
| `useInsights.js` | Fetch action-card / KPI data for Cockpit |
| `useMetaOverview.js` | Fetch Meta Ads data |
| `useProfit.js` | Fetch P&L data |
| **Frontend libs** (`apps/dashboard/src/lib/`) | |
| `api.js` | All API fetch functions, auth token handling, `getProducts()` (paginated), `getAllProducts()` (full list, up to 200) |
| `supabase.js` | Supabase client for realtime subscriptions |
| `photo-story-prompts.js` | Prompt templates for Photo Story Studio — exports `STORY_SHOTS` (beach lifestyle), `STUDIO_SHOTS` (clean white studio), `CELESTE_SHOTS` (close-up warm-backdrop intimate apparel style) + helpers |
| **Backend libs** (`lib/`) | |
| `claude.js` | Claude API wrapper — dynamic per-store brand system prompt from `store_skills` (fallback: generic + store name), `optimizeProduct()` |
| `higgsfield.js` | Higgsfield image/video generation + `buildStyledPrompt()` (built-in styles + `cs_` custom styles from `store_skills`) + per-store brand context + feedback learning. ⚠️ large file, fragile prompt logic. |
| `fal.js` | fal.ai image generation — `generateFal()`, `submitFalJob()` (fire-and-forget), `checkFalJob()` (poll). `buildFalBody()` per-model bodies; **`resolution: "2K"` is the fallback for Nano Banana** when `resolution` is unset/invalid — explicit `"1K"` passes through unchanged. |
| `shopify-admin.js` | Shopify Admin REST API: `createShopifyClient(url, token)` factory, read (orders, products, traffic, customers) + write (updateProduct, updateVariant, updateProductOptions, bulkUpdateVariantPrices) + `graphql()` for Publications mutations |
| `shopify-publications.js` | `getOnlineStorePublicationId(client)` — one-shot GraphQL lookup of the Online Store publication GID |
| `meta-api.js` | Meta Marketing API: read-only (insights, campaigns, active ads) |
| `supabase.js` | Supabase server-side client (service role) |
| `scraper-utils.js` | Product scraping + hook/headline generation |
| `store-context.js` | `getStore(id)`, `getAllStores()`, `hasAdminAccess(store)` |
| `auth.js` | Password-based HMAC token verification, `withAuth(handler)` wrapper, `PUBLIC_ACTIONS` allow-list (`submit_review_public`, `vote_review_helpful`, `review_helpful_counts`, `health`) |
| `sentry.js` | `initSentry()` / `captureException(err, context)` — thin `@sentry/node` wrapper, fail-open no-op unless `SENTRY_DSN` is set (P1-21, AUDIT-2026-08). Called from `api/system.js`, `api/cron/detect-events.js`, `api/webhooks/shopify.js`. |
| `rate-limit.js` | Supabase-backed async rate limiter (persists across Vercel cold starts, fails open) |
| `storefront-cors.js` | `getPerStoreOrigins(req, action)` (P1-10, AUDIT-2026-08) — resolves the CORS allow-list for `submit_review_public`/`vote_review_helpful`/`review_helpful_counts` from the target store's `stores.storefront_origins` row. Infers the target store from `shopify_product_id` (body for submit, query for counts) or `review_id` (body, for the vote action) — none of these actions accept `store_id` directly, so this keeps the storefront's existing request shape unchanged. Never throws: DB error, unresolved store (e.g. a CORS preflight `OPTIONS` request has no body), or an empty `storefront_origins` all fall back to the legacy global `STOREFRONT_URL` env var, `console.warn`'d. Small in-memory per-container cache (60s TTL) to avoid double-querying a preflight immediately followed by the real request. |
| `event-detector.js` | Shared event detection: `detectEventsForStore()` — used by cron + `scan_events` |
| `product-upsert.js` | Shared `upsertProductFromShopify()` — used by full sync + webhook handlers (webhook path does NOT touch `tags`) |
| `shopify-webhook-handlers.js` | `handleProductCreate/Update/Delete` — delete = soft archive |
| `doc-processor.js` | Store doc ingestion (mammoth for .docx, etc.) → `store_knowledge` |
| `validate.js` | Input validation: `requireFields()`, `requireQuery()` |
| `v3-beach-scenes.js` | `buildV3BeachPrompt(sceneKey)` — Ideogram BG prompts for v3 step 2 (sunny / golden / dune / cove) |
| `v4-prompt.js` | `V4_PROMPT_BODY` — editorial-strobe prompt for Product Catalog v4 (bright midday daylight, neutral color grading, frontal flat lighting) |
| `v5-prompt.js` | `V5_PROMPT_BODY` — editorial-strobe prompt for Product Catalog v5 (warm post-sunset afterglow, neutral subject for product pop) |
| `v6-prompt.js` | `V6_PROMPT_BODY` — editorial-strobe prompt for Product Catalog v6 (bright midday daylight + vivid turquoise ocean + bright blue sky) |
| `v7-prompt.js` | `V7_PROMPT_BODY` — editorial-strobe prompt for Product Catalog v7 (soft warm afterglow + balanced exposure + visible warm tones, natural look) |
| `v8-prompt.js` | Product Catalog v8 — color-class-conditional lighting variant of v7. Exports `V8_PROMPT_BODY_TEMPLATE` (body shell with `__V8_LIGHTING_BLOCK__` + `__V8_DO_NOT__` placeholders), 3 LIGHTING variants (`V8_LIGHTING_PRINT` verbatim from v7, `V8_LIGHTING_DARK`, `V8_LIGHTING_SOLID` — both functions taking `{fillPct, angleDeg}`), 3 DO NOT variants, `detectV8ColorClass(product, product_color)` (variant > title precedence, word-boundary regex on title fallback), `buildV8LightingBlock(class, intensity)`, `buildV8DoNotBlock(class)`, `V8_FILL_INTENSITY_MAP` (light/medium/strong → dark/solid percentages + angle). |
| `v9-prompt.js` | Product Catalog v9 — clean monolithic prompt rebuild of v1. Single exported constant `V9_PROMPT_BODY` (~7 KB) with the v7/v8 structure (WARDROBE / POSE / SETTING / LIGHTING / EXPOSURE / COMPOSITION & FRAMING / PHOTOGRAPHIC STYLE / CAMERA / COLOR GRADING / FACE QUALITY / QUALITY / DO NOT GENERATE). SETTING is bright sunny beach (blue sky, white clouds, warm sand) instead of v7's warm afterglow. COMPOSITION & FRAMING uses the 'ALWAYS / NEVER, MID-CALF ONLY' wording that gets Nano Banana to honor the 3/4-body crop on its own. EXPOSURE: subject 1 stop brighter than background (exposure separation, subject pops). No template placeholders, no helper functions — just one string. |
| `v10-prompt.js` | Product Catalog v10 — clone of v9 with v1's verbatim LIGHTING block + GARMENT-specific lighting paragraph swapped in. Same SETTING / EXPOSURE / COMPOSITION & FRAMING / COLOR GRADING / DO NOT GENERATE as v9. LIGHTING section replaced with v1's longer 'LIGHT ON THE MODEL AND GARMENT — FRONTAL SOFTBOX, EVEN COVERAGE TOP-TO-BOTTOM' block + dedicated THE GARMENT paragraph (fabric texture, ribbing/pleating, seams, black-fabric-not-crushed details). 'mid-thigh' references in the v1 wording changed to 'mid-calf' for consistency with v10's framing. |
| `avatar-crop.js` | `processCatalogImage(buf, framingKey)` — sharp-based crop + brightness lift, called from `poll_generations` for v1 only |
| **Action modules** (`lib/actions/`) — dispatched by `api/system.js` | |
| `health.js` | `health` — public unauthenticated `{ ok, ts, ver }` GET action, uptime-monitor ping target (P1-21, AUDIT-2026-08). In `PUBLIC_ACTIONS`, nested inside `system.js` instead of a new route to preserve the Vercel Hobby 12-route budget. |
| `stores.js` | `stores_list` (strips admin_token) |
| `pipeline.js` | `pipeline_log` (GET, admin or store-scoped) — JOINs `users(email, username)` on `user_id` (P1-16, AUDIT-2026-08) and flattens to a `user_email` field per row (email if set, else username, else `null`) so the dashboard can show who triggered each entry alongside `initiator`. |
| `analytics.js` | `kpi`, `meta_overview`, `insights` |
| `profit.js` | `profit_summary` (P&L with shipping, returns, per-gateway fees) |
| `proposals.js` | `proposals_list`, `approve/reject/approve_all_proposals`, `scan_events` |
| `optimizations.js` | `pending_optimizations`, `optimize_product`, `approve/reject/save_optimization` |
| `skills.js` | `get_skills`, `generate_skills`, `regenerate_skill`, `save_skill` |
| `size-chart.js` | `read/save/parse_size_chart`, `refresh_size_charts` |
| `creatives.js` | `update_creative`, `generate_branded`, `push_creative_to_shopify`, `cleanup_stale`, `poll_generations` |
| `products.js` | `product_detail`, `scrape_product`, `import_confirm`, `update_product_full`, `bulk_price` |
| `docs.js` | `store_docs`, `store_docs_download`, `upload_store_doc`, `process_single_file`, `process_inbox` |
| `custom-styles.js` | `custom_styles`, `analyze/create/delete/describe_style`, `scrape_style` |
| `pricing.js` | `update_cogs`, `manual_adspend` |
| `avatars.js` | `persona_avatars`, `generate_avatar`, `upload_avatar`, `set_avatar_reference`, `delete_avatar` |
| `sync.js` | `sync_products` — full Shopify product + collections sync (collections via GraphQL Admin API) |
| `publications.js` | `bulk_make_unlisted`, `bulk_make_listed` — GraphQL `publishablePublish`/`publishableUnpublish` on Online Store publication, per-product try/catch |
| `exports.js` | `export_products_csv` — RFC 4180 + UTF-8 BOM, whitelisted columns (title, product_url, visibility) |
| `webhooks.js` | `register_webhooks`, `list_webhooks`, `unregister_webhooks` |
| `users.js` | `me` (returns `req.user`, any authenticated caller), `users_list`/`create_user`/`update_user`/`delete_user`/`reset_password`/`generate_api_token` (all `admin:users`-gated, last-admin protection on demote/deactivate/delete), `change_own_password` (P1-14, AUDIT-2026-08 — any logged-in user, no permission needed; verifies `current_password`, rate-limited `change_password:{user_id}` 5/hr, bumps `token_version` + clears `must_change_password`). `reset_password` also bumps `token_version` + sets `must_change_password=true` (P1-15). |
| `reviews*.js` | Product reviews, split across 7 action modules + `reviews-shared.js` (service-role client + `computeSummary` + shared image/photo helpers `decodeAndValidateImage` / `uploadReviewImage` / `safePhotoUrl` / `deleteReviewPhoto` / `flagProductNeedsRepush` / **`stripLoneSurrogates`** — drops unpaired UTF-16 surrogates left behind when a `.slice()` length cap cuts an emoji in half; PostgREST sends the whole insert batch as one JSON document, so a single broken row fails the ENTIRE batch with Postgres `22P02`): **`reviews.js`** = Phase 1 core (`product_reviews_list`, `add_review_manual`, `update_review`, `delete_review`, `set_review_status`, `seed_reviews_helpful` — every query filters `store_id` (+ `product_id`); id-based mutations **require `store_id`**. `update_review` can also set `helpful_count`; `seed_reviews_helpful` gives a product's reviews a random helpful_count in [min,max] via the `seed_reviews_helpful` RPC). **`reviews-import.js`** = `import_reviews_csv` (Phase 3 bulk: own CSV parser, or fetches a Google Sheets CSV export server-side; `pending`/`source='csv'`, rate-limited 20/hr). **`reviews-ai.js`** = `generate_reviews_ai` (Phase 4: Claude `claude-sonnet-4` writes N reviews from product title/desc; `tone` positive/mix; `pending`/`source='ai'`, 20/hr; **own prompt, NOT in claude.js**). **`reviews-photo.js`** = `upload_review_photo` (Phase 4: base64 → Supabase Storage `store-docs` `{store}/Reviews/{productId}/`, returns `photo_url`; UUID + magic-byte + 8 MB validation). **`reviews-push.js`** = `push_reviews_to_shopify` (Phase 2: idempotent rebuild of `custom.reviews_json` (incl. each review's `id` + `helpful_count` for storefront voting) + `custom.reviews_summary` from approved+published reviews; gated on `hasAdminAccess`, skips archived/un-synced products; marks pushed reviews `published`, clears `dirty`). **`reviews-public.js`** = `submit_review_public` + `vote_review_helpful` (PUBLIC POST — `{review_id}` → atomic `increment_review_helpful` RPC; IP 30/hr + global 500/hr; "already voted" held client-side via localStorage) + `review_helpful_counts` (PUBLIC GET — `{shopify_product_id}` → live `[{id, helpful_count}]` so storefront shows current counts between pushes). `submit_review_public` (**PUBLIC/unauthenticated** storefront submission — maps Shopify `product_id` → TC store/product, inserts `pending`/`source='web'`; per-IP rate-limit 5/hr (keyed on non-spoofable `x-real-ip`) + global cap `review_submit_global` 200/hr + honeypot `company` + HTML strip + length caps; duplicate submit answered gracefully (dedup pre-check before any photo upload, + `23505` catch → `200 {duplicate:true}`); optional `email`; optional `photo_base64` (Wave 2) validated via shared `decodeAndValidateImage` (magic-byte JPEG/PNG/WebP, 5 MB cap) + `uploadReviewImage` → Storage; visitor resizes client-side first). `delete_review` / `set_review_status` flag a product for re-push when a **published** review is removed/rejected (badge surfaces staleness) and `delete_review` removes the photo from Storage. `add_review_manual`/`update_review`/CSV import run `photo_url` through `safePhotoUrl` (http(s) only — blocks `javascript:`/`data:` XSS). **`reviews-amazon.js`** = Phase 5: `scrape_amazon_preview` (calls TC scraper VPS at `AMAZON_SCRAPER_URL`, no DB write, `amazon_scrape:{user_id}` 10/hr) + `import_amazon_reviews` (downloads photos, inserts selected as `pending`/`source` from `ALLOWED_SOURCES` (`amazon`/`temu`/`cupshe`/`judgeme`), author anonymized "John Smith"→"John S.", dedup via `dropExistingDuplicates`, `MAX_REVIEWS=200` per request — the userscript chunks larger runs). Both gated on `products:edit` + `hasStoreAccess` + `FEATURE_AMAZON_REVIEWS_SCRAPER` env flag. `pipeline_log` agent=`AMAZON_SCRAPER`. **Alternative import path (feature-04):** `import_amazon_reviews` is also reachable from `scripts/titan-amazon-userscript.user.js` — a Tampermonkey userscript that scrapes the same review DOM client-side (bypassing the VPS/datacenter-IP block entirely) and POSTs with a bearer `api_token` instead of the dashboard session token. `AmazonImport.jsx` no longer runs the VPS scrape UI — it now renders `AmazonInstallGuide.jsx` (install instructions; the tab itself has no frontend flag-gate, same as before — `FEATURE_AMAZON_USERSCRIPT` is a backend-only marker env var, `import_amazon_reviews` still enforces `FEATURE_AMAZON_REVIEWS_SCRAPER`). |
| **API endpoints** (`api/`) — 12 routes (Vercel Hobby limit) | |
| `system.js` | Thin router (~165 lines) — delegates 73 actions to 24 files in `lib/actions/`. Calls `initSentry()` at module top (P1-21). CORS (`applyCors`, now `async`) resolves `submit_review_public`/`vote_review_helpful`/`review_helpful_counts` origins per-store via `lib/storefront-cors.js` (P1-10, AUDIT-2026-08); `import_amazon_reviews` and `health` stay on static env/wildcard lists. |
| `auth/login.js` | Password authentication → session token |
| `auth/shopify.js` | Shopify OAuth callback (HMAC is **hex** here — not base64 like webhooks) |
| `creatives/generate.js` | Generate image creative (routes by `ai_model` → fal.ai Nano Banana / FLUX / Ideogram, or Higgsfield Soul/Flux Kontext). Contains the standalone **Product Catalog v1 / v2 / v3 / v4 / v5 / v6 / v7** and **Realistic Beach** prompt blocks. v4 + v5 + v6 + v7 import their respective `V4_PROMPT_BODY` / `V5_PROMPT_BODY` / `V6_PROMPT_BODY` / `V7_PROMPT_BODY` and wrap them with reference-roles prefix + product title + conditional HIGH-WAIST navel-hide block. ⚠️ large file, churned heavily — read git history before changing. |
| `creatives/regenerate.js` | Regenerate image or video creative |
| `creatives/convert-to-video.js` | Convert image creative to video (Higgsfield DOP Turbo) |
| `creatives/list.js` | List creatives (filter by status, product_id, store_id, type) |
| `ads/action.js` | Approve/reject/pause creatives |
| `shopify/overview.js` | Shopify analytics: KPIs, daily revenue, top products, traffic, orders |
| `products/list.js` | Paginated products with creative/published counts + audiences (`page`, `limit`, `show_archived` params). Returns only `active` (or `status IS NULL`) unless `show_archived=true`. |
| `webhooks/shopify.js` | Shopify webhook receiver (products/create, update, delete). Raw body + **base64** HMAC verify against `stores.client_secret`. `bodyParser: false`. |
| `cron/detect-events.js` | Event detection cron (daily at 08:00 UTC, `0 8 * * *`): scans for actionable events → creates proposals. **Per-store detection runs in parallel (P1-13, AUDIT-2026-08, fixed 2026-08-17):** `processStore(store)` (fetch top products + `detectEventsForStore()`) is driven via `Promise.allSettled(stores.map(processStore))` in batches of `MAX_PARALLEL_STORES = 10` (unbounded in practice at current 2-6 store counts; the cap exists for once store count grows and Shopify/Claude API rate limits become the bottleneck) — was a sequential `for` loop, wall-clock scaled O(N) with store count and risked the Vercel cron timeout. One store throwing (Shopify API error, `detectEventsForStore` error) no longer aborts the others; failures are logged (`console.error` + `captureException`) and surfaced in the response's `failures` array + a `warn`-level `pipeline_log` entry, not silently dropped. Response body gained two additive fields, `stores` (per-store `{storeId, storeName, skipped, eventsCreated, proposalsCreated}`) and `failures` (string array) — existing `events`/`proposals`/`cleaned`/`polled` fields unchanged for backward compat. Also fixed inline: the `poll_generations` safety-net call now passes a synthesized `{ role: 'admin' }` `req.user` (previously `undefined` → silent 403 every run, `polled` always `{checked:0,completed:0,failed:0}` — a P1-20 follow-up). Test: `tests/cron-detect-events-parallel.test.js`. |
| **External deliverables** | |
| `scripts/titan-amazon-userscript.user.js` | Tampermonkey userscript (**v2.5.0**) — scrapes reviews client-side (Dan's residential IP + logged session), POSTs to `import_amazon_reviews` with a per-user bearer `api_token`. No client-side store allowlist (P1-11 from AUDIT-2026-08, removed `SCRAPER_STORE_ALLOWLIST`) — the store picker shows whatever `stores_list` returns, which the backend already filters to the bearer token's `user.store_access` unless admin/master. Hosted via GitHub raw URL + `@updateURL` for auto-update. Not deployed to Vercel — lives in the repo purely for version control + raw-URL hosting. **4 sources** via the `SCRAPERS` registry (`hostMatch` → `extractId` → `scrape`): Amazon (DOM), Temu (DOM, obfuscated classes), Cupshe (`review.cupshe.com` JSON API), and **`judgeme`** — a generic Judge.me scraper hitting `judge.me/reviews/reviews_for_widget` (JSON, 25/page; resolves the product via `/products/{handle}.js` + `Shopify.shop`), currently matched on `swanswaywear.com`. Adding another Judge.me store = one `@match` + one `hostMatch` entry. **Import is chunked** (`IMPORT_CHUNK_SIZE=100`, `MAX_REVIEWS_PER_RUN=500`): the backend caps one request at `MAX_REVIEWS=200` and downloads photos inline, so a single 500-review POST would risk the 60s Vercel timeout. Chunks aggregate inserted/duplicate counts with a per-batch toast; a failed chunk is counted and reported rather than aborting the run (401/429 stop early). Amazon pagination caps at 50 pages, harvest oversample at 1000 candidates. Title/body length caps go through `clip()` (slice + surrogate scrub) — a raw `.slice()` can split an emoji and fail the whole batch server-side. **A new source needs all 3 layers or it fails:** userscript `SCRAPERS` + `ALLOWED_SOURCES` in `lib/actions/reviews-amazon.js` + the `chk_product_reviews_source` DB CHECK — extend `sql/consolidate-review-source-check.sql` in place (P1-18, AUDIT-2026-08 — do not add a new `sql/add-review-<source>-source.sql` file, that per-source pattern is deprecated) and run it in Supabase. |
| **Agents** (`agents/`) — pipeline agent specs (not all wired yet) | |
| `scraper.md` | SCRAPER: URL scraping → structured ad briefs for FORGE |
| `forge.md` | FORGE: ad creative generation from briefs |
| `publisher.md` | PUBLISHER: push approved creatives to Meta Ads (future). **PUBLISHER agent name itself is wired** — used today by `lib/actions/publications.js` bulk Shopify Online Store publish/unpublish (`pipeline_log` agent=`PUBLISHER`); the Meta Ads push described here remains future. |
| `looper.md` | LOOPER: Meta performance scoring → feedback to FORGE (future) |
| `style-analyzer.md` | STYLE_ANALYZER: Claude Vision visual style extraction |
| **Product knowledge skills** (`.claude/skills/`) | |
| `isola.md` | Isola World swimwear brand knowledge — personas (Maria/Jennifer/Diane), hooks, visual direction. **Isola only.** |
| `elara.md` | Elara bikini: personas, hooks, visual direction |
| `mathilda.md` | Mathilda pants: personas, hooks, visual direction |
| **Design system** (`skills/nextbyte-design/`) | |
| `SKILL.md` + `references/design-tokens.md` | Nextbyte Dark Luxe — design tokens, typography, components, responsive, states |

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `stores` | Multi-store config: shopify_url, admin_token, storefront_token, client_secret (OAuth), currency, name, vendor, `brand_config` JSONB (payment_fees, transaction_fee_pct, logos, `brand_voice` string used by `generate_branded`, `features.high_waist_navel_hide` bool used by catalog HIGH-WAIST gating — P1-11 from AUDIT-2026-08, etc.), `online_store_publication_id` (GraphQL GID for Online Store publication), `storefront_origins` (`TEXT[]`, default `'{}'` — per-store CORS allow-list for public review actions, P1-10 AUDIT-2026-08, replaces the old global `STOREFRONT_URL` env var; see `lib/storefront-cors.js`) |
| `products` | Shopify products (synced): handle, title, price, images JSONB, `tags` JSONB (= collection memberships, set by full sync only), `product_type`, `vendor`, `status` (active/archived), `cogs`, `has_size_chart`, `garment_length` (text, `'short' \| 'mid' \| 'long' \| NULL` — populated lazily by Claude Vision on the first v1 generation, cached forever), `store_id` FK, `publication_online_store` (BOOLEAN, cached Online Store publication state; false = unlisted) |
| `creatives` | Generated ad creatives (image/video): file_url, storage_path, format, status (generating/**polling**/pending/approved/rejected/published/failed — `polling` added P1-20, AUDIT-2026-08, atomic claim state between `generating` and finalization), `polling_started_at` (TIMESTAMPTZ, set when a row is claimed, used by `cleanup_stale` to detect an orphaned claim), `metadata` JSONB (style, audience, model, hook_used, poll info), `product_id`, `story_id`, `store_id` FK. Migration `sql/add-creatives-polling-status.sql`. |
| `store_skills` | Compiled per-store knowledge: `skill_type` (brand-voice, audience-personas, product-{slug}, custom-style-{slug}, ...), title, content, `metadata` JSONB. Used by `lib/claude.js` (brand voice) and `lib/higgsfield.js` (`cs_` custom styles). `UNIQUE(store_id, skill_type)`. |
| `store_knowledge` | Raw extracted insights from uploaded store docs (category, insights, processed_at) — fallback when no compiled skill exists |
| `persona_avatars` | Per-persona reference images for model consistency: persona_name, label, age, description, reference_url, `variants` JSONB, is_active. `UNIQUE(store_id, persona_name)`. |
| `product_optimizations` | AI optimization proposals: pending/approved/rejected with `original` + `optimized` JSONB |
| `product_reviews` | Per-product reviews: author, rating (1–5 CHECK), title, body, `photo_url`, `verified`, `review_date` (NOT NULL, default today), `source` (manual/csv/ai/web/amazon/temu/cupshe/judgeme, CHECK — `chk_product_reviews_source`), `status` (pending/approved/published/rejected, CHECK), `dirty` (published+edited → awaits re-push), `email` (optional, from web submissions, never shown on site), `helpful_count` (storefront HELPFUL votes, atomic via `increment_review_helpful` RPC), `store_id` + `product_id` FK (product CASCADE). Unique dedup index `(store_id, product_id, author, md5(body))`. RLS: authenticated SELECT, service-role writes. Migrations (run **in order**): `sql/add-product-reviews.sql` (base table) → `sql/add-product-reviews-hardening.sql` (dedup index, review_date NOT NULL, status/source CHECK) → `sql/add-review-email.sql` (adds `email` + extends source CHECK with `'web'`) → `sql/add-review-helpful.sql` (adds `helpful_count` + `increment_review_helpful` RPC) → `sql/add-review-helpful-seed.sql` (`seed_reviews_helpful` RPC for bulk dashboard seeding). Running hardening without the email migration → `source='web'` inserts fail the CHECK. **`source` CHECK consolidated (P1-18, AUDIT-2026-08, fixed 2026-08-17):** `sql/consolidate-review-source-check.sql` is now the single source of truth for `chk_product_reviews_source` (idempotent NOT VALID + VALIDATE two-step) — supersedes the old per-source `add-review-<source>-source.sql` files (`amazon`/`temu`/`cupshe`/`judgeme`), which are marked deprecated in their own headers and must not be re-run. `tests/reviews-source-check.test.js` statically guards that every literal `source:` value in `lib/actions/reviews*.js` and `reviews-amazon.js`'s `ALLOWED_SOURCES` stays inside that file's CHECK list (and vice versa). |
| `events` | Detected events (product_no_creatives, revenue_declining, winner_detected) |
| `proposals` | Actionable proposals from events: pending/approved/dismissed |
| `pipeline_log` | All agent/system activity (agent, message, level, metadata, `store_id`, `user_id` UUID FK nullable, `initiator` TEXT nullable CHECK IN `'user'`/`'system'`/`'webhook'`/`'cron'` — P1-16, AUDIT-2026-08, see Audit trail note above). Also carries a pre-existing unused `user_email TEXT` column (added by `sql/enable-rls-all.sql`, never populated at insert time — `pipeline_log` action JOINs `users` on `user_id` instead to derive `user_email` for the API response, see `lib/actions/pipeline.js`). |
| `manual_adspend` | Manual ad spend entries (TikTok, Pinterest, other) |
| `ads` | Meta ads with campaign_id, meta_ad_id, budget, targeting |
| `performance` | Daily ad metrics from Meta |
| `briefs` | SCRAPER output (product hooks, headlines, visual refs) |
| `winner_refs` | LOOPER feedback (winning hooks/headlines for FORGE) |
| `product_docs` | Per-product document uploads (future) |
| `rate_limits` | Persistent rate limiting (key + created_at), indexed by key+time |
| `users` | Per-user auth: `username` UNIQUE, `password_hash` (scrypt via `lib/password.js`), `role` CHECK IN ('admin','member'), `permissions` TEXT[] (closed set from `lib/permissions.js`), `store_access` UUID[] (which stores user sees), `active` BOOL, `full_name`, `email` (optional), `last_login`, `token_version` (INT, default `1` — bumped on password change/reset to invalidate outstanding sessions, P1-15), `must_change_password` (BOOL, default `false` — set `true` by admin `reset_password`, forces the forced-change screen on next login, P1-14). Admin trumps permissions/store_access. See RBAC section below. Migrations: `sql/add-users-and-permissions.sql` → `sql/add-user-token-version.sql`. |

### RLS & migrations
- All tables have RLS enabled (`sql/enable-rls-all.sql`). Service-role bypasses RLS — backend uses service role.
- Migrations are individual `sql/*.sql` files (run in order in Supabase SQL Editor). `sql/schema.sql` is the original base; the `add-*.sql` files layer on top.
- **Migration tracking (P1-19, AUDIT-2026-08):** `sql/000-schema-migrations.sql` creates a `schema_migrations` table (`filename` PK, `applied_at`, `applied_by`), applied first (numbered `000-`) so it exists before anything else lands. Every new migration file should end with:
  ```sql
  INSERT INTO schema_migrations (filename) VALUES ('{THIS_FILENAME}.sql') ON CONFLICT DO NOTHING;
  ```
  This tracks applied migrations and lets a new environment audit `SELECT filename FROM schema_migrations ORDER BY applied_at;` to detect drift (missing rows = skipped migrations, out-of-order `applied_at` = replayed out of documented order). The pre-existing `sql/*.sql` files were NOT retrofitted with this line — too much churn for files already applied everywhere — they're captured once via `scripts/register-existing-migrations.mjs` instead. See `sql/README.md`.
- `sql/add-publications-manager.sql` — adds `stores.online_store_publication_id` + `products.publication_online_store`.
- `sql/add-store-storefront-origins.sql` (P1-10, AUDIT-2026-08, applied 2026-08-17) — adds `stores.storefront_origins` (`TEXT[]`, default `'{}'`), backfilled for Isola (`https://isolaswim.com`, `https://swimwear-brand.myshopify.com`) and Eleganz Haus (`https://eleganz-haus.de`, `https://31b625-c0.myshopify.com`). Elegance House left at `'{}'` (no public review widget live there).
- `sql/add-pipeline-log-user-attribution.sql` (P1-16, AUDIT-2026-08, applied 2026-08-17) — adds `pipeline_log.user_id` (`UUID` FK to `users.id`) + `pipeline_log.initiator` (`TEXT`, CHECK `NULL` or `'user'`/`'system'`/`'webhook'`/`'cron'`) + `idx_pipeline_log_user_id`. No backfill — existing rows keep both columns `NULL`, only new inserts get attribution. See Audit trail note above.
- Realtime enabled on relevant tables (`sql/enable-realtime.sql`, `sql/enable-delete-realtime.sql`).

### Indexes
- `products.store_id`, `products.completed_at`-style ordering columns
- `store_skills.store_id`, `persona_avatars.store_id`
- `rate_limits(key, created_at)`
- `subscriptions`-style UNIQUE constraints where noted above

---

## Env Vars

```
APP_PASSWORD=***                # Dashboard login password
APP_URL=***                     # Public app URL (e.g. https://titan-commerce.vercel.app) — webhook callback target
SITE_URL=***
STOREFRONT_URL=***              # DEPRECATED (P1-10, AUDIT-2026-08, fixed 2026-08-17) — CORS origins for public review actions now live per-store in stores.storefront_origins. This var is kept for ONE deploy cycle as a fail-open fallback only (store unresolved, e.g. a CORS preflight with no body — or a store row not yet backfilled), console.warn'd on every hit. See lib/storefront-cors.js. Follow-up TODO: delete this var + the fallback once logs show nothing hits it for a full cycle.

FAL_KEY=***                     # fal.ai API key (primary image gen)
HF_CREDENTIALS=***              # Higgsfield API key (fallback / video)
ANTHROPIC_API_KEY=***           # Claude API (product optimization, vision, skill gen)

SUPABASE_URL=***                # Supabase project URL
SUPABASE_ANON_KEY=***
SUPABASE_SERVICE_ROLE_KEY=***   # backend uses this (bypasses RLS)
VITE_SUPABASE_URL=***           # frontend
VITE_SUPABASE_ANON_KEY=***      # frontend

SHOPIFY_STORE_URL=***           # default store (Elegance House) — most flows pass store_id and use stores table
SHOPIFY_ACCESS_TOKEN=***        # default storefront token
SHOPIFY_ADMIN_TOKEN=***         # default admin token

META_APP_ID=                    # EMPTY — awaiting setup
META_APP_SECRET=                # EMPTY
META_ACCESS_TOKEN=              # EMPTY
META_AD_ACCOUNT_ID=             # EMPTY

AMAZON_SCRAPER_URL=***          # http://37.27.189.60:3100 — TC scraper VPS (Docker/Express/Puppeteer, NOT in this repo)
AMAZON_SCRAPER_TOKEN=***        # Shared bearer secret, must match /root/titan-scraper/.env on the VPS
FEATURE_AMAZON_REVIEWS_SCRAPER= # 'true' to enable the Amazon tab + import_amazon_reviews/scrape_amazon_preview actions, default off
SENTRY_DSN=                     # Optional (P1-21, AUDIT-2026-08). EMPTY = Sentry is a no-op, existing console.error behavior unchanged. Set once a free-tier Sentry project exists (see Docs/RUNBOOK-monitoring.md) to route api/system.js + cron/detect-events.js + webhooks/shopify.js catch-all errors there.
CRON_SECRET=                    # Optional. Bearer token api/cron/detect-events.js checks against the Authorization header; Vercel sets this automatically for its own cron invocations. EMPTY = cron endpoint accepts any caller (documented here per the P2 finding that this var was read by code but never documented).
FEATURE_AMAZON_USERSCRIPT=      # 'true' marks this feature as live in prod (no frontend gate exists — the Amazon tab is always visible, same as F03's precedent). import_amazon_reviews itself still gates on FEATURE_AMAZON_REVIEWS_SCRAPER (unchanged) — both must be 'true' for the userscript flow to work end to end.
AMAZON_USERSCRIPT_ORIGINS=      # optional comma-separated override for import_amazon_reviews CORS origins, default 'https://www.amazon.com,https://smile.amazon.com'
```

---

## Key Dependencies

Root `package.json` (backend / serverless):
- `@anthropic-ai/sdk` — Claude API
- `@higgsfield/client` — Higgsfield image/video (manual polling)
- `@sentry/node` — backend error monitoring (P1-21, AUDIT-2026-08). Node.js SDK, NOT `@sentry/nextjs`/`@sentry/browser` — this is a plain Vercel Node.js serverless runtime. Fail-open via `lib/sentry.js` (no-op unless `SENTRY_DSN` is set).
- `@supabase/supabase-js` — DB + auth + storage + realtime
- `cheerio` — HTML scraping for product data
- `mammoth` — .docx → text (store doc ingestion)
- `vitest` (dev) — test framework
- fal.ai is called via plain `fetch` (no SDK) — see `lib/fal.js`

`apps/dashboard/package.json` (frontend):
- `react` / `react-dom` ^19
- `vite` ^8 + `@vitejs/plugin-react`
- `dompurify` — safe HTML rendering
- `lucide-react` — icons
- `xlsx` (SheetJS) — parse uploaded .xlsx/.csv review imports in-browser (Phase 3 reviews import); lazy-loaded so it only ships when the import modal opens
- `@supabase/supabase-js` — realtime
- `eslint` + react hooks/refresh plugins

---

## Important Patterns

### Multi-Store Data Isolation
Every query filters by `store_id`. Frontend passes active store ID to all API calls. Store switcher in header changes context for the entire dashboard. `stores_list` strips `admin_token` and returns `has_admin` boolean.

### Auth Flow
`api/auth/login.js` accepts `{username, password, remember}` → username lookup in `users` table → `verifyPassword` (scrypt) → HMAC session token with `{user_id, role, permissions, store_access, tv, created, expires}` → stored in localStorage `auth_token` → `withAuth()` middleware fetches full user from DB on every request (freshness for permission changes, kicks out deactivated users). **`APP_SECRET` fails closed.**
- **Master fallback (kill-switch):** If body omits `username` and `password === APP_PASSWORD`, sign token with `{master:true, admin:true}` — `verifyAuth` skips DB lookup, returns `{master:true, role:'admin'}`. Always works even if `users` table is empty/broken. Never remove — safety net. Master tokens never carry `tv` and are never subject to the session-revocation check below.
- **Session revocation via `tv` (P1-14/P1-15, AUDIT-2026-08):** `users.token_version` (default `1`) is stamped into the session token as `tv` at login. `verifyAuth` rejects the token if `payload.tv !== user.token_version`. `change_own_password` and `reset_password` (both in `lib/actions/users.js`) bump `token_version` on success — this instantly invalidates **every** outstanding session for that user, including the one making the request (client is expected to discard `auth_token` and re-login). Migration `sql/add-user-token-version.sql` adds `token_version` (default `1`) + `must_change_password` (default `false`). **Compat window:** tokens signed before this deploy carry no `tv` claim at all — `verifyAuth` accepts a missing `tv` (logs a `console.warn`) rather than mass-logging-out every active session the moment this shipped; a follow-up commit removes that branch once the TTL-driven re-login tail has cleared (24h default, 30d "remember me").
- **Self-service password change (P1-14):** `change_own_password` action (`lib/actions/users.js`) — any logged-in user, no `admin:users` needed. Verifies `current_password` via `verifyPassword`, requires `new_password` ≥ 8 chars, rate-limited `change_password:{user_id}` 5/hr. Bumps `token_version` + clears `must_change_password`. Frontend: `ChangePasswordForm.jsx` (shared by Settings tab self-service + Login.jsx's forced first-login screen), `changeOwnPassword()` in `api.js` (bespoke `fetch`, NOT `fetchJSON` — a wrong-current-password 401 must show inline, not trigger `fetchJSON`'s global "401 → wipe token → reload" handler).
- **Admin `reset_password` now ALSO** bumps `token_version` (kills the target's existing sessions immediately) and sets `must_change_password = true` (temp password can't silently persist — `Login.jsx` reads `must_change_password` from the login response and gates the dashboard behind the forced `ChangePasswordForm` before calling `onSuccess()`).
- **Rate limits (login):** `login_attempts:${ip}` 10/hr, `login_attempts:${username}` 5/15min (credential stuffing), `login_attempts_global` 200/hr. IP from `req.headers['x-real-ip']` (Vercel non-spoofable). Constant-time defense: unknown-username path runs dummy `verifyPassword` to hide timing.
- **Public allow-list:** `PUBLIC_ACTIONS` Set skips auth for storefront actions (`submit_review_public`, `vote_review_helpful`, `review_helpful_counts`).
- **Bearer `api_token` (userscript/API access):** `lib/auth.js`'s `verifyAuth` also accepts a flat 64-char hex token (no `.` — session tokens are `base64.hexsig` and always contain one) looked up directly against `users.api_token`. Generated via `generate_api_token` action (admin-only, `admin:users` perm), one-time reveal in Settings > Users. Used by `scripts/titan-amazon-userscript.user.js` to call `import_amazon_reviews` from the Amazon page. Regenerating overwrites the previous token (old one stops working immediately). Never replaces the session-token dashboard login path — fully parallel. Not subject to the `tv` check (separate revocation model: regenerating overwrites the old token).

### RBAC (Users & Permissions)
Every action in `lib/actions/*` starts with `hasPermission(req.user, 'X')` → 403 if false, then `hasStoreAccess(req.user, store_id)` → 403 if store not in `user.store_access`. Both from `lib/permissions.js`. Admin trumps: `role='admin'` → both helpers return `true` unconditionally.
- **`PERMISSION_LIST` (closed set):** `products:read`, `products:edit`, `products:images`, `products:publications`, `creatives:generate`, `admin:users` (implicit for admin), `finance:read`.
- **`finance:read` (P0-5, Docs/AUDIT-2026-08.md):** dedicated tier for revenue/COGS/margin/ad-spend visibility, deliberately separate from `products:read`. Gates `profit_summary` (`lib/actions/profit.js`) and `kpi`/`meta_overview`/`insights` (`lib/actions/analytics.js`), plus the Cockpit/Shopify/Profit tabs in `App.jsx`'s `visibleTabs()` (Products tab stays on `products:read` alone). Without this split, a VA/contractor scoped for product image work (`products:read`) would automatically see full P&L for every accessible store. Migration `sql/add-finance-read-permission.sql` has the audit query for existing `products:read` users — no auto-grant, admin reviews per user.
- **First admin bootstrap:** `node scripts/create-first-admin.mjs <username> <password> [full_name]` — one-shot, idempotent, uses `lib/password.js` scrypt.
- **Admin UI:** Settings tab → `apps/dashboard/src/pages/Settings.jsx`, visible to **every** logged-in user (not admin-only — hosts self-service `ChangePasswordForm.jsx`, P1-14). `apps/dashboard/src/components/settings/UsersManager.jsx` (create/edit/delete users, reset passwords — temp password shown to admin for manual copy) is gated inside `Settings.jsx` on `user?.role === 'admin'`, not at the tab level.
- **Frontend gating:** `PermissionGate` component + `useUser()` hook filter tabs (App.jsx), store switcher (`useActiveStore` filtered by `user.store_access`), and per-button visibility (Products.jsx family). `visibleTabs()` always appends `'Settings'` for any authenticated user (master included — `Settings.jsx` hides `ChangePasswordForm` for `user?.master` since master has no backing `users` row). Client-side is cosmetic — backend enforces truth.
- **Last-admin protection (atomic, P1-17 fixed 2026-08-17):** `update_user`/`delete_user` dispatch via Postgres RPC (`safe_update_user`/`safe_delete_user`, `sql/add-safe-admin-update-fn.sql`, `SECURITY DEFINER`) instead of a JS-side SELECT-then-UPDATE/DELETE. The RPC `FOR UPDATE`-locks the target row + all other active admins inside one transaction, so two concurrent demote/deactivate/delete calls against different admins serialize instead of both passing a stale ">1 active admin" check. Raises `last_active_admin` (mapped to 409) or `user_not_found` (mapped to 404).

### Brand Voice (Dynamic Per-Store)
`lib/claude.js` builds the system prompt dynamically: loads `brand-voice` skill from `store_skills` → falls back to generic prompt + store name. No hardcoded brand references. Store name/vendor injected from `stores` table. Product-specific knowledge loaded from `store_skills` (`product-{slug}`) when a product name is available; auto-generated from product photos via Claude Vision if missing.

### Creative Generation — Model Routing (`api/creatives/generate.js`)
- `ai_model` key from frontend → resolved to provider:
  - `fal_nano_banana` / `fal_nano_banana_pro` → fal.ai `fal-ai/nano-banana-2/edit` / `fal-ai/nano-banana-pro/edit` (fire-and-forget). If no reference image → falls back to Higgsfield Flux Kontext Max (synchronous text-to-image).
  - `fal_flux2_edit` / `fal_flux2_pro_edit` / `fal_ideogram_bg` / `fal_ideogram_edit` / `fal_flux_kontext` → fal.ai (fire-and-forget)
  - `flux_kontext` → Higgsfield Flux Kontext Max, fallback fal.ai FLUX.2 edit
  - `soul` / `soul_ref` → Higgsfield Soul / Soul Reference
- **`resolution: "2K"` is the fallback for Nano Banana** in `lib/fal.js` when `resolution` is unset or invalid (default is 1K — too soft for product photos); an explicit `"1K"` (or other valid value) passes through unchanged
- Fire-and-forget: creative row created as `generating`, `requestId`/`pollBase`/`model` stored in `metadata`; `poll_generations` action checks pending jobs and finalizes them (with one retry on failure for fal.ai jobs)
- **Atomic claim (P1-20, AUDIT-2026-08 fixed 2026-08-17):** `poll_generations` claims rows via the `claim_generating_creatives(p_limit, p_store_id)` Postgres RPC (`sql/add-claim-generating-creatives-fn.sql`, `SECURITY DEFINER`) instead of a plain SELECT. The RPC does `UPDATE creatives SET status='polling' ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`, so two concurrent pollers (ProductWorkspace.jsx/Studio.jsx interval-poll every 3s in separate browser tabs, the daily admin cron) get disjoint claimed row sets instead of both fetching + double-processing the same `generating` row (previously: duplicate fal.ai auto-retry credits burned + racing writes to the same creative). Every exit path in `poll_generations` either finalizes the claimed row to a terminal/next-stage status or calls the local `releaseClaim(id)` helper to set it back to `generating` (fal.ai job still in progress, or processing threw mid-work). `cleanup_stale` additionally resets any `polling` row stuck > 10 min (`polling_started_at`) back to `generating` — a poller that claimed a row and then crashed/was killed before reaching its own release path.

### Creative Styles
- Built-in (`lib/higgsfield.js` `STYLE_PROMPTS`): `ad_creative`, `product_shot`, `product_photo_beach`, `lifestyle`, `review_ugc`, `static_clean`, `static_split`, `static_urgency` (+ `branded_*` for branded content)
- Standalone styles handled directly in `api/creatives/generate.js` (bypass `buildStyledPrompt`): **`product_catalog`** (v1, e-commerce swimwear — model preset + pose + framing pills, beach setting; post-processed via `processCatalogImage`), **`product_catalog_v2`** (single-shot, model + pose pills, no framing/beach), **`product_catalog_v3`** (2-step pipeline: studio shot via Nano Banana Pro → beach BG swap via Ideogram replace-background), **`product_catalog_v4`** (editorial-strobe prompt from `lib/v4-prompt.js`, bright midday daylight + neutral grading + frontal flat lighting, minimal UI: Reference model + Resolution + Count only), **`product_catalog_v5`** (variant of v4 with warm post-sunset afterglow background — neutral subject for product pop, same minimal UI), **`product_catalog_v6`** (variant of v5 with bright midday daylight + vivid turquoise ocean + bright blue sky background — same lighting on subject as v5), **`product_catalog_v7`** (variant of v5 with soft warm afterglow + balanced exposure — visible warm tones, natural-feeling lighting, between v5 dim and v6 vivid), **`product_catalog_v8`** (color-aware lighting — same body shell as v7 but LIGHTING + DO NOT GENERATE blocks are templated per detected color class. Dark fabrics get a subtle off-axis fill to reveal construction detail, solid pastels/brights get an even gentler fill for dimension, print/patterned products get the v7 flat-frontal lighting verbatim. Auto-detection: `variant > title` precedence via `detectV8ColorClass` in `lib/v8-prompt.js`. User-controlled `v8_fill_intensity` UI preset (light/medium/strong) governs fill strength. Minimal UI: Reference model + Fill intensity pills + Resolution + Count.), **`product_catalog_v9`** (clean monolithic prompt rebuild of v1 in the v7/v8 style — bright sunny beach background, frontal softbox lighting, 3/4-body crop via ALWAYS/NEVER MID-CALF wording. Avatar required, no model description fallback. Minimal UI: Reference model + Resolution + Count. Prompt is one string from `lib/v9-prompt.js`, no template placeholders.), **`product_catalog_v10`** (clone of v9 with v1's verbatim LIGHTING block + GARMENT-specific lighting paragraph swapped in — same SETTING/EXPOSURE/FRAMING as v9, but the lighting wording is v1's longer 'FRONTAL SOFTBOX + SIDE FILL + THE GARMENT' paragraph) and **`realistic_beach`** (ultra-real curvy model, bright daylight, bypasses audience/age/tummy/skill systems). All catalog v1/v2/v3/v4/v5/v6/v7/v8/v9/v10 use the `[avatar, productPhoto, avatar]` sandwich; HIGH-WAIST navel-hide block (`catalogHighWaist`) is gated on `store.brand_config.features.high_waist_navel_hide` (data-driven per store, P1-11 from AUDIT-2026-08 — was a hardcoded "isola" name-substring check; live-set `true` for Isola, defaults `false` elsewhere) OR the title-based `isHighWaistTummy` auto-detect. v1 is post-processed (brightness lift); v2-v10 outputs go straight to Storage.
- Custom styles: `cs_`-prefixed, loaded from `store_skills` (`custom-style-{slug}`), built via Custom Style Builder; in `higgsfield.js` they early-return before `STYLE_PROMPTS` lookup
- Per-store brand context injected; feedback learning from approved/rejected creatives

### Persona Avatars
Per-persona reference photos (`persona_avatars` table) for model consistency. When `audience` is selected in a non-standalone flow, the persona's `reference_url` is auto-injected as a reference image using a **sandwich pattern** (avatar FIRST + product images + avatar LAST) to keep identity signal strong among headless product crops. Catalog v1/v2/v3/v4/v5/v6/v7 also use this sandwich (avatar required by frontend guard). Only `realistic_beach` skips avatar injection entirely.

### Product Image Filtering (creative gen)
Pushed AI creatives get appended to the END of a product's Shopify images. For audience flows and standalone styles, only the **first 2** product images are used as references (original product shots, not previously-pushed AI creatives) — avoids copying a prior model's face.

### Product Optimizer Approval Workflow
```
Optimize → saves to DB (status: pending) → appears in queue
  → Review & Edit → Save Draft (still pending)
  → Approve & Push → writes to Shopify → status: approved
  → Reject → status: rejected → never touches Shopify
```
Product *import* (direct create) and the inline Product Editor write to Shopify immediately — those are NOT gated.

### Custom Style Builder
Upload 3-8 reference photos (or scrape competitor URL) → Claude Vision analyzes visual style collectively → generates prompt template. Saved as `store_skills` (`skill_type='custom-style-{slug}'` + `metadata` with reference_images, color_palette, style_key). Reference images in Supabase Storage `{storeName}/Styles/{slug}/`.

### P&L (Per-Store)
`profit_summary` accepts `store_id` → per-store Shopify client. P&L: Revenue − Returns − COGS − Shipping − Adspend − Transaction Fees = Profit. Transaction fees per-gateway from `stores.brand_config.payment_fees` (gateway from `order.payment_gateway_names[]`). Shipping from `order.shipping_lines[].price`. Returns from `refunds[].transactions[].amount`. Accuracy indicators in UI show tracking status (COGS missing, shipping tracked/estimated, returns tracked).

### Event → Proposal System
Cron (daily 08:00 UTC) → `detect-events.js` → per store in parallel (`Promise.allSettled`, P1-13 AUDIT-2026-08) → `detectEventsForStore()` scans for actionable events → creates proposals → Cockpit shows queue (Approve / Dismiss / Approve All + Scan Now). Event types: `product_no_creatives`, `revenue_declining`, `winner_detected`. Detection logic shared via `lib/event-detector.js` (itself unchanged — takes `supabase` as a plain arg, no shared connection-pool concern under parallel calls).

### Shopify API
- REST Admin v2024-01 for most reads/writes; **GraphQL Admin v2024-01** for collection→products mapping in `sync_products` (more reliable for smart collections, paginated with cursor)
- `createShopifyClient(url, token)` factory pattern; default client exported for backward compat
- MUST use `{handle}.myshopify.com` URLs

### Product Sync (`lib/actions/sync.js`)
1. Fetch custom + smart collections (Admin REST), then for each: fetch member products via **GraphQL** `collection.products` (paginated). Build `handle → [collection titles]` map.
2. Fetch all products (Admin REST, `since_id` pagination).
3. Upsert each via `upsertProductFromShopify()`, then set `tags` = collection titles — **only if the product is in ≥1 collection** (preserves existing tags otherwise; downside: a product that left all collections keeps stale tags).
4. Archive products no longer in Shopify (`status='archived'`).
- Webhooks (`api/webhooks/shopify.js`) call the same upsert helper but **never touch `tags`** (webhook payload has no collection memberships) — only full sync populates collections.

### Pagination (Products)
- `api/products/list.js`: `page` + `limit` (max 200) + `show_archived` params → `{ products, total, page, pages }`
- `Products.jsx`: 50/page with "Load more"; loads full catalog (`getAllProducts`, up to 200) when search ≥2 chars OR any filter is active (so collection/price/creatives/audience filters operate over the whole catalog, not just page 1)
- Other pages use `getAllProducts()`

### Vercel Hobby Limits
- Max 12 serverless functions → route budget: `system.js`, `auth/login.js`, `auth/shopify.js`, `creatives/generate.js`, `creatives/regenerate.js`, `creatives/convert-to-video.js`, `creatives/list.js`, `ads/action.js`, `shopify/overview.js`, `products/list.js`, `webhooks/shopify.js`, `cron/detect-events.js` (12 total; `meta_overview` is an action in `analytics.js`, not a route) — `api/system.js` absorbs everything else as `?action=X`
- 1 cron/day → `cron/detect-events.js` at `0 8 * * *`
- 60s timeout → fire-and-forget for long ops (image gen submits then polls via `poll_generations`)
- Shopify webhooks have a ~5s response SLA — keep handlers light

### Shopify Webhooks
- Endpoint `api/webhooks/shopify.js` receives `products/create|update|delete` for all stores; routes via `X-Shopify-Shop-Domain` → lookup `stores.client_secret`
- **HMAC is base64** (`digest('base64')`) — NOT hex. OAuth callback in `api/auth/shopify.js` uses hex; webhook uses base64. Don't confuse them.
- `bodyParser: false` required — HMAC computed over raw body
- `products/delete` = soft archive (`status='archived'`), never hard delete
- Registration: Shopify tab UI → `register_webhooks` action → registers 3 topics at `${APP_URL}/api/webhooks/shopify` (signed with the app's client_secret)

---

## App Flow

```
Dashboard → Password gate (Login.jsx)
  → Authenticated → Store selector (3 stores, switcher in header)
    → 6 tabs:
    │
    ├── Cockpit
    │   ├── KPI cards (revenue, profit, creatives, ...)
    │   ├── Pipeline bars (creative funnel)
    │   ├── Proposal Queue (events → approve/dismiss/approve all) + Scan Now
    │   └── TerminalLog (pipeline activity)
    │
    ├── Shopify
    │   ├── ShopifyDashboard: KPIs, revenue chart, top products, traffic, orders
    │   └── Pricing: bulk price editor (collection filter, search, checkboxes, apply)
    │
    ├── Studio
    │   ├── Product Creatives: product picker → CreativeStudio → gallery (images/videos) → CreativeDetailModal
    │   ├── Branded Content: type/prompt/style/model/count → generate
    │   └── Bulk Generate (collapsible): multi-select products → style/model/count/etc → generate all
    │
    ├── Avatars
    │   ├── Persona avatar list (per store)
    │   ├── [+ New] → AvatarBuilder (generate from persona / "From Photo" / custom builder)
    │   └── → AvatarDetail (variants, set reference photo)
    │
    ├── Products
    │   ├── Paginated grid (50/page, load more, 3 view modes, filters, sort, sync, import)
    │   │   └── [Last synced] timestamp
    │   ├── [Import] → ImportModal (scrape URL → preview/edit → create in Shopify → auto-optimize + auto-generate creatives)
    │   └── → ProductWorkspace (per product)
    │       ├── [+ Image] / [▶ Video] → CreativeStudio → fal.ai / Higgsfield
    │       ├── [✨ Optimize] → OptimizePanel → Claude AI → approval workflow
    │       ├── [Photo Story] → PhotoStoryModal → clean white-studio shot set
    │       ├── [Reviews] → ReviewsPanel (modal) → manual add/edit/approve/reject/delete reviews + [Import] (CSV / .xlsx / Google Sheets) + [Generate (AI)] + photo upload → all pending. [Push to Shopify] (F2, admin stores) rebuilds custom.reviews_json/reviews_summary metafields from approved+published reviews.
    │       │   └── INBOUND (public): Shopify storefront review form → `submit_review_public` (unauthenticated, allow-listed) → inserts pending/source='web' → appears in the Reviews moderation queue above. Storefront render: theme section reads the two metafields (Isola; theme repo, not here).
    │       ├── [Studio →] → navigates to Studio with product pre-selected
    │       ├── Creative grid by style → CreativeDetailModal review
    │       ├── Size Chart (read/edit table + import from image via Claude Vision → Shopify metafield)
    │       └── Product Detail + Editor (all Shopify fields, inline edit, direct save)
    │
    └── Profit
        ├── KPIs: Revenue, COGS, Shipping, Returns, Adspend, Profit, ROAS
        ├── Daily P&L table (7d/14d/30d) + accuracy indicators
        ├── COGS management (per product)
        ├── Manual adspend (TikTok, Pinterest, ...)
        ├── CSV export
        └── Storage cleanup (stale creatives)
```

---

## Known Tech Debt & Planned Work

| Priority | Item | Notes |
|----------|------|-------|
| 🟡 MED | Meta Ads integration — awaiting credentials | When ready |
| 🟡 MED | `CreativeStudio.jsx`, `api/creatives/generate.js`, `lib/higgsfield.js` are large (>700 lines) | Extract sub-components / prompt modules |
| 🟡 MED | Product Catalog / Realistic Beach prompts were churned heavily (5/10) | Sensitive to changes — read git history before touching; quality regressions traced to ref-image count + missing FACE QUALITY block + 1K resolution |
| 🟡 MED | Sync keeps stale collection tags | A product that left all collections keeps old `tags` (`sync.js` `if (cols.length > 0)`). Filter may show a product no longer in a collection. |
| 🟢 LOW | `pages/Overview.jsx` is dead code | Superseded by `Cockpit.jsx` — delete |
| 🟢 LOW | Product docs drag & drop upload (Supabase Storage) | Future |
| 🟢 LOW | Product Optimizer — auto-detect unoptimized imports | Future |
| 🟢 LOW | PUBLISHER agent auto-publish to **Meta** / LOOPER agent (performance scoring loop) | Future — PUBLISHER is now wired for Shopify Online Store bulk publish/unpublish (`lib/actions/publications.js`); only the Meta Ads auto-publish use case remains unbuilt |
| 🟢 LOW | TikTok/Pinterest API integration (replace manual adspend) | Future |
| 🟢 LOW | Full mobile responsive design | Partial |
| 🟢 LOW | `getAllProducts` caps at 200 | Filters/search incomplete for stores >200 products (none currently) |
| 🟢 LOW | Amazon reviews scraper has no persistent `products.amazon_url` mapping | Admin re-pastes the URL each scrape (D-05, deferred) |
| 🟢 LOW | `STOREFRONT_URL` env var + its fallback in `lib/storefront-cors.js` (P1-10, AUDIT-2026-08) | One-cycle deprecation fallback for per-store `stores.storefront_origins`. Remove the env var + fallback branch once logs confirm no store has hit `console.warn('[CORS] using legacy STOREFRONT_URL fallback...')` for a full deploy cycle. |

---

## Dev Commands

```bash
# Frontend (Vite)
cd apps/dashboard && npm run dev     # http://localhost:5173

# Backend + frontend together (Vercel)
vercel dev                           # API + frontend

# Install dependencies
npm install --legacy-peer-deps       # root — always use --legacy-peer-deps
cd apps/dashboard && npm install     # frontend

# Build
cd apps/dashboard && npm run build   # production build (output: apps/dashboard/dist)

# DB migrations
npx supabase db push                 # or run sql/*.sql manually in Supabase SQL Editor

# Tests
npm test                             # Vitest — auth (incl. tv/session-revocation, self-service password change), rate-limit, profit, routing, CSV parser, image validation, import-guard, contracts, migration tracking, atomic creative-poll claim, monitoring/health, review source CHECK contract, per-store CORS resolution, parallel cron store processing, pipeline_log user/cron/webhook attribution (476 tests)
```

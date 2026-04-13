# CLAUDE.md — Titan Commerce Limited

> **Rule:** After every major change (new file, new screen/component, dependency add/remove, architecture change, new pattern, app flow change) **update this CLAUDE.md** to reflect the current project state. Specifically check and update: Key Files table, Key Dependencies, Important Patterns, App Flow, and Known Tech Debt. Do this automatically at the end of implementation — don't wait for the user to ask.

---

## Project Overview

**Titan Commerce Limited** — multi-store SaaS dashboard for e-commerce ad creative management. Generates AI ad creatives (image + video), optimizes product listings with AI, tracks Shopify analytics and profit, manages branded content, and integrates with Meta Ads. Supports **3 stores** (Elegance House, Isola, Eleganz Haus) with full store isolation via `store_id` FK on all data tables.

---

## Architecture

- **Framework:** React + Vite (frontend dashboard)
- **Deployment:** Vercel Serverless Functions (API layer, Hobby plan — 12 route max, 1 cron)
- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **AI — Images/Video:** Higgsfield (Nano Banana for images, DOP Turbo for video)
- **AI — Text:** Anthropic Claude API (claude-sonnet-4-20250514) for product optimization
- **E-commerce:** Shopify Admin API (REST, v2024-01) — MUST use `{handle}.myshopify.com` URLs (not custom domains)
- **Ads:** Meta Marketing API (v21.0) — read-only, awaiting credentials
- **Auth:** Password-based session tokens (`APP_PASSWORD` env var), `withAuth()` middleware on all endpoints
- **Design:** Nextbyte Dark Luxe — Michroma (gradient headings), Plus Jakarta Sans (body), Space Mono (data)

---

## Multi-Store Architecture

3 stores in `stores` table, each with own Shopify credentials:
- **Elegance House** (women's fashion, EU, EUR)
- **Isola** (swimwear)
- **Eleganz Haus** (fashion, DE)

Key patterns:
- `store_id` FK on: `products`, `creatives`, `events`, `proposals`, `pipeline_log`
- `lib/store-context.js` — `getStore(id)`, `getAllStores()`, `hasAdminAccess(store)`
- `useActiveStore` hook + `StoreProvider` context with localStorage persistence
- Store switcher dropdown in App.jsx header
- Shopify Admin features only available for stores with `admin_token`

---

## Language Rules

- **UI text:** English
- **Code, comments, variable names:** English
- **Docs/Briefs/, Docs/Sprints/:** Czech (team language)
- **This file:** English

---

## Coding Style & Conventions

### General
- Vercel serverless: `export default handler`, max 60s timeout (use 55s safe limit)
- Supabase server-side: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`
- Frontend API: all calls through `lib/api.js` (`fetchJSON` wrapper with auth token)
- `npm install` always with `--legacy-peer-deps` (Higgsfield peer dep conflict)
- Currency: **EUR** (not USD)

### Frontend
- Functional components only, hooks order: `useState → useRef → useEffect → custom → callbacks → render`
- CSS: dark theme with CSS variables, Nextbyte Dark Luxe design system
- No chart libraries — use pure CSS bars for charts
- HTML in descriptions: sanitize with DOMPurify before rendering
- Toast notifications via `useToast()` hook for all user-facing feedback
- Skeleton loaders (`Skeleton.jsx`) for loading states — no "Loading..." text
- Code splitting: lazy imports with `React.lazy` + `Suspense` for all page components

### Backend
- Error handling: `try/catch` everywhere, structured logging: `console.error('[Module] Description:', { context })`
- `catch (e) {}` is **FORBIDDEN** — always log or re-throw
- Pipeline activity → `pipeline_log` table (agent, message, level, metadata). Agent names: `OPTIMIZER`, `IMPORTER`, `PRICING`, `CLEANUP`, `AUTH`, `SKILL_GEN`, `SCRAPER`, `FORGE`, `PUBLISHER`, `LOOPER`
- Shopify writes: always log to pipeline_log before and after
- Rate limiting via `lib/rate-limit.js`: generate 20/hr, video 10/hr, optimize 30/hr
- Vercel 12-route limit: consolidated endpoints in `api/system.js` mega-handler with `?action=X` pattern

---

## Don't Rules

1. **Don't push to Shopify without approval** — Product Optimizer saves to DB as `pending`, only `approve_optimization` writes to Shopify
2. **Don't install new dependencies** without asking first
3. **Don't use chart libraries** — CSS bars for all charts
4. **Don't hardcode store-specific data** — all store data from `stores` table
5. **Don't make files longer than ~300 lines** — extract hooks, utils, sub-components
6. **Don't swallow errors** — `catch (e) {}` is forbidden
7. **Don't use `npm install` without `--legacy-peer-deps`**
8. **Don't use custom Shopify domains** — always `{handle}.myshopify.com` for Admin API

---

## App Structure

### Tabs: Overview | Shopify | Studio | Products | Profit

| Tab | Page | Purpose |
|-----|------|---------|
| Overview | `Overview.jsx` | Proposal queue (events → proposals → approve/dismiss) + Pipeline (ApprovalQueue + TerminalLog) + Meta panel + ShopifyServices |
| Shopify | `Shopify.jsx` | ShopifyDashboard (KPIs, revenue chart, top products, traffic, orders) + inline Pricing (bulk price editor) |
| Studio | `Studio.jsx` | Branded content generation (type/prompt/style/model/count) + Product creatives (product picker → GeneratePanel) |
| Products | `Products.jsx` → `ProductWorkspace.jsx` | Paginated product grid (50/page, load more, import) → per-product workspace (creatives, size chart, full product detail + editor) |
| Profit | `Profit.jsx` | P&L dashboard: daily revenue/COGS/adspend/fees/profit, COGS management, manual adspend, CSV export, storage cleanup |

---

## Key Files

| File | Purpose |
|------|---------|
| **Pages** | |
| `apps/dashboard/src/App.jsx` | Root — auth gate, StoreProvider, ToastProvider, 5-tab nav, store switcher, cross-tab navigation |
| `apps/dashboard/src/pages/Overview.jsx` | Proposal queue + pipeline + meta panel + ShopifyServices |
| `apps/dashboard/src/pages/Shopify.jsx` | Shopify analytics dashboard + bulk pricing |
| `apps/dashboard/src/pages/Studio.jsx` | Branded + product creative generation |
| `apps/dashboard/src/pages/Products.jsx` | Paginated product grid with filters, sort, search, sync, view modes (grid/list/cards) |
| `apps/dashboard/src/pages/ProductWorkspace.jsx` | Per-product workspace: creatives by style, generate image/video, optimize, size chart, product detail/editor |
| `apps/dashboard/src/pages/Profit.jsx` | P&L dashboard: revenue, returns, COGS, shipping, per-gateway fees, adspend, profit + accuracy indicators + CSV export |
| `apps/dashboard/src/pages/Login.jsx` | Password gate login screen |
| **Components** | |
| `apps/dashboard/src/components/OptimizePanel.jsx` | Product optimizer: AI rewrite review + approve/reject/save draft |
| `apps/dashboard/src/components/GeneratePanel.jsx` | Creative generation (image + video modes, style/subject/text overlay/count) |
| `apps/dashboard/src/components/CreativeEditor.jsx` | Creative review: preview, edit, approve, reject, convert to video |
| `apps/dashboard/src/components/ImportModal.jsx` | 4-step product import wizard (scrape URL → preview → import → done) |
| `apps/dashboard/src/components/SizeChartEditor.jsx` | Size chart: read/edit/import from image (Claude Vision) → Shopify metafield |
| `apps/dashboard/src/components/ProductDetail.jsx` | Full product detail + inline editor (all Shopify fields) |
| `apps/dashboard/src/components/TagInput.jsx` | Tag chips input (add/remove tags) |
| `apps/dashboard/src/components/VariantEditor.jsx` | Variant table (read-only or editable: price, SKU, compare_at) |
| `apps/dashboard/src/components/ImageManager.jsx` | Image gallery with reorder/delete |
| `apps/dashboard/src/components/MetafieldEditor.jsx` | Key-value metafield editor |
| `apps/dashboard/src/components/ApprovalQueue.jsx` | Pending creatives queue |
| `apps/dashboard/src/components/ProposalCard.jsx` | Event proposal cards (approve/dismiss) grouped by severity |
| `apps/dashboard/src/components/ShopifyDashboard.jsx` | Full Shopify analytics (KPIs, chart, products, traffic, orders) |
| `apps/dashboard/src/components/ShopifyPanel.jsx` | Compact Shopify KPIs + top products + orders (used in Overview) |
| `apps/dashboard/src/components/ShopifyServices.jsx` | Service status grid at bottom of Overview |
| `apps/dashboard/src/components/MetaPanel.jsx` | Meta Ads KPIs + campaigns (shows "not connected" placeholder) |
| `apps/dashboard/src/components/TerminalLog.jsx` | Pipeline activity log with smart date formatting |
| `apps/dashboard/src/components/Breadcrumbs.jsx` | Navigation breadcrumbs |
| `apps/dashboard/src/components/Skeleton.jsx` | Skeleton loaders (SkeletonGrid, SkeletonKPI, SkeletonRow, SkeletonChart) |
| `apps/dashboard/src/components/Tooltip.jsx` | Info tooltip component |
| **Hooks** | |
| `apps/dashboard/src/hooks/useActiveStore.jsx` | StoreContext + StoreProvider, localStorage persistence |
| `apps/dashboard/src/hooks/useToast.jsx` | Toast provider with success/error/info types |
| `apps/dashboard/src/hooks/useShopifyOverview.js` | Fetch Shopify analytics (60s client cache TTL) |
| `apps/dashboard/src/hooks/useProposals.js` | Fetch proposals (cached + Supabase Realtime) |
| `apps/dashboard/src/hooks/useInsights.js` | Fetch action cards data |
| `apps/dashboard/src/hooks/useMetaOverview.js` | Fetch Meta Ads data |
| `apps/dashboard/src/hooks/useProfit.js` | Fetch P&L data |
| **Libs (frontend)** | |
| `apps/dashboard/src/lib/api.js` | All API fetch functions (25+), auth token handling, `getProducts()` (paginated), `getAllProducts()` (full list) |
| `apps/dashboard/src/lib/supabase.js` | Supabase client for realtime subscriptions |
| **Libs (backend)** | |
| `lib/claude.js` | Claude API wrapper + dynamic per-store brand system prompt from `store_skills` + `optimizeProduct()` |
| `lib/higgsfield.js` | Higgsfield image/video generation + styled prompts (7 styles) + per-store brand context + feedback learning |
| `lib/shopify-admin.js` | Shopify Admin REST API: `createShopifyClient(url, token)` factory, read (orders, products, traffic, customers) + write (updateProduct, updateVariant, updateProductOptions, bulkUpdateVariantPrices) |
| `lib/meta-api.js` | Meta Marketing API: read-only (insights, campaigns, active ads) |
| `lib/supabase.js` | Supabase server-side client (service role) |
| `lib/scraper-utils.js` | Product scraping + hook/headline generation |
| `lib/store-context.js` | `getStore(id)`, `getAllStores()`, `hasAdminAccess(store)` |
| `lib/auth.js` | Password-based HMAC token verification, `withAuth(handler)` wrapper |
| `lib/rate-limit.js` | Supabase-backed async rate limiter (persists across Vercel cold starts) |
| `lib/event-detector.js` | Shared event detection logic: `detectEventsForStore()` — used by cron + scan_events |
| `lib/fal.js` | fal.ai image generation API (FLUX.2, Ideogram v3) — alternative to Higgsfield |
| **API Endpoints** | |
| `api/system.js` | Consolidated mega-handler (~1600 lines, 15+ actions): stores_list, pipeline_log, kpi, profit_summary (per-store, shipping, returns, per-gateway fees), proposals, events, scan_events, optimizations, update_creative, update_cogs, manual_adspend, generate_branded, bulk_price, cleanup_stale, import_confirm |
| `api/auth/login.js` | Password authentication → session token |
| `api/creatives/generate.js` | Generate image creative via Higgsfield |
| `api/creatives/regenerate.js` | Regenerate image or video creative |
| `api/creatives/convert-to-video.js` | Convert image creative to video (DOP Turbo) |
| `api/creatives/list.js` | List creatives (filter by status, product_id, store_id, type) |
| `api/ads/action.js` | Approve/reject/pause creatives |
| `api/shopify/overview.js` | Shopify analytics: KPIs, daily revenue, top products, traffic, orders |
| `api/meta/overview.js` | Meta Ads overview |
| `api/products/list.js` | Paginated products with creative counts (page, limit params) |
| `api/products/sync.js` | Sync products from Shopify |
| `api/cron/detect-events.js` | Event detection cron (every 6h): scans for actionable events → creates proposals |
| **Product Knowledge** | |
| `.claude/skills/elara.md` | Elara bikini: personas, hooks, visual direction |
| `.claude/skills/mathilda.md` | Mathilda pants: personas, hooks, visual direction |
| `.claude/skills/isola.md` | Isola swimwear brand knowledge |

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `stores` | Multi-store config: shopify_url, admin_token, storefront_token, brand_config JSONB |
| `products` | Shopify products (synced) + `cogs` + `store_id` FK |
| `creatives` | Generated ad creatives (image/video), status: generating/pending/approved/rejected, `store_id` FK |
| `events` | Detected events (product_no_creatives, revenue_declining, winner_detected) |
| `proposals` | Actionable proposals from events, status: pending/approved/dismissed |
| `product_optimizations` | AI optimization proposals: pending/approved/rejected with original + optimized JSONB |
| `pipeline_log` | All agent/system activity log with `store_id` |
| `manual_adspend` | Manual ad spend entries (TikTok, Pinterest, other) |
| `ads` | Meta ads with campaign_id, meta_ad_id, budget, targeting |
| `performance` | Daily ad metrics from Meta |
| `briefs` | SCRAPER output (product hooks, headlines, visual refs) |
| `winner_refs` | LOOPER feedback (winning hooks/headlines for FORGE) |
| `product_docs` | Per-product document uploads (future) |
| `rate_limits` | Persistent rate limiting (key + created_at), indexed by key+time |

---

## Env Vars

```
APP_PASSWORD=***                 # Dashboard login password
HF_CREDENTIALS=***              # Higgsfield API key
SUPABASE_URL=***                # Supabase project URL
SUPABASE_ANON_KEY=***           # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=***   # Supabase service role
VITE_SUPABASE_URL=***           # Frontend Supabase URL
VITE_SUPABASE_ANON_KEY=***      # Frontend Supabase anon key
SHOPIFY_STORE_URL=***           # Default store (Elegance House)
SHOPIFY_ACCESS_TOKEN=***        # Default storefront token
SHOPIFY_ADMIN_TOKEN=***         # Default admin token
ANTHROPIC_API_KEY=***           # Claude API for Product Optimizer
SITE_URL=***

META_APP_ID=                    # EMPTY — awaiting setup
META_APP_SECRET=                # EMPTY
META_ACCESS_TOKEN=              # EMPTY
META_AD_ACCOUNT_ID=             # EMPTY
```

---

## Key Dependencies

- `@anthropic-ai/sdk` — Claude API for product optimization
- `@higgsfield/client` — Higgsfield image/video generation (manual polling for Nano Banana)
- `@supabase/supabase-js` — Database + auth + storage + realtime
- `cheerio` — HTML scraping for product data extraction
- `dompurify` — Safe HTML rendering in OptimizePanel
- `vitest` (dev) — Test framework

---

## Important Patterns

### Multi-Store Data Isolation
Every query filters by `store_id`. Frontend passes active store ID to all API calls. Store switcher in header changes context for entire dashboard. `stores_list` API strips `admin_token` and returns `has_admin` boolean instead.

### Auth Flow
Password gate → `api/auth/login.js` → HMAC session token → stored in localStorage → `withAuth()` middleware validates on every API call. No Supabase Auth for dashboard users.

### Brand Voice (Dynamic Per-Store)
`lib/claude.js` builds system prompt dynamically: loads brand-voice skill from `store_skills` table → falls back to generic prompt with store name. No hardcoded brand references. Store name and vendor injected into optimization prompt from `stores` table.

### P&L (Per-Store)
`profit_summary` action accepts `store_id` query param → creates per-store Shopify client. P&L includes: Revenue - Returns - COGS - Shipping - Adspend - Transaction Fees = Profit. Transaction fees are per-gateway from `stores.brand_config.payment_fees`. Shipping parsed from Shopify `shipping_lines`. Returns from `refunds[].transactions[].amount`. Accuracy indicators in UI show tracking status.

### Rate Limiting
Async, Supabase-backed (`rate_limits` table). Persists across Vercel cold starts. Fails open on DB error. All callers use `await rateLimit(...)`.

### Event → Proposal System
Cron (every 6h) → `detect-events.js` scans for actionable events → creates proposals → Overview shows proposal queue with Approve/Dismiss/Approve All. Event types: `product_no_creatives`, `revenue_declining`, `winner_detected`. Core detection logic shared via `lib/event-detector.js`.

### Product Optimizer Approval Workflow
```
Optimize → saves to DB (status: pending) → appears in Overview
  → Review & Edit → Save Draft (still pending)
  → Approve & Push → writes to Shopify → status: approved
  → Reject → status: rejected → never touches Shopify
```
**Nothing pushes to Shopify without explicit approval** (except product import — direct create is allowed).

### Creative Generation (Image + Video)
- Image: Higgsfield Nano Banana (text2image) with manual polling (SDK's withPolling broken)
- Video: DOP Turbo (image2video) — requires source image
- 7 style variants: ad_creative, product_shot, lifestyle, review_ugc, static_clean, static_split, static_urgency
- Per-store brand context from `stores.brand_config` JSONB
- Feedback learning from approved/rejected creatives

### Shopify API
- REST API v2024-01 (not GraphQL)
- `createShopifyClient(url, token)` factory pattern — returns object with all methods
- MUST use `{handle}.myshopify.com` URLs, not custom domains
- Default client exported for backward compat

### Pagination (Products)
- API: `page` + `limit` query params, returns `{ products, total, page, pages }`
- Frontend: Products.jsx loads 50/page with "Load more" button
- Other pages (Studio, Profit, Shopify) use `getAllProducts()` which fetches up to 200

### Product Import
Paste competitor URL → scrape → preview/edit → create in Shopify (direct, no approval) → auto-optimize (pending approval) → auto-generate creatives. Collection URLs scrape multiple products for batch import.

### Size Chart
CSV-format metafield (`custom.size_chart_text`) in Shopify. Two input methods: manual table editor or image upload → Claude Vision extraction. Write via Shopify metafield API.

### Product Editor (Direct Write)
Product edit writes to Shopify immediately (no approval queue). Unlike Optimizer which goes through pending → approve flow. All changes logged to pipeline_log with before/after audit trail.

### Vercel Hobby Limits
- Max 12 serverless functions → consolidated into `api/system.js` mega-handler
- 1 cron/day schedule → running every 6h via `0 */6 * * *`
- 60s timeout → fire-and-forget for long operations

---

## App Flow

```
Dashboard → Password gate (Login.jsx)
  → Authenticated → Store selector (3 stores)
    → 5 tabs:
    │
    ├── Overview
    │   ├── Proposal Queue (events → approve/dismiss/approve all)
    │   ├── Scan Now button (manual event detection)
    │   ├── ApprovalQueue (pending creatives)
    │   ├── TerminalLog (pipeline activity)
    │   ├── MetaPanel (not connected / campaigns)
    │   └── ShopifyServices grid
    │
    ├── Shopify
    │   ├── ShopifyDashboard: KPIs, revenue chart, top products, traffic, orders
    │   └── Pricing: bulk price editor (collection filter, search, checkboxes, apply)
    │
    ├── Studio
    │   ├── Branded Content: type/prompt/style/model/count → generate
    │   └── Product Creatives: product picker → GeneratePanel → gallery (images/videos)
    │
    ├── Products
    │   ├── Paginated grid (50/page, load more, 3 view modes, filters, sort, sync, import)
    │   ├── [Import] → ImportModal (scrape URL → preview/edit → create in Shopify → auto-optimize + auto-generate)
    │   └── → ProductWorkspace (per product)
    │       ├── [+ Image] → GeneratePanel → Higgsfield
    │       ├── [▶ Video] → GeneratePanel (video mode) → DOP Turbo
    │       ├── [✨ Optimize] → OptimizePanel → Claude AI → approval workflow
    │       ├── [Studio →] → navigates to Studio with product pre-selected
    │       ├── Creative grid by style (generating/pending/approved)
    │       ├── Size Chart (read/edit table + import from image via Claude Vision → Shopify metafield)
    │       └── Product Detail + Editor (all Shopify fields, inline edit, direct save)
    │
    └── Profit
        ├── KPIs: Revenue, COGS, Adspend, Profit, ROAS
        ├── Daily P&L table (7d/14d/30d)
        ├── COGS management (per product)
        ├── Manual adspend (TikTok, Pinterest)
        ├── CSV export
        └── Storage cleanup (stale creatives)
```

---

## Known Tech Debt & Planned Work

| Priority | Item | Notes |
|----------|------|-------|
| 🟡 MED | Meta Ads integration — awaiting credentials | When ready |
| 🟡 MED | Product docs drag & drop upload (Supabase Storage) | Future |
| 🟡 MED | Product Optimizer — auto-detect unoptimized imports | Future |
| 🟡 MED | system.js is ~1600 lines | Could split into router + modules, but Vercel 12-route limit makes consolidation intentional |
| 🟢 LOW | PUBLISHER agent (auto-publish to Meta) | Future |
| 🟢 LOW | LOOPER agent (performance scoring feedback loop) | Future |
| 🟢 LOW | TikTok/Pinterest API integration (replace manual adspend) | Future |
| 🟢 LOW | Full mobile responsive design | Partial — basic responsive exists |

---

## Dev Commands

```bash
# Frontend (Vite)
cd apps/dashboard && npm run dev     # http://localhost:5173

# Backend (Vercel)
vercel dev                           # API + frontend together

# Install dependencies
npm install --legacy-peer-deps       # always use --legacy-peer-deps

# Build
cd apps/dashboard && npm run build   # production build

# Tests
npm test                             # Vitest — auth, rate-limit, profit, system-routing
```

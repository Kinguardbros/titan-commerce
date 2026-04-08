# CLAUDE.md — elegancehouse-ads

> **Rule:** After every major change (new file, new screen/component, dependency add/remove, architecture change, new pattern, app flow change) **update this CLAUDE.md** to reflect the current project state. Specifically check and update: Key Files table, Key Dependencies, Important Patterns, App Flow, and Known Tech Debt. Do this automatically at the end of implementation — don't wait for the user to ask.

---

## Project Overview

SaaS dashboard for e-commerce ad creative management. Generates AI ad creatives (image + video), optimizes product listings with AI, tracks Shopify analytics and profit, and integrates with Meta Ads. Built for **Elegance House** (women's fashion, EU store, EUR currency) with multi-store architecture planned for Sprint 4.

---

## Architecture

- **Framework:** React + Vite (frontend dashboard)
- **Deployment:** Vercel Serverless Functions (API layer)
- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **AI — Images/Video:** Higgsfield (Nano Banana for images, DOP Turbo for video)
- **AI — Text:** Anthropic Claude API (claude-sonnet-4-20250514) for product optimization
- **E-commerce:** Shopify Admin API (REST, v2024-01)
- **Ads:** Meta Marketing API (v21.0) — read-only, awaiting credentials
- **Payments:** RevenueCat (planned, not yet integrated)

---

## Language Rules

- **UI text:** English
- **Code, comments, variable names:** English
- **DEVELOPER-BRIEF.md:** Czech (team language)
- **This file:** English

---

## Coding Style & Conventions

### General
- Vercel serverless: `export default handler`, max 60s timeout (use 55s safe limit)
- Supabase server-side: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`
- Frontend API: all calls through `lib/api.js` (`fetchJSON` wrapper)
- `npm install` always with `--legacy-peer-deps` (Higgsfield peer dep conflict)
- Currency: **EUR** (not USD)

### Frontend
- Functional components only, hooks order: `useState → useRef → useEffect → custom → callbacks → render`
- CSS: dark theme, CSS variables (`--gold`, `--emerald`, `--coral`, `--azure`, `--violet`, `--surface`, `--deep`, `--edge`), fonts `--display` (serif), `--sans`, `--mono`
- No chart libraries — use pure CSS bars for charts
- HTML in descriptions: sanitize with DOMPurify before rendering

### Backend
- Error handling: `try/catch` everywhere, structured logging: `console.error('[Module] Description:', { context })`
- Pipeline activity → `pipeline_log` table (agent, message, level, metadata)
- Shopify writes: always log to pipeline_log before and after
- Claude API responses must be parseable JSON — use system prompt with clear JSON instruction

---

## Don't Rules

1. **Don't push to Shopify without approval** — Product Optimizer saves to DB as `pending`, only `approve_optimization` writes to Shopify
2. **Don't install new dependencies** without asking first
3. **Don't use chart libraries** — CSS bars for all charts
4. **Don't hardcode store-specific data** — multi-store is coming in Sprint 4
5. **Don't make files longer than ~300 lines** — extract hooks, utils, sub-components
6. **Don't swallow errors** — `catch (e) {}` is forbidden
7. **Don't use `npm install` without `--legacy-peer-deps`**

---

## App Structure

### Tabs: Overview | Shopify | Products | Profit

| Tab | Page | Purpose |
|-----|------|---------|
| Overview | `Overview.jsx` | Action cards (Action Needed, Declining, Winners) + Pending Optimizations + Pipeline (ApprovalQueue + TerminalLog) + Meta panel |
| Shopify | `Shopify.jsx` | Full analytics: KPIs (Revenue/Orders/AOV/Sessions/Conv%), revenue chart, top products with creative count, traffic sources, recent orders |
| Products | `Products.jsx` → `ProductWorkspace.jsx` | Product grid → per-product creative management (generate image/video, optimize listing) |
| Profit | `Profit.jsx` | P&L dashboard: daily revenue/COGS/adspend/fees/profit, COGS management, manual adspend, CSV export |

---

## Key Files

| File | Purpose |
|------|---------|
| **Pages** | |
| `apps/dashboard/src/App.jsx` | Root — 4-tab navigation, cross-tab product navigation |
| `apps/dashboard/src/pages/Overview.jsx` | Action cards (insights) + pending optimizations + pipeline |
| `apps/dashboard/src/pages/Shopify.jsx` | Shopify analytics dashboard |
| `apps/dashboard/src/pages/Products.jsx` | Product grid with filters and Shopify sync |
| `apps/dashboard/src/pages/ProductWorkspace.jsx` | Per-product workspace: creatives, video, optimize |
| `apps/dashboard/src/pages/Profit.jsx` | P&L dashboard with COGS and manual adspend |
| **Components** | |
| `apps/dashboard/src/components/OptimizePanel.jsx` | Product optimizer: AI rewrite review + approve/reject |
| `apps/dashboard/src/components/GeneratePanel.jsx` | Creative generation (image + video modes) |
| `apps/dashboard/src/components/CreativeEditor.jsx` | Creative review: preview, edit, approve, reject, convert to video |
| `apps/dashboard/src/components/ApprovalQueue.jsx` | Pending creatives queue |
| `apps/dashboard/src/components/ShopifyPanel.jsx` | Shopify KPIs + top products + orders (used in Overview) |
| `apps/dashboard/src/components/MetaPanel.jsx` | Meta Ads KPIs + campaigns (shows "not connected" placeholder) |
| `apps/dashboard/src/components/TerminalLog.jsx` | Pipeline activity log with smart date formatting |
| **Hooks** | |
| `apps/dashboard/src/hooks/useShopifyOverview.js` | Fetch Shopify analytics data |
| `apps/dashboard/src/hooks/useMetaOverview.js` | Fetch Meta Ads data |
| `apps/dashboard/src/hooks/useInsights.js` | Fetch action cards data (action_needed, declining, winners) |
| `apps/dashboard/src/hooks/useProfit.js` | Fetch P&L data |
| **Libs (frontend)** | |
| `apps/dashboard/src/lib/api.js` | All API fetch functions (20+) |
| `apps/dashboard/src/lib/supabase.js` | Supabase client for realtime subscriptions |
| **Libs (backend)** | |
| `lib/claude.js` | Claude API wrapper + brand system prompt + `optimizeProduct()` |
| `lib/higgsfield.js` | Higgsfield image/video generation + styled prompts (7 styles) |
| `lib/shopify-admin.js` | Shopify Admin REST API: read (orders, products, traffic) + write (updateProduct, updateVariant, updateProductOptions) |
| `lib/meta-api.js` | Meta Marketing API: read-only (insights, campaigns, active ads) |
| `lib/supabase.js` | Supabase server-side client (service role) |
| `lib/scraper-utils.js` | Product scraping + hook/headline generation |
| **API Endpoints** | |
| `api/system.js` | Consolidated endpoint: pipeline_log, kpi, profit_summary, update_cogs, manual_adspend, optimize_product, approve/reject/save/pending_optimizations |
| `api/creatives/generate.js` | Generate image creative via Higgsfield |
| `api/creatives/regenerate.js` | Regenerate image or video creative |
| `api/creatives/convert-to-video.js` | Convert image creative to video (DOP Turbo) |
| `api/creatives/list.js` | List creatives (filter by status, product_id) |
| `api/ads/action.js` | Approve/reject/pause creatives |
| `api/shopify/overview.js` | Shopify analytics: KPIs, daily revenue, top products with creative count, traffic, orders |
| `api/meta/overview.js` | Meta Ads overview (returns "not connected" if no credentials) |
| `api/products/list.js` | Products with creative counts |
| `api/products/sync.js` | Sync products from Shopify |
| `api/insights/actions.js` | Cross-query: products × creatives × orders → action cards |
| **Agent Specs** | |
| `agents/scraper.md` | SCRAPER agent spec |
| `agents/forge.md` | FORGE agent spec |
| `agents/publisher.md` | PUBLISHER agent spec (not implemented) |
| `agents/looper.md` | LOOPER agent spec (not implemented) |
| **Product Knowledge** | |
| `.claude/skills/elara.md` | Elara bikini: personas, hooks, visual direction |
| `.claude/skills/mathilda.md` | Mathilda pants: personas, hooks, visual direction |
| **Docs** | |
| `Docs/Products/Elara USA/` | Elara research docs (avatar sheets, winning hooks, deep research) |
| `Docs/Products/MATHILDA/` | Mathilda research docs |
| `skills/` | Dev/design skills for system development |

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `products` | Shopify products (synced) + `cogs` column for cost tracking |
| `creatives` | Generated ad creatives (image/video), status: pending/approved/rejected/published |
| `ads` | Meta ads with campaign_id, meta_ad_id, budget, targeting |
| `performance` | Daily ad metrics from Meta (spend, revenue, ROAS, CTR, CPC) |
| `briefs` | SCRAPER output (product hooks, headlines, visual refs) |
| `winner_refs` | LOOPER feedback (winning hooks/headlines for FORGE) |
| `pipeline_log` | All agent/system activity log |
| `manual_adspend` | Manual ad spend entries (TikTok, Pinterest, other) |
| `product_optimizations` | AI optimization proposals: pending/approved/rejected with original + optimized JSONB |
| `product_docs` | Per-product document uploads (future: drag & drop) |

---

## Env Vars

```
HF_CREDENTIALS=***              # Higgsfield API key
SUPABASE_URL=***                # Supabase project URL
SUPABASE_ANON_KEY=***           # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=***   # Supabase service role
VITE_SUPABASE_URL=***           # Frontend Supabase URL
VITE_SUPABASE_ANON_KEY=***      # Frontend Supabase anon key
SHOPIFY_STORE_URL=***           # shop-elegancehouse.com
SHOPIFY_ACCESS_TOKEN=***        # Storefront token (products only)
SHOPIFY_ADMIN_TOKEN=***         # Admin API (read_orders, read_products, read_customers, read_analytics, write_products)
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
- `@higgsfield/client` — Higgsfield image/video generation
- `@supabase/supabase-js` — Database + auth + storage + realtime
- `cheerio` — HTML scraping for product data extraction
- `dompurify` — Safe HTML rendering in OptimizePanel

---

## Important Patterns

### Product Optimizer Approval Workflow
```
Optimize → saves to DB (status: pending) → appears in Overview
  → Review & Edit → Save Draft (still pending)
  → Approve & Push → writes to Shopify → status: approved
  → Reject → status: rejected → never touches Shopify
```
**Nothing pushes to Shopify without explicit approval.**

### Creative Generation (Image + Video)
- Image: Higgsfield Nano Banana (text2image)
- Video: DOP Turbo (image2video) — requires source image
- Two-step due to Vercel 60s timeout: generate image → convert to video in separate request
- 7 style variants: ad_creative, product_shot, lifestyle, review_ugc, static_clean, static_split, static_urgency

### Shopify API
- REST API v2024-01 (not GraphQL)
- Read: orders, products, traffic sources via `lib/shopify-admin.js`
- Write: updateProduct, updateVariant, updateProductOptions
- `shopifyREST()` supports GET/PUT/POST

### Overview Action Cards
- 🔴 Action Needed: products selling but with 0 creatives
- 📉 Declining: products with revenue drop > 10%
- 🏆 Winners: products with revenue up > 15%
- ✨ Pending Optimizations: product optimizations awaiting approval
- Cross-query: Shopify orders × Supabase products × creatives

### Variant Standardization
- Sizes: S, M, L, XL, XXL, 2XL, 3XL
- Colors: English, capitalized (Black, Navy, Beige, White...)
- Option labels: "Size" and "Color" (standardized from any language)

---

## App Flow

```
Dashboard → 4 tabs
├── Overview
│   ├── ✨ Pending Optimizations → [Review] → Products tab
│   ├── 🔴 Action Needed → [Generate Creatives] → Products tab
│   ├── 📉 Declining → [Try Different Style] → Products tab
│   ├── 🏆 Winners → [Generate More] → Products tab
│   ├── ApprovalQueue (pending creatives)
│   ├── TerminalLog (pipeline activity)
│   └── MetaPanel (not connected / campaigns)
│
├── Shopify
│   ├── KPIs: Revenue, Orders, AOV, Sessions, Conv%
│   ├── Revenue bar chart (daily, 7d/30d/90d)
│   ├── Top Products (with creative count per product)
│   ├── Traffic Sources
│   └── Recent Orders
│
├── Products
│   ├── Product grid (search, filter, sort, sync)
│   └── → ProductWorkspace (per product)
│       ├── [+ Image] → GeneratePanel → Higgsfield
│       ├── [▶ Video] → GeneratePanel (video mode) → DOP Turbo
│       ├── [✨ Optimize] → OptimizePanel → Claude AI
│       │   ├── Review original vs optimized
│       │   ├── Edit any field (title, description, SEO, tags, variants)
│       │   ├── Save Draft / Re-generate / Reject
│       │   └── Approve & Push → writes to Shopify
│       └── Creative grid (pending/approved, image/video)
│
└── Profit
    ├── KPIs: Revenue, COGS, Adspend, Profit, ROAS
    ├── Daily P&L table
    ├── COGS management (per product)
    ├── Manual adspend (TikTok, Pinterest)
    └── CSV export
```

---

## Known Tech Debt & Planned Work

| Priority | Item | Sprint |
|----------|------|--------|
| 🟡 MED | Meta Ads integration — awaiting credentials | When ready |
| 🟡 MED | Product docs drag & drop upload (Supabase Storage: `product-docs/{handle}/`) | Sprint 4 |
| 🔴 HIGH | Multi-store architecture (stores table, store_id FK, store switcher) | Sprint 4 |
| 🟡 MED | Kiwi Size Guide integration (size chart per product) | Sprint 4+ |
| 🟡 MED | Product Optimizer — auto-detect unoptimized imports | Future |
| 🟢 LOW | PUBLISHER agent (auto-publish to Meta) | Future |
| 🟢 LOW | LOOPER agent (performance scoring feedback loop) | Future |
| 🟢 LOW | TikTok/Pinterest API integration (replace manual adspend) | Future |

---

## Dev Commands

```bash
# Frontend (Vite)
cd apps/dashboard && npm run dev     # http://localhost:5173

# Backend (Vercel)
vercel dev                           # or however backend is started

# Install dependencies
npm install --legacy-peer-deps       # always use --legacy-peer-deps
```

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
- **AI — Images/Video (primary):** fal.ai — Nano Banana 2 / Nano Banana Pro for images (`/edit` variants, fire-and-forget polling), plus FLUX.2 edit, FLUX Kontext, Ideogram v3. **`resolution: "2K"` is forced for Nano Banana** (its default is 1K — too soft for product photos).
- **AI — Images/Video (fallback / legacy):** Higgsfield — Soul / Soul Reference (`/v1/text2image/soul`) for text-to-image, Flux Kontext Max, DOP Turbo (`dop-turbo`) for video. Used when fal.ai isn't a fit (e.g. no reference image → HF Flux Kontext Max).
- **AI — Text:** Anthropic Claude API (`claude-sonnet-4-20250514`) for product optimization, product-skill auto-generation, Claude Vision (size chart parsing, style analysis)
- **E-commerce:** Shopify Admin API (REST v2024-01 + some GraphQL Admin v2024-01) — MUST use `{handle}.myshopify.com` URLs (not custom domains)
- **Ads:** Meta Marketing API (v21.0) — read-only, awaiting credentials
- **Auth:** Password-based session tokens (`APP_PASSWORD` env var), `withAuth()` middleware on all endpoints
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
- Pipeline activity → `pipeline_log` table (agent, message, level, metadata). Agent names in use: `OPTIMIZER`, `IMPORTER`, `PRICING`, `CLEANUP`, `AUTH`, `SKILL_GEN`, `STYLE_GEN`, `SCRAPER`, `FORGE`, `PUBLISHER`, `LOOPER`, `AVATAR`, `EDITOR`, `SIZE_CHART`, `DOC_PROCESSOR`, `REVIEWS`, `AGENT` (proposals)
- Shopify writes: always log to pipeline_log before and after
- Rate limiting via `lib/rate-limit.js` (Supabase-backed, async): generate 20/hr, video 10/hr, optimize 30/hr, import_reviews_csv 20/hr
- Vercel 12-route limit: consolidated endpoints in `api/system.js` thin router (~114 lines) → 64 actions across 17 modules in `lib/actions/`, dispatched by `?action=X` (GET) or `{ action }` body (POST). Errors are sanitized (strip API keys, DB strings) before returning to the client.

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
| Products | `Products.jsx` → `ProductWorkspace.jsx` | Paginated product grid (50/page, load more, filters, sort, search, sync, import, 3 view modes) → per-product workspace (creatives by style via `CreativeStudio`, optimize via `OptimizePanel`, PhotoStory via `PhotoStoryModal`, size chart, full product detail + editor) |
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
| `Login.jsx` | Password gate login screen |
| **Components** (`apps/dashboard/src/components/`) | |
| `CreativeStudio.jsx` | Main creative generation UI — style picker (incl. `product-catalog`, v2–v8 variants, `realistic-beach`, `cs_*` custom), model picker (Nano Banana 2/Pro, FLUX.2, Ideogram, Kontext), pose/framing/model presets (catalog only), A/B mode, color variant, audience. v8 adds Fill intensity pill row (Light/Medium/Strong → backend `v8_fill_intensity`). ⚠️ large file. |
| `CreativeDetailModal.jsx` | Full-screen creative review: preview, edit, approve, reject, convert to video, push to Shopify |
| `CreativeEditor.jsx` | Inline creative review (preview, edit, approve, reject) |
| `GeneratePanel.jsx` | Older creative gen panel (image + video modes) — still used in some flows |
| `PhotoStoryModal.jsx` | Photo Story Studio — generates one of 3 multi-shot sets via `storyMode` toggle: BEACH (lifestyle, outdoor with `STORY_SHOTS`), STUDIO (clean white backdrop e-commerce angles with `STUDIO_SHOTS`), CELESTE (close-up studio with warm peach/cream backdrop, intimate apparel style with `CELESTE_SHOTS`). Prompts in `lib/photo-story-prompts.js` |
| `OptimizePanel.jsx` | Product optimizer: AI rewrite review + approve/reject/save draft |
| `ReviewsPanel.jsx` + `ReviewDetail.jsx` + `ImportReviews.jsx` | Product reviews manager modal (opened from ProductWorkspace topbar): summary header, reviews table, editable detail panel (`ReviewDetail`). Phase 1 = manual add/edit/approve/reject/delete + verified toggle + photo_url preview. Phase 3 = **Import** button → `ImportReviews` sub-modal (paste CSV, upload .csv/.xlsx parsed in-browser via `xlsx`/SheetJS, or paste a Google Sheets link) → rows import as `pending`. `ImportReviews` is `React.lazy` so xlsx loads only when import is opened. No AI generation, photo upload, or Shopify push yet (later phases). |
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
| `TerminalLog.jsx` | Pipeline activity log with smart date formatting |
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
| `fal.js` | fal.ai image generation — `generateFal()`, `submitFalJob()` (fire-and-forget), `checkFalJob()` (poll). `buildFalBody()` per-model bodies; **forces `resolution: "2K"` for Nano Banana**. |
| `shopify-admin.js` | Shopify Admin REST API: `createShopifyClient(url, token)` factory, read (orders, products, traffic, customers) + write (updateProduct, updateVariant, updateProductOptions, bulkUpdateVariantPrices) |
| `meta-api.js` | Meta Marketing API: read-only (insights, campaigns, active ads) |
| `supabase.js` | Supabase server-side client (service role) |
| `scraper-utils.js` | Product scraping + hook/headline generation |
| `store-context.js` | `getStore(id)`, `getAllStores()`, `hasAdminAccess(store)` |
| `auth.js` | Password-based HMAC token verification, `withAuth(handler)` wrapper |
| `rate-limit.js` | Supabase-backed async rate limiter (persists across Vercel cold starts, fails open) |
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
| `stores.js` | `stores_list` (strips admin_token) |
| `pipeline.js` | `pipeline_log` |
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
| `webhooks.js` | `register_webhooks`, `list_webhooks`, `unregister_webhooks` |
| `reviews.js` | `product_reviews_list`, `add_review_manual`, `update_review`, `delete_review`, `set_review_status` (Phase 1 manual) + `import_reviews_csv` (Phase 3 bulk: own CSV parser, or fetches a Google Sheets CSV export server-side; all rows insert as `pending`/`source='csv'`, rate-limited 20/hr). No outbound push yet. |
| **API endpoints** (`api/`) — 12 routes (Vercel Hobby limit) | |
| `system.js` | Thin router (~114 lines) — delegates 64 actions to 17 modules in `lib/actions/` |
| `auth/login.js` | Password authentication → session token |
| `auth/shopify.js` | Shopify OAuth callback (HMAC is **hex** here — not base64 like webhooks) |
| `creatives/generate.js` | Generate image creative (routes by `ai_model` → fal.ai Nano Banana / FLUX / Ideogram, or Higgsfield Soul/Flux Kontext). Contains the standalone **Product Catalog v1 / v2 / v3 / v4 / v5 / v6 / v7** and **Realistic Beach** prompt blocks. v4 + v5 + v6 + v7 import their respective `V4_PROMPT_BODY` / `V5_PROMPT_BODY` / `V6_PROMPT_BODY` / `V7_PROMPT_BODY` and wrap them with reference-roles prefix + product title + conditional HIGH-WAIST navel-hide block. ⚠️ large file, churned heavily — read git history before changing. |
| `creatives/regenerate.js` | Regenerate image or video creative |
| `creatives/convert-to-video.js` | Convert image creative to video (Higgsfield DOP Turbo) |
| `creatives/list.js` | List creatives (filter by status, product_id, store_id, type) |
| `ads/action.js` | Approve/reject/pause creatives |
| `shopify/overview.js` | Shopify analytics: KPIs, daily revenue, top products, traffic, orders |
| `meta/overview.js` | Meta Ads overview (placeholder until credentials) |
| `products/list.js` | Paginated products with creative/published counts + audiences (`page`, `limit`, `show_archived` params). Returns only `active` (or `status IS NULL`) unless `show_archived=true`. |
| `webhooks/shopify.js` | Shopify webhook receiver (products/create, update, delete). Raw body + **base64** HMAC verify against `stores.client_secret`. `bodyParser: false`. |
| `cron/detect-events.js` | Event detection cron (daily at 08:00 UTC, `0 8 * * *`): scans for actionable events → creates proposals |
| **Agents** (`agents/`) — pipeline agent specs (not all wired yet) | |
| `scraper.md` | SCRAPER: URL scraping → structured ad briefs for FORGE |
| `forge.md` | FORGE: ad creative generation from briefs |
| `publisher.md` | PUBLISHER: push approved creatives to Meta Ads (future) |
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
| `stores` | Multi-store config: shopify_url, admin_token, storefront_token, client_secret (OAuth), currency, name, vendor, `brand_config` JSONB (payment_fees, transaction_fee_pct, logos, etc.) |
| `products` | Shopify products (synced): handle, title, price, images JSONB, `tags` JSONB (= collection memberships, set by full sync only), `product_type`, `vendor`, `status` (active/archived), `cogs`, `has_size_chart`, `garment_length` (text, `'short' \| 'mid' \| 'long' \| NULL` — populated lazily by Claude Vision on the first v1 generation, cached forever), `store_id` FK |
| `creatives` | Generated ad creatives (image/video): file_url, storage_path, format, status (generating/pending/approved/rejected/published/failed), `metadata` JSONB (style, audience, model, hook_used, poll info), `product_id`, `story_id`, `store_id` FK |
| `store_skills` | Compiled per-store knowledge: `skill_type` (brand-voice, audience-personas, product-{slug}, custom-style-{slug}, ...), title, content, `metadata` JSONB. Used by `lib/claude.js` (brand voice) and `lib/higgsfield.js` (`cs_` custom styles). `UNIQUE(store_id, skill_type)`. |
| `store_knowledge` | Raw extracted insights from uploaded store docs (category, insights, processed_at) — fallback when no compiled skill exists |
| `persona_avatars` | Per-persona reference images for model consistency: persona_name, label, age, description, reference_url, `variants` JSONB, is_active. `UNIQUE(store_id, persona_name)`. |
| `product_optimizations` | AI optimization proposals: pending/approved/rejected with `original` + `optimized` JSONB |
| `product_reviews` | Per-product reviews: author, rating (1–5 CHECK), title, body, `photo_url`, `verified`, `review_date`, `source` (manual/csv/ai), `status` (pending/approved/published/rejected), `dirty` (published+edited → awaits re-push), `store_id` + `product_id` FK (product CASCADE). RLS: authenticated SELECT, service-role writes. Phase 1 = manual dashboard entry only. |
| `events` | Detected events (product_no_creatives, revenue_declining, winner_detected) |
| `proposals` | Actionable proposals from events: pending/approved/dismissed |
| `pipeline_log` | All agent/system activity (agent, message, level, metadata, `store_id`) |
| `manual_adspend` | Manual ad spend entries (TikTok, Pinterest, other) |
| `ads` | Meta ads with campaign_id, meta_ad_id, budget, targeting |
| `performance` | Daily ad metrics from Meta |
| `briefs` | SCRAPER output (product hooks, headlines, visual refs) |
| `winner_refs` | LOOPER feedback (winning hooks/headlines for FORGE) |
| `product_docs` | Per-product document uploads (future) |
| `rate_limits` | Persistent rate limiting (key + created_at), indexed by key+time |

### RLS & migrations
- All tables have RLS enabled (`sql/enable-rls-all.sql`). Service-role bypasses RLS — backend uses service role.
- Migrations are individual `sql/*.sql` files (run in order in Supabase SQL Editor). `sql/schema.sql` is the original base; the `add-*.sql` files layer on top.
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
```

---

## Key Dependencies

Root `package.json` (backend / serverless):
- `@anthropic-ai/sdk` — Claude API
- `@higgsfield/client` — Higgsfield image/video (manual polling)
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
Password gate → `api/auth/login.js` → HMAC session token (with `expires`) → stored in localStorage `auth_token` → `withAuth()` middleware validates on every API call. No Supabase Auth for dashboard users.

### Brand Voice (Dynamic Per-Store)
`lib/claude.js` builds the system prompt dynamically: loads `brand-voice` skill from `store_skills` → falls back to generic prompt + store name. No hardcoded brand references. Store name/vendor injected from `stores` table. Product-specific knowledge loaded from `store_skills` (`product-{slug}`) when a product name is available; auto-generated from product photos via Claude Vision if missing.

### Creative Generation — Model Routing (`api/creatives/generate.js`)
- `ai_model` key from frontend → resolved to provider:
  - `fal_nano_banana` / `fal_nano_banana_pro` → fal.ai `fal-ai/nano-banana-2/edit` / `fal-ai/nano-banana-pro/edit` (fire-and-forget). If no reference image → falls back to Higgsfield Flux Kontext Max (synchronous text-to-image).
  - `fal_flux2_edit` / `fal_flux2_pro_edit` / `fal_ideogram_bg` / `fal_ideogram_edit` / `fal_flux_kontext` → fal.ai (fire-and-forget)
  - `flux_kontext` → Higgsfield Flux Kontext Max, fallback fal.ai FLUX.2 edit
  - `soul` / `soul_ref` → Higgsfield Soul / Soul Reference
- **`resolution: "2K"` is forced for Nano Banana** in `lib/fal.js` (default is 1K — too soft for product photos)
- Fire-and-forget: creative row created as `generating`, `requestId`/`pollBase`/`model` stored in `metadata`; `poll_generations` action checks pending jobs and finalizes them (with one retry on failure for fal.ai jobs)

### Creative Styles
- Built-in (`lib/higgsfield.js` `STYLE_PROMPTS`): `ad_creative`, `product_shot`, `product_photo_beach`, `lifestyle`, `review_ugc`, `static_clean`, `static_split`, `static_urgency` (+ `branded_*` for branded content)
- Standalone styles handled directly in `api/creatives/generate.js` (bypass `buildStyledPrompt`): **`product_catalog`** (v1, e-commerce swimwear — model preset + pose + framing pills, beach setting; post-processed via `processCatalogImage`), **`product_catalog_v2`** (single-shot, model + pose pills, no framing/beach), **`product_catalog_v3`** (2-step pipeline: studio shot via Nano Banana Pro → beach BG swap via Ideogram replace-background), **`product_catalog_v4`** (editorial-strobe prompt from `lib/v4-prompt.js`, bright midday daylight + neutral grading + frontal flat lighting, minimal UI: Reference model + Resolution + Count only), **`product_catalog_v5`** (variant of v4 with warm post-sunset afterglow background — neutral subject for product pop, same minimal UI), **`product_catalog_v6`** (variant of v5 with bright midday daylight + vivid turquoise ocean + bright blue sky background — same lighting on subject as v5), **`product_catalog_v7`** (variant of v5 with soft warm afterglow + balanced exposure — visible warm tones, natural-feeling lighting, between v5 dim and v6 vivid), **`product_catalog_v8`** (color-aware lighting — same body shell as v7 but LIGHTING + DO NOT GENERATE blocks are templated per detected color class. Dark fabrics get a subtle off-axis fill to reveal construction detail, solid pastels/brights get an even gentler fill for dimension, print/patterned products get the v7 flat-frontal lighting verbatim. Auto-detection: `variant > title` precedence via `detectV8ColorClass` in `lib/v8-prompt.js`. User-controlled `v8_fill_intensity` UI preset (light/medium/strong) governs fill strength. Minimal UI: Reference model + Fill intensity pills + Resolution + Count.), **`product_catalog_v9`** (clean monolithic prompt rebuild of v1 in the v7/v8 style — bright sunny beach background, frontal softbox lighting, 3/4-body crop via ALWAYS/NEVER MID-CALF wording. Avatar required, no model description fallback. Minimal UI: Reference model + Resolution + Count. Prompt is one string from `lib/v9-prompt.js`, no template placeholders.), **`product_catalog_v10`** (clone of v9 with v1's verbatim LIGHTING block + GARMENT-specific lighting paragraph swapped in — same SETTING/EXPOSURE/FRAMING as v9, but the lighting wording is v1's longer 'FRONTAL SOFTBOX + SIDE FILL + THE GARMENT' paragraph) and **`realistic_beach`** (ultra-real curvy model, bright daylight, bypasses audience/age/tummy/skill systems). All catalog v1/v2/v3/v4/v5/v6/v7/v8/v9/v10 use the `[avatar, productPhoto, avatar]` sandwich; Isola always-on for HIGH-WAIST navel-hide block via `catalogHighWaist`. v1 is post-processed (brightness lift); v2-v10 outputs go straight to Storage.
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
Cron (daily 08:00 UTC) → `detect-events.js` → `detectEventsForStore()` scans for actionable events → creates proposals → Cockpit shows queue (Approve / Dismiss / Approve All + Scan Now). Event types: `product_no_creatives`, `revenue_declining`, `winner_detected`. Detection logic shared via `lib/event-detector.js`.

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
- Max 12 serverless functions → route budget: `system.js`, `auth/login.js`, `auth/shopify.js`, `creatives/generate.js`, `creatives/regenerate.js`, `creatives/convert-to-video.js`, `creatives/list.js`, `ads/action.js`, `shopify/overview.js`, `meta/overview.js`, `products/list.js`, `webhooks/shopify.js`, `cron/detect-events.js` — `api/system.js` absorbs everything else as `?action=X`
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
    │       ├── [Reviews] → ReviewsPanel (modal) → manual add/edit/approve/reject/delete reviews + [Import] (CSV paste / .csv·.xlsx upload / Google Sheets link → pending). No push yet.
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
| 🟢 LOW | PUBLISHER agent (auto-publish to Meta) / LOOPER agent (performance scoring loop) | Future |
| 🟢 LOW | TikTok/Pinterest API integration (replace manual adspend) | Future |
| 🟢 LOW | Full mobile responsive design | Partial |
| 🟢 LOW | `getAllProducts` caps at 200 | Filters/search incomplete for stores >200 products (none currently) |

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
npm test                             # Vitest — auth, rate-limit, profit, system-routing (27 tests)
```

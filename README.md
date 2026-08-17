# Titan Commerce

Multi-store SaaS dashboard for e-commerce ad creative management. Generates AI ad creatives, optimizes product listings, tracks Shopify analytics and profit, manages branded content.

## Stores

| Store | Market | Currency |
|-------|--------|----------|
| **Elegance House** | Women's fashion, EU | EUR |
| **Isola** | Swimwear, US | USD |
| **Eleganz Haus** | Fashion, DE | EUR |

## Tech Stack

- **Frontend:** React 19 + Vite
- **Backend:** Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL + Auth + Storage + Realtime)
- **AI Images/Video:** Higgsfield (Nano Banana, DOP Turbo) + fal.ai
- **AI Text:** Anthropic Claude API (product optimization)
- **E-commerce:** Shopify Admin REST API (v2024-01)
- **Ads:** Meta Marketing API (v21.0)
- **Design System:** Nextbyte Dark Luxe

## Quickstart

```bash
# Install
npm install --legacy-peer-deps
cd apps/dashboard && npm install && cd ../..

# Environment
cp .env.example .env.local
# Fill in Supabase, Shopify, Anthropic, Higgsfield credentials

# Database
# Run sql/schema.sql + migration files in Supabase SQL Editor

# Run locally
npm run dev          # Frontend (Vite, localhost:5173)
vercel dev           # Full stack (API + frontend)

# Build
cd apps/dashboard && npm run build

# Tests
npm test             # Vitest
```

## CI

`.github/workflows/ci.yml` runs two parallel jobs on every push + PR to `main`:

- **backend-tests** — `npm ci --legacy-peer-deps` + `npm test` (root vitest suite, 383+ tests)
- **frontend-build** — `cd apps/dashboard && npm ci && npm run build`

Both are cached on their respective `package-lock.json` hashes.

**This does not gate Vercel deploys.** `vercel.json`'s `buildCommand` only runs the frontend
build — it never ran the backend test suite, so `git push` to `main` deploys to production
regardless of whether the tests pass (P1-22, `Docs/AUDIT-2026-08.md`). This workflow gives
visibility (a red/green check on the commit) without blocking anything.

**Follow-up, not done here:** to actually block a bad deploy, enable "Wait for CI to pass" in
the Vercel project's Git settings (Project Settings > Git). That's per-project Vercel dashboard
config, not something a repo file can turn on — do this once CI has proven stable for a while.

**Optional local gate:** `bash scripts/setup-git-hooks.sh` installs a `pre-push` git hook that
runs `npm test` before every push from that clone (bypass once with `git push --no-verify`).
Opt-in per clone, not installed automatically.

## Project Structure

```
titan-commerce/
├── CLAUDE.md                  # Project source of truth (architecture, conventions, schema)
├── apps/dashboard/src/        # React frontend
│   ├── pages/                 # Overview, Shopify, Studio, Products, Profit, Login
│   ├── components/            # UI components (25+)
│   ├── hooks/                 # Data hooks (useProfit, useProposals, useActiveStore, ...)
│   └── lib/                   # API client, Supabase realtime
├── api/                       # Vercel serverless endpoints (12 routes)
│   ├── system.js              # Consolidated mega-handler (37 actions)
│   ├── creatives/             # Generate, regenerate, convert-to-video, list
│   ├── products/              # List, sync
│   ├── shopify/               # Analytics overview
│   └── cron/                  # Event detection (every 6h)
├── lib/                       # Shared backend logic
│   ├── claude.js              # AI product optimization
│   ├── higgsfield.js          # AI image/video generation
│   ├── shopify-admin.js       # Shopify API client factory
│   └── ...                    # Auth, rate-limit, scraper, meta-api
├── agents/                    # Pipeline agent specs (SCRAPER, FORGE, PUBLISHER, LOOPER)
├── sql/                       # Database migrations (19 files)
├── Docs/                      # Documentation
│   ├── Sprints/               # Sprint plans + developer briefs
│   ├── Briefs/                # Task specifications (light theme, UX, ...)
│   ├── Architecture/          # Platform review, AD pipeline PRD
│   └── Stores/                # Per-store materials (brand, products, creative, logos)
└── skills/nextbyte-design/    # Design system specification + tokens
```

## Documentation

| Document | Purpose |
|----------|---------|
| **CLAUDE.md** | Complete project reference — architecture, key files, database schema, env vars, coding conventions, app flow |
| **Docs/Sprints/** | Active sprint plans and developer briefs |
| **Docs/Architecture/** | Platform review, ad pipeline PRD |
| **Docs/Briefs/** | Task specifications (light theme redesign, UX/responsive, manager prompt) |
| **Docs/Stores/** | Per-store brand materials, product research, logos, creative playbooks |
| **agents/** | Pipeline agent specifications (Scraper, Forge, Publisher, Looper) |

## Key Features

- **AI Creative Generation** — 7+ styles (ad_creative, lifestyle, UGC, beach, ...), per-product prompt specialization, brand knowledge injection
- **Product Import Pipeline** — Scrape competitor URL > preview > create in Shopify > AI optimize > auto-generate creatives
- **Product Optimizer** — Claude AI rewrites listings with per-store brand voice, approval workflow before Shopify push
- **Profit Dashboard** — Revenue, COGS, shipping, returns, per-gateway transaction fees, adspend, profit
- **Event Detection** — Automated proposals (product needs creatives, revenue declining, winner detected)
- **Multi-Store** — Complete data isolation via `store_id`, store switcher, per-store Shopify credentials

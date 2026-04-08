# Elegance House — Ad Pipeline

Automated ad creative pipeline for [shop-elegancehouse.com](https://shop-elegancehouse.com). Generates, publishes, and optimizes Meta ad creatives using AI.

## Pipeline

```
SCRAPER → FORGE → PUBLISHER → LOOPER → (back to FORGE)
```

| Agent | Role |
|-------|------|
| **SCRAPER** | Scrapes product pages, extracts copy hooks and briefs |
| **FORGE** | Generates ad creatives via Higgsfield AI |
| **PUBLISHER** | Pushes approved creatives to Meta Ads |
| **LOOPER** | Scores live ads, feeds winners back to FORGE |

## Quickstart

```bash
# 1. Clone and install
git clone https://github.com/danielnecas/elegancehouse-ads.git
cd elegancehouse-ads
npm install --legacy-peer-deps
cd apps/dashboard && npm install && cd ../..

# 2. Set up environment
cp .env.example .env.local
# Fill in your Supabase, Meta, and Higgsfield credentials

# 3. Create database
# Copy sql/schema.sql and run in Supabase SQL Editor

# 4. Run locally
npm run dev

# 5. Deploy
npx vercel --prod
```

## Project Structure

```
elegancehouse-ads/
├── apps/dashboard/        # React + Vite dashboard (War Room)
│   └── src/
│       ├── components/    # KPIRow, AdGrid, AdCard, DetailPanel, etc.
│       ├── pages/         # Overview (main page)
│       ├── hooks/         # useAds, useKPIs
│       └── lib/           # Supabase client, API helpers, mock data
├── api/                   # Vercel serverless functions
│   ├── ads/               # list, approve, pause
│   ├── kpi/               # summary
│   └── pipeline/          # log
├── lib/                   # Shared server-side logic
│   └── supabase.js        # Server Supabase client
├── agents/                # Agent specifications (MD)
├── sql/                   # Database schema
├── vercel.json            # Vercel config + cron
└── package.json
```

## Environment Variables

See `.env.example` for all required variables. Key services:

- **Supabase** — Database, auth, storage
- **Higgsfield** — AI image/video generation
- **Meta Marketing API** — Ad publishing and insights

## Dashboard

The War Room dashboard at `elegancehouse-ads.vercel.app` shows:

- KPI cards (spend, revenue, impressions, conversions, active ads)
- Ad grid with real-time agent status
- Approval queue for pending creatives
- 7-day performance chart
- Agent terminal log
- Detail panel with recommendations

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL)
- **AI Generation:** Higgsfield (Nano Banana Pro)
- **Ad Platform:** Meta Marketing API

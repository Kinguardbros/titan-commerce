# ELEGANCE HOUSE — Ad Pipeline PRD

> Blueprint pro implementaci v Claude Code
> Verze: 1.0 · Datum: 2. dubna 2026

---

## 1. Přehled projektu

### Co stavíme
Automatizovaný pipeline pro generování, publikaci a optimalizaci Meta reklamních kreativ pro **shop-elegancehouse.com** (US store, ženy 35–60, elegantní oblečení $50–120).

### Pipeline flow
```
SCRAPER → FORGE → PUBLISHER → LOOPER → (zpět do FORGE)
   ↓         ↓          ↓           ↓
  Briefs   Kreativy   Meta Ads   Performance data
```

### Klíčové technologie
- **Runtime:** Node.js (Vercel serverless)
- **Frontend:** React + Vite (dashboard)
- **Image gen:** Higgsfield API (`@higgsfield/client`)
- **Ad delivery:** Meta Marketing API
- **Backend:** Supabase (PostgreSQL + Storage + Auth)
- **Deployment:** Vercel
- **Repo:** GitHub (danielnecas/elegancehouse-ads)

---

## 2. Tým a role

| Osoba | Role | Co dělá |
|-------|------|---------|
| Daniel | Tech lead | Implementace v Claude Code, deployment, API integrace, debugging |
| Člen 2 | Creative / Marketing | Schvaluje kreativy v dashboardu, nastavuje brand guidelines, píše copy hooks |
| Člen 3 | Creative / Marketing | Monitoruje výkon v dashboardu, navrhuje audience targeting, reportuje výsledky |

### Přístup pro netechnické členy
Dashboard běží na Vercel URL — stačí prohlížeč. Žádná instalace. Schvalování kreativ = kliknutí v UI.

---

## 3. Architektura

```
elegancehouse-ads/
├── apps/
│   └── dashboard/              # React + Vite frontend
│       ├── src/
│       │   ├── components/
│       │   │   ├── AdGrid.jsx
│       │   │   ├── AdCard.jsx
│       │   │   ├── DetailPanel.jsx
│       │   │   ├── KPIRow.jsx
│       │   │   ├── AgentSidebar.jsx
│       │   │   ├── PerfChart.jsx
│       │   │   ├── TerminalLog.jsx
│       │   │   ├── FilterChips.jsx
│       │   │   └── ApprovalQueue.jsx   # Pro kreativce — schválení/zamítnutí
│       │   ├── pages/
│       │   │   ├── Overview.jsx
│       │   │   ├── Campaigns.jsx
│       │   │   ├── Creatives.jsx
│       │   │   └── Agents.jsx
│       │   ├── hooks/
│       │   │   ├── useAds.js
│       │   │   ├── useKPIs.js
│       │   │   └── useWebSocket.js     # Live updates
│       │   ├── lib/
│       │   │   └── api.js
│       │   ├── App.jsx
│       │   └── main.jsx
│       ├── index.html
│       ├── vite.config.js
│       └── package.json
│
├── api/                        # Vercel serverless functions
│   ├── agents/
│   │   ├── scraper.js          # POST /api/agents/scraper
│   │   ├── forge.js            # POST /api/agents/forge
│   │   ├── publisher.js        # POST /api/agents/publisher
│   │   └── looper.js           # POST /api/agents/looper (+ cron trigger)
│   ├── ads/
│   │   ├── list.js             # GET  /api/ads
│   │   ├── [id].js             # GET  /api/ads/:id
│   │   ├── approve.js          # POST /api/ads/approve
│   │   └── pause.js            # POST /api/ads/pause
│   ├── kpi/
│   │   └── summary.js          # GET  /api/kpi/summary
│   ├── pipeline/
│   │   ├── run.js              # POST /api/pipeline/run  (spustí celý cyklus)
│   │   ├── status.js           # GET  /api/pipeline/status
│   │   └── log.js              # GET  /api/pipeline/log
│   └── cron/
│       └── looper-check.js     # Vercel Cron — každých 6h
│
├── lib/                        # Sdílená logika
│   ├── supabase.js             # Supabase klient (DB + Storage + Auth)
│   ├── higgsfield.js           # Higgsfield SDK wrapper
│   ├── meta-api.js             # Meta Marketing API wrapper
│   ├── scraper-utils.js        # Cheerio + fetch pro scraping
│   ├── scoring.js              # LOOPER scoring rubric
│   └── logger.js               # Structured logging
│
├── agents/                     # Agent skill definitions (MD soubory)
│   ├── scraper.md
│   ├── forge.md
│   ├── publisher.md
│   └── looper.md
│
├── sql/
│   └── schema.sql              # DB migrace
│
├── .env.example
├── vercel.json
├── package.json
└── README.md
```

---

## 4. Environment proměnné

Vytvoř `.env.local` a nastav ve Vercel dashboard:

```env
# Higgsfield (Cloud API — cloud.higgsfield.ai/api-keys)
# Formát: HF_CREDENTIALS="api_key_id:api_key_secret"
# ⚠️ Po prvním zobrazení se secret už nedá znovu načíst — ulož bezpečně!
HF_CREDENTIALS=tvuj_key_id:tvuj_key_secret

# Meta Marketing API
META_APP_ID=xxxxx
META_APP_SECRET=xxxxx
META_ACCESS_TOKEN=xxxxx
META_AD_ACCOUNT_ID=act_xxxxx

# Supabase
SUPABASE_URL=https://ercrkgfihqgrbkkqnoqy.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...        # veřejný klíč (pro frontend) — najdeš v Settings → API
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci... # tajný klíč (pro serverové funkce — NIKDY na frontendu!)

# App
SITE_URL=https://shop-elegancehouse.com
NEXT_PUBLIC_APP_URL=https://elegancehouse-ads.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://ercrkgfihqgrbkkqnoqy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

---

## 5. Databázové schéma

```sql
-- Briefy ze SCRAPERu
CREATE TABLE briefs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name  TEXT NOT NULL,
    product_url   TEXT NOT NULL,
    price         TEXT,
    hooks         JSONB NOT NULL,        -- string[]
    headlines     JSONB NOT NULL,        -- string[]
    visual_refs   JSONB NOT NULL,        -- string[]
    tone          TEXT,
    brief_text    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Kreativy z FORGE
CREATE TABLE creatives (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id      UUID REFERENCES briefs(id),
    variant_index INTEGER NOT NULL,
    format        TEXT NOT NULL CHECK (format IN ('image', 'video')),
    file_url      TEXT NOT NULL,         -- Higgsfield output URL
    storage_path  TEXT,                  -- Supabase Storage path (creatives/{id}.jpg)
    hook_used     TEXT,
    headline      TEXT,
    hf_job_id     TEXT,                  -- Higgsfield request ID
    status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'published')),
    approved_by   TEXT,                  -- Jméno člena týmu
    approved_at   TIMESTAMPTZ,
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Ads na Meta (PUBLISHER)
CREATE TABLE ads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id   UUID REFERENCES creatives(id),
    meta_ad_id    TEXT UNIQUE,
    meta_adset_id TEXT,
    campaign_id   TEXT NOT NULL,
    status        TEXT DEFAULT 'learning' CHECK (status IN ('active', 'paused', 'learning', 'ended', 'rejected')),
    daily_budget  NUMERIC(10,2) DEFAULT 50.00,
    objective     TEXT,
    targeting     JSONB,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Performance data (LOOPER)
CREATE TABLE performance (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_id         UUID REFERENCES ads(id),
    meta_ad_id    TEXT NOT NULL,
    date          DATE NOT NULL,
    spend         NUMERIC(10,2),
    revenue       NUMERIC(10,2),
    impressions   INTEGER,
    clicks        INTEGER,
    conversions   INTEGER,
    roas          NUMERIC(6,2),
    ctr           NUMERIC(6,3),
    cpc           NUMERIC(10,2),
    score         NUMERIC(4,2),          -- Composite score z LOOPERu
    is_winner     BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(meta_ad_id, date)
);

-- Winner reference prompty (LOOPER → FORGE)
CREATE TABLE winner_refs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_ad_id  UUID REFERENCES ads(id),
    hook          TEXT NOT NULL,
    headline      TEXT,
    visual_notes  TEXT,
    roas          NUMERIC(6,2),
    ctr           NUMERIC(6,3),
    brief_addendum TEXT,
    used          BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Pipeline log (pro terminal v dashboardu)
CREATE TABLE pipeline_log (
    id            SERIAL PRIMARY KEY,
    agent         TEXT NOT NULL CHECK (agent IN ('SCRAPER', 'FORGE', 'PUBLISHER', 'LOOPER')),
    message       TEXT NOT NULL,
    level         TEXT DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexy
CREATE INDEX idx_creatives_status ON creatives(status);
CREATE INDEX idx_ads_status ON ads(status);
CREATE INDEX idx_performance_date ON performance(date);
CREATE INDEX idx_pipeline_log_created ON pipeline_log(created_at DESC);
```

---

## 6. Agent specifikace

### 6.1 SCRAPER (Step 1)

**Endpoint:** `POST /api/agents/scraper`

**Input:**
```json
{
  "urls": ["https://shop-elegancehouse.com/products/silk-blouse"],
  "brand_context": "Elegant, timeless women's fashion. Warm and sophisticated tone.",
  "max_hooks": 5
}
```

**Co dělá:**
1. Fetch každý URL přes `fetch()` (nebo Cheerio pro parsing)
2. Extrahuje: product name, price, features, image alt-texts
3. Generuje copy hooks a headlines (může volat Claude API pro lepší hooks)
4. Uloží brief do tabulky `briefs`
5. Zapíše log do `pipeline_log`
6. Vrátí `brief_id`

**Klíčové pravidlo:** Nikdy nevymýšlej data — pouze extrahuj, co je na stránce.

**Implementace (`lib/scraper-utils.js`):**
```javascript
import * as cheerio from 'cheerio';

export async function scrapeProduct(url) {
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);

  return {
    product_name: $('h1.product-title, h1').first().text().trim(),
    price: $('.product-price, .price').first().text().trim(),
    description: $('.product-description, .rte').text().trim(),
    image_alts: $('img[alt]').map((_, el) => $(el).attr('alt')).get(),
    features: $('.product-features li, .product-detail li').map((_, el) => $(el).text().trim()).get(),
    meta_description: $('meta[name="description"]').attr('content') || '',
  };
}
```

---

### 6.2 FORGE (Step 2)

**Endpoint:** `POST /api/agents/forge`

**Input:**
```json
{
  "brief_id": "uuid",
  "winner_refs": [],
  "variants": 4,
  "format": "image"
}
```

**Co dělá:**
1. Načte brief z DB (nebo winner_refs pokud existují)
2. Sestaví prompt pro Higgsfield — kombinuje hook, headline, vizuální reference, brand tone
3. Volá Higgsfield API přes `@higgsfield/client`
4. Uloží výstupy do tabulky `creatives` se statusem `pending`
5. Zapíše log

**Higgsfield integrace (`lib/higgsfield.js`):**
```javascript
import { higgsfield } from '@higgsfield/client/v2';

// Credentials se čtou automaticky z HF_CREDENTIALS env

export async function generateImage({ prompt, aspectRatio = '1:1', resolution = '2K' }) {
  const jobSet = await higgsfield.subscribe('nano-banana/pro/text-to-image', {
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      resolution,
      safety_tolerance: 2,
    },
    withPolling: true,
  });

  if (jobSet.isCompleted) {
    return {
      url: jobSet.jobs[0].results?.raw?.url,
      jobId: jobSet.jobs[0].id,
    };
  }
  throw new Error('Higgsfield generation failed');
}

export async function generateVideo({ prompt, imageUrl }) {
  const jobSet = await higgsfield.subscribe('/v1/image2video/dop', {
    input: {
      model: 'dop-turbo',
      prompt,
      input_images: [{ type: 'image_url', image_url: imageUrl }],
    },
    withPolling: true,
  });

  if (jobSet.isCompleted) {
    return {
      url: jobSet.jobs[0].results?.raw?.url,
      jobId: jobSet.jobs[0].id,
    };
  }
  throw new Error('Higgsfield video generation failed');
}
```

**Prompt template pro reklamní kreativy:**
```
Product photography for elegant women's fashion e-commerce ad.

Product: {product_name}
Price: {price}
Headline: {headline}
Hook: {hook}

Style: Cinematic lighting, warm gold tones (#d4a853), clean white/cream
background, professional studio photography. Model: woman 35-55,
confident, sophisticated. Brand colors: gold #d4a853, cream #f5f0e8.

{visual_refs}

Output: Campaign-ready Meta ad creative, 1080x1080 for feed,
no text overlay (text added in post), photorealistic quality.
```

**Pravidla:**
- Vždy generuj min. 2 varianty
- Winner refs z LOOPERu mají přednost před baseline briefem
- Pokud Higgsfield vrátí error → retry 1×, pak loguj a skip
- Pro AWARENESS objective → preferuj video formát

---

### 6.3 PUBLISHER (Step 3)

**Endpoint:** `POST /api/agents/publisher`

**Input:**
```json
{
  "creative_id": "uuid",
  "campaign_id": "meta_campaign_id",
  "ad_set_config": {
    "daily_budget": 50,
    "optimization_event": "PURCHASE",
    "audience": "lookalike_1pct",
    "placement": "automatic"
  }
}
```

**Co dělá:**
1. Ověří, že kreativa má `status: approved`
2. Upload kreativy na Meta přes Marketing API
3. Vytvoří/aktualizuje ad set
4. Publikuje ad
5. Zapíše `meta_ad_id` zpět do DB
6. Změní status kreativy na `published`

**Meta API wrapper (`lib/meta-api.js`):**
```javascript
const META_BASE = 'https://graph.facebook.com/v21.0';

export async function uploadImage(imageUrl, adAccountId) {
  const resp = await fetch(`${META_BASE}/${adAccountId}/adimages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: process.env.META_ACCESS_TOKEN,
      url: imageUrl,
    }),
  });
  return resp.json();
}

export async function createAd({ adSetId, creativePayload, name }) {
  const resp = await fetch(`${META_BASE}/${process.env.META_AD_ACCOUNT_ID}/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: process.env.META_ACCESS_TOKEN,
      name,
      adset_id: adSetId,
      creative: creativePayload,
      status: 'ACTIVE',
    }),
  });
  return resp.json();
}

export async function pauseAd(adId) {
  const resp = await fetch(`${META_BASE}/${adId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: process.env.META_ACCESS_TOKEN,
      status: 'PAUSED',
    }),
  });
  return resp.json();
}
```

**Ad Set defaults:**
| Parametr | Hodnota |
|----------|---------|
| Daily budget | $50 |
| Optimalizace | Conversions (Purchase) |
| Audience | Lookalike 1% |
| Placement | Automatic |
| Attribution | 7-day click, 1-day view |

**Pravidla:**
- NIKDY nepublikuj kreativu bez `approved: true`
- Nikdy neměň targeting live kampaně bez explicitní instrukce
- Pokud Meta vrátí policy rejection → přesuň kreativu do `rejected` statusu
- Nikdy nemaz ad sety — pouze pausuj
- Loguj budget změny s before/after hodnotami

---

### 6.4 LOOPER (Step 4)

**Endpoint:** `POST /api/agents/looper` + Vercel Cron

**Cron konfigurace (vercel.json):**
```json
{
  "crons": [
    {
      "path": "/api/cron/looper-check",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**Co dělá:**
1. Stáhne performance data z Meta Insights API pro všechny aktivní ads
2. Spočítá composite score: `(ROAS_norm × 0.5) + (CTR_norm × 0.3) + (CPC_norm × 0.2)`
3. Score ≥ 0.75 → **Winner** — vytvoří reference prompt a pošle do `winner_refs`
4. Score ≤ 0.35 → **Flag** — pošle pause instrukci PUBLISHERu
5. Uloží performance data do `performance` tabulky

**Scoring (`lib/scoring.js`):**
```javascript
export function scoreAd({ roas, ctr, cpc, categoryBenchmarkCpc = 1.20 }) {
  // Normalize each metric to 0-1 range
  const roasNorm = Math.min(roas / 6.0, 1);          // 6.0× = perfect score
  const ctrNorm = Math.min(ctr / 5.0, 1);             // 5.0% = perfect score
  const cpcNorm = Math.min(categoryBenchmarkCpc / Math.max(cpc, 0.01), 1);  // Lower = better

  const score = (roasNorm * 0.5) + (ctrNorm * 0.3) + (cpcNorm * 0.2);

  return {
    score: Math.round(score * 100) / 100,
    isWinner: score >= 0.75,
    isFlagged: score <= 0.35,
    breakdown: { roasNorm, ctrNorm, cpcNorm },
  };
}
```

**Pravidla:**
- Nikdy neskoruj ad v prvních 3 hodinách po publikaci
- Ads ve stavu `learning` jsou vyloučené ze scoringu
- Winner prompt musí obsahovat verbatim hook text — nepřepisuj
- Nepausuj ads přímo — pošli instrukci PUBLISHERu s důvodem
- Pokud ROAS klesne o 30%+ week-over-week na dříve winning ad → flagni i přes dobrý aktuální score
- Loguj každý cyklus: timestamp, kolik ads vyhodnoceno, kolik winnerů, kolik flagů

---

## 7. Dashboard — klíčové komponenty

Dashboard vychází z War Room HTML prototypu (přiložen). Přepiš do React komponent.

### ApprovalQueue (nová — pro kreativce)
```
/creatives?status=pending → zobrazí grid čekajících kreativ
Každá karta: náhled obrázku, hook, headline, brief info
Tlačítka: ✅ Approve / ❌ Reject
Po kliknutí → POST /api/ads/approve nebo PATCH status na rejected
```

Toto je **hlavní UI pro netechnické členy týmu**. Musí být jednoduchý a mobilně responsivní.

### Realtime updates
Pipeline log a KPI změny přes polling (GET /api/pipeline/log každých 5s) nebo Vercel Realtime (pokud bude k dispozici). WebSocket není nutný pro MVP — polling stačí.

---

## 8. Vercel konfigurace

**vercel.json:**
```json
{
  "buildCommand": "cd apps/dashboard && npm run build",
  "outputDirectory": "apps/dashboard/dist",
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" },
    { "source": "/(.*)", "destination": "/apps/dashboard/dist/index.html" }
  ],
  "crons": [
    {
      "path": "/api/cron/looper-check",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**package.json (root):**
```json
{
  "name": "elegancehouse-ads",
  "private": true,
  "scripts": {
    "dev": "cd apps/dashboard && npm run dev",
    "build": "cd apps/dashboard && npm run build",
    "db:migrate": "npx supabase db push"
  },
  "dependencies": {
    "@higgsfield/client": "latest",
    "@supabase/supabase-js": "latest",
    "cheerio": "^1.0.0"
  }
}
```

---

## 9. Implementační fáze

### Fáze 1 — Základ (den 1–2)
1. `npm create vite@latest apps/dashboard -- --template react`
2. Nastav Vercel projekt + GitHub repo
3. Vytvoř Supabase projekt (supabase.com) + spusť schema.sql v SQL Editoru
4. Vytvoř Supabase Storage bucket `creatives` (public)
5. Přepiš War Room HTML do React komponent
6. Implementuj API routes pro `GET /api/ads`, `GET /api/kpi/summary`, `GET /api/pipeline/log`
7. Deploy na Vercel — ověř, že dashboard funguje s mock daty

### Fáze 2 — SCRAPER + FORGE (den 3–4)
1. Implementuj `POST /api/agents/scraper` — scraping shop-elegancehouse.com
2. Otestuj na 5–10 produktových URL
3. Nastav Higgsfield credentials
4. Implementuj `POST /api/agents/forge` — generování kreativ
5. Propoj ApprovalQueue v dashboardu — kreativy se zobrazí ke schválení
6. Otestuj celý flow: URL → brief → kreativy → pending v dashboardu

### Fáze 3 — PUBLISHER + Meta (den 5–6)
1. Vytvoř Meta App v Business Manager
2. Získej Access Token s permissions: `ads_management`, `ads_read`
3. Implementuj `POST /api/agents/publisher`
4. Otestuj publish flow: approved kreativa → live ad na Meta
5. Ověř, že meta_ad_id se správně zapisuje zpět

### Fáze 4 — LOOPER + feedback loop (den 7)
1. Implementuj `POST /api/agents/looper`
2. Nastav Vercel Cron
3. Otestuj scoring s reálnými daty z Meta Insights
4. Ověř, že winner_refs se zapisují a FORGE je používá
5. End-to-end test: celý cyklus SCRAPER → FORGE → PUBLISHER → LOOPER → FORGE

### Fáze 5 — Polish + team handoff (den 8)
1. Mobile responsivita dashboardu
2. ApprovalQueue notifikace (Slack webhook pro tým)
3. Error handling a retry logika
4. Dokumentace pro kreativce — jak schvalovat, jak číst dashboard
5. Sdílení Vercel URL s týmem

---

## 10. Příkazy pro Claude Code

### Inicializace projektu
```bash
mkdir elegancehouse-ads && cd elegancehouse-ads
npm init -y
npm install @higgsfield/client @supabase/supabase-js cheerio
npm create vite@latest apps/dashboard -- --template react
cd apps/dashboard && npm install @supabase/supabase-js
cd ../..
git init && git remote add origin https://github.com/danielnecas/elegancehouse-ads.git
```

### Higgsfield test
```bash
export HF_CREDENTIALS="tvuj_key:tvuj_secret"
node -e "
  const { higgsfield } = require('@higgsfield/client/v2');
  higgsfield.subscribe('nano-banana/pro/text-to-image', {
    input: { prompt: 'Elegant women fashion ad, studio lighting, gold tones', resolution: '2K', aspect_ratio: '1:1' },
    withPolling: true
  }).then(r => console.log(r.jobs[0].results?.raw?.url));
"
```

### Deploy
```bash
npx vercel --prod
```

---

## 11. Bezpečnost

- API klíče NIKDY v kódu — vždy env proměnné
- `SUPABASE_SERVICE_ROLE_KEY` NIKDY na frontendu — pouze v serverových funkcích
- Na frontendu používej pouze `SUPABASE_ANON_KEY` + Row Level Security (RLS)
- Meta Access Token má expiraci — nastav long-lived token nebo token refresh
- Dashboard auth přes Supabase Auth — tvoji kolegové se přihlásí emailem/heslem
- Rate limiting na API routes — Higgsfield i Meta mají limity
- Higgsfield: sleduj credit balance přes dashboard

---

## 12. Metriky úspěchu

| Metrika | Cíl |
|---------|-----|
| Kreativy vygenerované / den | 20+ |
| Čas od briefu po live ad | < 2 hodiny (s approval) |
| Winner rate (score ≥ 0.75) | > 25% |
| Průměrný ROAS | ≥ 3.5× |
| Průměrný CTR | ≥ 3.0% |
| Manuální práce / cyklus | 0 (kromě approval) |

---

## 13. Přiložené soubory

- `elegancehouse-warroom.html` — Interaktivní dashboard prototyp (single-file HTML)
- `scraper.md` — Agent skill specifikace: SCRAPER
- `forge.md` — Agent skill specifikace: FORGE
- `publisher.md` — Agent skill specifikace: PUBLISHER
- `looper.md` — Agent skill specifikace: LOOPER

Tyto `.md` soubory vlož do `agents/` složky v repu — Claude Code je může použít jako kontextové dokumenty při implementaci jednotlivých agentů.

---

## 14. Quick reference — co říct Claude Code

### Start:
```
Nastuduj soubory v agents/ složce a PRD.md.
Začni Fází 1: vytvoř React dashboard z přiloženého HTML prototypu,
nastav API routes s mock daty, deployni na Vercel.
```

### Pro každého agenta:
```
Implementuj SCRAPER agenta podle agents/scraper.md a PRD sekce 6.1.
Otestuj na URL: https://shop-elegancehouse.com/collections/all
```

### Pro propojení:
```
Propoj FORGE s Higgsfield API. Credentials jsou v env HF_CREDENTIALS.
Použij Nano Banana Pro model. Testuj s briefem z SCRAPER výstupu.
```

# Developer Brief: Sprint 7 — Event Detection + Proposal Queue

## Project: Titan Commerce Limited
**Stack:** React + Vite, Vercel Functions, Supabase, Higgsfield, Claude API
**Design:** `skills/nextbyte-design/SKILL.md`

---

## PROC TENTO SPRINT

Toto je PRELOMOVY sprint — system se meni z nastroje (tool) na agenta (AI agent). Misto "uzivatel klika na kazde tlacitko" system ted:
1. **DETEKUJE** udalosti automaticky (kazdych 6h)
2. **NAVRHNE** konkretni akci
3. **CEKA** na schvaleni od uzivatele
4. **PROVEDE** schvalenou akci

**Princip: AI navrhuje, clovek schvaluje. ZADNA akce bez souhlasu.**

---

## Task 1: Database — Events + Proposals

### 1a. `sql/add-events-proposals.sql`

```sql
-- Events: co se stalo (detekovane udalosti)
CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID REFERENCES stores(id) NOT NULL,
    type            TEXT NOT NULL CHECK (type IN (
        'new_product',           -- novy produkt importovan
        'product_no_creatives',  -- produkt se prodava ale nema kreativy
        'revenue_declining',     -- revenue produktu klesa > 10%
        'winner_detected',       -- produkt ma revenue growth > 15%
        'optimization_pending',  -- produkt neni optimalizovany
        'ad_underperforming',    -- Meta ad ROAS < 1.5 (budouci)
        'ad_winner',             -- Meta ad ROAS > 4.0 (budouci)
        'low_stock'              -- produkt dochazi (budouci)
    )),
    product_id      UUID REFERENCES products(id),
    severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title           TEXT NOT NULL,       -- "Summer Dress has no creatives"
    description     TEXT,                -- "Product sold 6 units last week but has 0 creatives"
    metadata        JSONB DEFAULT '{}',  -- { revenue: 380, units: 6, trend: "-18%" }
    status          TEXT DEFAULT 'new' CHECK (status IN ('new', 'proposal_created', 'resolved', 'dismissed')),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Proposals: co AI navrhuje udelat
CREATE TABLE proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID REFERENCES stores(id) NOT NULL,
    event_id        UUID REFERENCES events(id),
    type            TEXT NOT NULL CHECK (type IN (
        'generate_creatives',    -- navrh: vygenerovat kreativy
        'optimize_listing',      -- navrh: optimalizovat listing
        'try_different_style',   -- navrh: zkusit jiny styl kreativ
        'generate_variations',   -- navrh: vygenerovat varianty z winnera
        'pause_ad',              -- navrh: pausnout ad (budouci)
        'scale_ad',              -- navrh: zvysit budget (budouci)
        'restock_alert'          -- navrh: doplnit zasoby (budouci)
    )),
    product_id      UUID REFERENCES products(id),
    title           TEXT NOT NULL,       -- "Generate 4 creatives for Summer Dress"
    description     TEXT,                -- "Recommended styles: lifestyle, ad_creative (based on winner data)"
    suggested_action JSONB NOT NULL,     -- { action: "generate", count: 4, styles: ["lifestyle", "ad_creative"] }
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    executed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,         -- navrh expiruje po 7 dnech
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_events_store_status ON events(store_id, status);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_proposals_store_status ON proposals(store_id, status);
CREATE INDEX idx_proposals_pending ON proposals(status) WHERE status = 'pending';
```

---

## Task 2: Event Detection Engine

### 2a. `api/cron/detect-events.js` — Cron endpoint (kazdych 6h)

Tento endpoint bezi automaticky pres Vercel cron. Prochazi VSECHNY aktivni story a detekuje udalosti.

```js
// GET /api/cron/detect-events
// Vola se automaticky kazdych 6 hodin (vercel.json)

// Pro kazdy aktivni store:
// 1. Nacist top products s creative counts (reuse getTopProductsWithCreatives)
// 2. Detekovat eventy
// 3. Ulozit nove eventy do DB (skip pokud stejny event uz existuje a neni resolved)
// 4. Pro kazdy novy event vytvorit proposal
// 5. Logovat do pipeline_log
```

### Event detekce pravidla:

| Event Type | Podminka | Severity | Proposal |
|------------|----------|----------|----------|
| `product_no_creatives` | units > 0 AND creative_count = 0 | high | generate_creatives (4ks, best styles) |
| `revenue_declining` | trend < -10% AND creative_count > 0 | medium | try_different_style |
| `winner_detected` | trend > +15% AND revenue > prumer | low | generate_variations (z winnera) |
| `optimization_pending` | product nema approved optimization | medium | optimize_listing |
| `new_product` | synced_at < 24h AND creative_count = 0 | high | generate_creatives + optimize_listing |

### Deduplikace:
Pred vlozenim eventu zkontrolovat:
```sql
-- Existuje uz stejny neresolveny event pro tento produkt?
SELECT id FROM events 
WHERE store_id = ? AND product_id = ? AND type = ? AND status IN ('new', 'proposal_created')
LIMIT 1;
-- Pokud existuje → skip (netvori duplikat)
```

### 2b. Proposal generation logic

Pro kazdy novy event vytvorit 1 proposal:

```js
// Event: product_no_creatives
{
  type: 'generate_creatives',
  title: `Generate 4 creatives for "${product.title}"`,
  description: `Product sold ${event.metadata.units} units last week but has 0 creatives. Recommended styles based on store performance data.`,
  suggested_action: {
    action: 'generate',
    product_id: product.id,
    count: 4,
    styles: ['ad_creative', 'lifestyle'], // top 2 styly z historickych dat
    format: 'image'
  },
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dni
}

// Event: revenue_declining
{
  type: 'try_different_style',
  title: `Try new style for "${product.title}" (revenue ↓${trend}%)`,
  description: `Current creatives use "${dominantStyle}". Suggest trying "${alternativeStyle}" based on winner data.`,
  suggested_action: {
    action: 'generate',
    product_id: product.id,
    count: 2,
    styles: [alternativeStyle],
    format: 'image'
  }
}

// Event: winner_detected
{
  type: 'generate_variations',
  title: `Scale winner: "${product.title}" (revenue ↑${trend}%)`,
  description: `Top performer. Generate more creatives in same style to maximize reach.`,
  suggested_action: {
    action: 'generate',
    product_id: product.id,
    count: 4,
    styles: [product.best_style || 'ad_creative'],
    format: 'both' // image + video
  }
}
```

### 2c. Upravit `vercel.json` — pridat cron

```json
{
  "crons": [
    {
      "path": "/api/cron/detect-events",
      "schedule": "0 */6 * * *"
    }
  ]
}
```
Bezi kazdych 6 hodin: 0:00, 6:00, 12:00, 18:00 UTC.

**POZOR:** Cron endpoint NESMI pouzivat `withAuth()` — Vercel cron nema auth token. Misto toho overit cron secret:
```js
// Na zacatku handleru:
const cronSecret = req.headers['authorization'];
if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
  return res.status(401).json({ error: 'Invalid cron secret' });
}
```
Pridat `CRON_SECRET` do `.env.local` a Vercel env vars.

### Soubory
| Soubor | Akce |
|--------|------|
| `sql/add-events-proposals.sql` | **NOVY** — DB tabulky |
| `api/cron/detect-events.js` | **NOVY** — cron event detection |
| `vercel.json` | Edit — zmenit cron na detect-events, schedule */6 |
| `.env.local` | Edit — pridat CRON_SECRET |

---

## Task 3: Proposal API Endpoints

### 3a. `api/proposals/list.js` — GET

```
GET /api/proposals/list?store_id=uuid&status=pending
```
Vrati vsechny pending proposals pro dany store. Serazeno od nejnovejsi.

### 3b. `api/proposals/approve.js` — POST

```json
POST { "proposal_id": "uuid" }
```
1. Nacist proposal → overit `status === 'pending'`
2. Podle `suggested_action.action`:
   - `'generate'` → zavolat `api/creatives/generate` pro kazdy styl
   - `'optimize'` → zavolat `api/system?action=optimize_product`
3. Updatnout proposal: `status: 'executed', executed_at: now()`
4. Updatnout event: `status: 'resolved', resolved_at: now()`
5. Pipeline log: `agent: 'AGENT', message: 'Executed proposal: {title}'`
6. Toast-friendly response: `{ success: true, message: 'Generated 4 creatives for Summer Dress' }`

### 3c. `api/proposals/reject.js` — POST

```json
POST { "proposal_id": "uuid", "reason": "Not relevant now" }
```
Updatnout proposal: `status: 'rejected', rejected_reason`
Updatnout event: `status: 'dismissed'`

### 3d. `api/proposals/approve-all.js` — POST (BULK)

```json
POST { "proposal_ids": ["uuid1", "uuid2", "uuid3"] }
```
Schvaleni vice navrhu najednou — pro morning report "Approve All Recommended".

### Soubory
| Soubor | Akce |
|--------|------|
| `api/proposals/list.js` | **NOVY** |
| `api/proposals/approve.js` | **NOVY** |
| `api/proposals/reject.js` | **NOVY** |
| `api/proposals/approve-all.js` | **NOVY** |
| `lib/api.js` | Edit — pridat proposal API funkce |

---

## Task 4: Frontend — Proposal Queue v Overview

### 4a. Redesign Overview.jsx

Overview se meni z action cards na **proposal-driven dashboard**:

```
OVERVIEW — Titan Commerce Agent

┌─ AGENT PROPOSALS ────────────────────────────────────────┐
│ 5 proposals awaiting your approval          [Approve All]│
│                                                          │
│ ┌─ 🔴 HIGH ─────────────────────────────────────────┐   │
│ │ Generate 4 creatives for "Summer Dress"            │   │
│ │ Sold 6 units, 0 creatives. Styles: lifestyle, ad   │   │
│ │                         [Approve] [Edit] [Dismiss]  │   │
│ ├────────────────────────────────────────────────────┤   │
│ │ Optimize listing for "Linen Top"                    │   │
│ │ New product imported 12h ago, not optimized yet     │   │
│ │                         [Approve] [Edit] [Dismiss]  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌─ 🟡 MEDIUM ───────────────────────────────────────┐   │
│ │ Try different style for "Elara Bikini"              │   │
│ │ Revenue ↓18%. Current: ad_creative → Try: lifestyle │   │
│ │                         [Approve] [Edit] [Dismiss]  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ┌─ 🟢 LOW ──────────────────────────────────────────┐   │
│ │ Scale winner: "Mathilda Pants" (revenue ↑23%)       │   │
│ │ Generate 4 more in lifestyle style + video           │   │
│ │                         [Approve] [Edit] [Dismiss]  │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘

┌─ RECENT ACTIVITY ────────────────────────────────────────┐
│ ✅ 2h ago: Generated 4 creatives for Karen Top           │
│ ✅ 6h ago: Optimized listing for Silk Blouse             │
│ ❌ 6h ago: Dismissed "Scale winner" for Reina Bikini     │
│ 🔄 12h ago: 3 new events detected                        │
└──────────────────────────────────────────────────────────┘

┌─ PIPELINE ───────────────────────────────────────────────┐
│ ApprovalQueue + TerminalLog + MetaPanel                   │
└──────────────────────────────────────────────────────────┘
```

### 4b. Proposal Card interakce

**[Approve]** → POST `/api/proposals/approve` → AI provede akci → success toast → karta zmizi
**[Dismiss]** → POST `/api/proposals/reject` → karta zmizi s fade
**[Edit]** → rozklikne detail kde lze upravit parametry (pocet kreativ, styly) pred schvalenim
**[Approve All]** → POST `/api/proposals/approve-all` se vsemi pending IDs → bulk execute

### 4c. Severity styling

```css
.proposal-card--critical { border-left: 3px solid var(--accent-danger); }
.proposal-card--high { border-left: 3px solid var(--accent-secondary); }  /* amber */
.proposal-card--medium { border-left: 3px solid var(--accent-tertiary); } /* gold */
.proposal-card--low { border-left: 3px solid var(--accent-success); }     /* green */
```

### 4d. Hook: `useProposals.js`

```js
export function useProposals(storeId) {
  // fetch /api/proposals/list?store_id={storeId}&status=pending
  // return { proposals, loading, refresh }
  // Supabase realtime subscription na proposals tabulku (INSERT/UPDATE)
}
```

### Soubory
| Soubor | Akce |
|--------|------|
| `pages/Overview.jsx` + CSS | PREPSAT — proposal queue layout |
| `hooks/useProposals.js` | **NOVY** |
| `components/ProposalCard.jsx` + CSS | **NOVY** — karta s approve/edit/dismiss |
| `lib/api.js` | Edit — pridat getProposals, approveProposal, rejectProposal, approveAllProposals |

---

## Task 5: Manual Trigger

### Pro testovani a on-demand pouziti

Pridat tlacitko v Overview headeru: **[🔍 Scan Now]**
→ POST `/api/cron/detect-events?store_id=xxx` (s auth tokenem misto cron secret)
→ Info toast: "Scanning for events..."
→ Success toast: "Found 3 new events, 3 proposals created"
→ Proposals se objevi v queue

---

## Task 6: Pipeline Log — Agent entries

Vsechny agent akce logovat s `agent: 'AGENT'`:

```js
// Event detekovan:
{ agent: 'AGENT', message: 'Detected: Summer Dress has no creatives (6 units sold)', level: 'info' }

// Proposal vytvoren:
{ agent: 'AGENT', message: 'Proposed: Generate 4 creatives for Summer Dress', level: 'info' }

// Proposal schvalen + proveden:
{ agent: 'AGENT', message: 'Executed: Generated 4 creatives for Summer Dress', level: 'info' }

// Proposal zamitnut:
{ agent: 'AGENT', message: 'Dismissed: Scale winner for Mathilda Pants — "Not relevant now"', level: 'warn' }
```

TerminalLog automaticky zobrazi tyto zaznamy (uz existuje).

---

## Poradi prace — DELEJ V TOMTO PORADI

### Krok 1: DB migrace (Task 1)
Spustit `sql/add-events-proposals.sql`. Overit tabulky existuji.

### Krok 2: Event detection cron (Task 2)
Vytvorit `api/cron/detect-events.js`. Pridat CRON_SECRET do env. Otestovat rucne: `POST /api/cron/detect-events` → overit events + proposals v DB.

### Krok 3: Proposal API (Task 3)
Vytvorit list/approve/reject/approve-all endpointy. Otestovat: approve proposal → akce se provede.

### Krok 4: Frontend proposal queue (Task 4)
Prepsat Overview na proposal-driven. ProposalCard komponenta. useProposals hook. Otestovat: proposals se zobrazuji, approve funguje, dismiss funguje.

### Krok 5: Manual trigger (Task 5)
Pridat "Scan Now" tlacitko. Otestovat: klik → scan → proposals se objevi.

### Krok 6: Vercel cron (Task 2c)
Updatovat vercel.json. Deploy → overit ze cron bezi kazdych 6h.

---

## BONUS Task: Bulk Pricing v Shopify tabu

### Ucel
Hromadna uprava cen produktu v kolekci. Vyber kolekci → vyber produkty (nebo vsechny) → nastav cenu → Apply → zapise do Shopify.

### Kde v UI
Shopify tab → novy sub-tab nebo sekce **"Pricing"**:

```
SHOPIFY
[Analytics]  [Pricing]    ← novy sub-tab

PRICING

Collection: [All ▾] [Swimwear ▾] [Pants ▾] ...

┌─ SELECT ─────────────────────────────────────────────────┐
│ [☑ Select All]                     New price: [€___]     │
│                                    [Apply to Selected]   │
├──────┬──────────────────────────┬────────┬───────────────┤
│  ☑   │ Mathilda Pants           │ €129   │ → €___        │
│  ☑   │ Bella Comfort Pants      │ €119   │ → €___        │
│  ☐   │ Silk Blouse              │ €89    │               │
│  ☑   │ Linen Dress              │ €79    │ → €___        │
└──────┴──────────────────────────┴────────┴───────────────┘
```

### Flow
1. Uzivatel vybere kolekci (filtr z existujicich tags/collections)
2. Zobrazi se produkty v kolekci jako tabulka s checkboxem
3. Checkne ktere chce upravit (nebo Select All)
4. Zada novou cenu do inputu
5. Klik "Apply to Selected"
6. System updatne cenu u VSECH VARIANT kazdeho vybraneho produktu pres Shopify Admin API
7. Toast: "Updated prices for 12 products"

### Backend: `api/shopify/bulk-price.js` — POST

```json
POST {
  "store_id": "uuid",
  "product_shopify_ids": [123, 456, 789],
  "new_price": "49.95"
}
```

Flow:
1. Nacist store z DB → overit admin_token existuje
2. Pro kazdy product_shopify_id:
   - GET `/admin/api/2024-01/products/{id}.json` → nacist varianty
   - Pro kazdy variant: PUT `/admin/api/2024-01/variants/{variant_id}.json` s `{ price: new_price }`
3. Updatnout ceny v Supabase `products` tabulce (sync local)
4. Pipeline log: `agent: 'PRICING', message: 'Bulk updated ${count} products to ${price}'`

**POZOR:** Shopify API rate limit — max 2 requesty/sekundu. Pro 50 produktu × 3 varianty = 150 requestu = ~75 sekund. Vercel 60s limit nestaci!

**Reseni:** Pouzit Shopify GraphQL bulk mutation:
```graphql
mutation {
  productVariantsBulkUpdate(variants: [
    { id: "gid://shopify/ProductVariant/123", price: "49.95" },
    { id: "gid://shopify/ProductVariant/456", price: "49.95" },
    ...
  ]) {
    productVariants { id price }
    userErrors { field message }
  }
}
```
Jedna GraphQL mutace updatne az 250 variant najednou — vejde se do timeout.

### Frontend: Rozsirit `pages/Shopify.jsx`

- Pridat tab/sekci "Pricing" vedle "Analytics"
- Filtr podle kolekce (reuse existujici collection tags z products)
- Tabulka s checkboxy, current price, new price input
- Select All / Deselect All
- Apply button s loading state + toast

### Soubory
| Soubor | Akce |
|--------|------|
| `api/shopify/bulk-price.js` | **NOVY** — bulk price update endpoint |
| `pages/Shopify.jsx` + CSS | Edit — pridat Pricing sekci |
| `lib/shopify-admin.js` | Edit — pridat `bulkUpdateVariantPrices(storeUrl, token, variants)` |
| `lib/api.js` | Edit — pridat `bulkUpdatePrices(storeId, productIds, price)` |

### Omezeni
- Funguje JEN pro story s admin_token (Elegance House). Isola bez Admin API → disabled.
- Compare/compare_at_price (puvodni cena pro slevu) — zatim neresime, jen `price`.

---

---

## BONUS Task 2: Shopify Tab Redesign (Alethe-style)

### Ucel
Kompletni redesign Shopify tabu. Inspirace: Alethe dashboard. Dva rezimy: Dashboard (analytics) a Services (akce). Nase pridana hodnota: services propojene s agent proposal systemem.

### Nova sub-navigace v Shopify tabu

```
SHOPIFY
[Dashboard]  [Services]  [Pricing]
```

---

### Sub-tab 1: DASHBOARD (analytics — jako Alethe screenshot 1)

```
┌─ KPIs ──────────────────────────────────────────────────────┐
│ 🛍 194 PRODUCTS  📦 1,554 ORDERS  👥 3,331 CUSTOMERS  📂 28 COLLECTIONS │
└─────────────────────────────────────────────────────────────┘

┌─ Revenue ─────────────────────────── [1D] [7D] [30D] [90D] [1Y] ─┐
│ €8,363                                                            │
│ 📦 132 orders  💵 €63 avg  📈 €270/day                           │
│                                                                    │
│  ┌─ Chart ──────────────────────────────────────────────┐         │
│  │  📈 (line/area chart — denni revenue)                 │         │
│  └──────────────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────────────────┘

┌─ Payment ───────────┐ ┌─ Top Products ──────────────────┐ ┌─ Top Customers ─────────────┐
│ ● PAID     131 (99%)│ │ 1. Mathilda Slimming   €2,897  │ │ 1. Andrea T.  2 ord  €127   │
│ ● REFUNDED   1 (1%) │ │ 2. Mathilda Flattering €2,647  │ │ 2. Karolyn D. 1 ord  €90    │
│                      │ │ 3. Elara              €2,477  │ │ 3. Manasa T.  1 ord  €90    │
│ Fulfillment          │ │ 4. Mathilda Comfort     €949  │ │ 4. Thanh H.   1 ord  €90    │
│ ● FULFILLED 129 (98%)│ └────────────────────────────────┘ └─────────────────────────────┘
│ ● UNFULFILLED 3 (2%)│
└──────────────────────┘
```

**Implementace:**
- KPI row: `GET /api/shopify/overview` — products count, orders count, customers count, collections count
- Revenue chart: `daily_revenue` data z overview endpointu + time range selector
- Payment/Fulfillment: nove pole v overview response — `payment_status` a `fulfillment_status` agregace
- Top Products: uz existuje v overview response
- Top Customers: **NOVY** — `getTopCustomers(days, limit)` v `lib/shopify-admin.js`

**Nove endpointy/funkce:**
```js
// lib/shopify-admin.js — pridat:
async getCustomerCount() {
  // GET /admin/api/2024-01/customers/count.json
}

async getTopCustomers(days, limit = 5) {
  // Agregovat z orders: customer name, email, order count, total spent
}

async getPaymentFulfillmentStatus(days) {
  // Agregovat z orders: paid/refunded counts, fulfilled/unfulfilled counts
}

async getCollectionCount() {
  // GET /admin/api/2024-01/custom_collections/count.json + smart_collections/count.json
}
```

---

### Sub-tab 2: SERVICES (akce — jako Alethe screenshot 2)

6 kategorii jako karty. Kazda karta ma 3-4 akce. Klik na akci → bud spusti agent action, nebo otevre modal, nebo naviguje na jiny tab.

```
┌─ Store Management ──────┐ ┌─ Content & Copy ──────────┐ ┌─ Analytics & Reports ─────┐
│ 🏪                       │ │ ✏️                         │ │ 📊                         │
│ Overview, audits,        │ │ Product copy, SEO meta,    │ │ Sales analysis, forecasts, │
│ and optimization         │ │ and blog posts             │ │ and segments               │
│                          │ │                            │ │                            │
│ 🔍 Store Overview        │ │ ✨ Optimize Product Titles │ │ 📈 Sales Performance       │
│    Product count,        │ │    SEO-optimized titles    │ │    Revenue & top products  │
│    orders & issues       │ │    for every product       │ │    (30 days)               │
│                          │ │                            │ │                            │
│ 🏥 Product Health Audit  │ │ 📝 Write Descriptions      │ │ 🏆 Top / Bottom Products   │
│    Missing images,       │ │    Compelling, benefit-    │ │    Rank products by        │
│    descriptions & pricing│ │    focused product copy    │ │    performance             │
│                          │ │                            │ │                            │
│ ⚡ Store Optimization    │ │ 🔎 Generate SEO Meta       │ │ 👥 Customer Segmentation   │
│    Improvements across   │ │    Optimized titles &      │ │    VIPs, at-risk, and      │
│    SEO, pricing & content│ │    meta descriptions       │ │    spending tiers           │
│                          │ │                            │ │                            │
│                          │ │ 📰 Write Blog Post         │ │ 📦 Inventory Forecast      │
│                          │ │    Create and publish      │ │    Predict stock-outs      │
│                          │ │    a blog post             │ │    in 30 days              │
└──────────────────────────┘ └────────────────────────────┘ └────────────────────────────┘

┌─ Trends & Research ─────┐ ┌─ Orders & Customers ──────┐ ┌─ Inventory & Pricing ─────┐
│ 🔥                       │ │ 📦                         │ │ 💰                         │
│ Market trends, niches,   │ │ Order status, refunds,     │ │ Stock levels, pricing,     │
│ and competitor intel     │ │ and fulfillment            │ │ and discounts              │
│                          │ │                            │ │                            │
│ 📊 Trending Niches       │ │ 🔍 Check Order Status      │ │ ⚠️ Low Stock Audit         │
│    Top trending product  │ │    Look up any order       │ │    Products below 10       │
│    niches right now      │ │    by number or email      │ │    units + reorder         │
│                          │ │                            │ │                            │
│ 🕵️ Competitor Research   │ │ 💸 Process Refund          │ │ 💲 Bulk Update Pricing     │
│    Pricing, range &      │ │    Calculate and process   │ │    Apply % increase/       │
│    marketing strategies  │ │    a refund                │ │    decrease to collection  │
│                          │ │                            │ │                            │
│ 💡 Evaluate Opportunity  │ │ ✅ Fulfill Order           │ │ 🏷️ Create Discount         │
│    Trends, volume &      │ │    Add tracking and mark   │ │    Discount codes or       │
│    competition analysis  │ │    as fulfilled            │ │    automatic promotions    │
└──────────────────────────┘ └────────────────────────────┘ └────────────────────────────┘
```

**DULEZITE: Ne vsechny services budou hned funkcni.** Implementace po fazich:

### Faze 1 (tento sprint) — fungujici services:
| Service | Akce pri kliku | Existujici infrastruktura |
|---------|---------------|--------------------------|
| Store Overview | Zobrazi KPIs + summary (reuse Dashboard sub-tab data) | ✅ uz existuje |
| Product Health Audit | Scan products: missing images, empty descriptions, no price | ✅ products tabulka |
| Optimize Product Titles | Naviguje na Products tab → bulk optimizer | ✅ Product Optimizer |
| Write Descriptions | Naviguje na Products tab → optimizer (description mode) | ✅ Product Optimizer |
| Generate SEO Meta | Naviguje na Products tab → optimizer (SEO mode) | ✅ Product Optimizer |
| Sales Performance | Zobrazi Dashboard sub-tab | ✅ uz existuje |
| Top / Bottom Products | Zobrazi top products tabulku | ✅ uz existuje |
| Bulk Update Pricing | Otevre Pricing sub-tab | ✅ v tomto briefu |

### Faze 2 (budouci sprinty) — zatim disabled/coming soon:
| Service | Proc disabled | Co potrebuje |
|---------|--------------|-------------|
| Store Optimization | Komplexni AI audit | Claude API + custom logika |
| Write Blog Post | Shopify blog API | write_content scope + blog endpoint |
| Customer Segmentation | Customer analiza | Shopify customer API + segmentace logika |
| Inventory Forecast | Predikce | Historicka data + ML model |
| Trending Niches | Externi data | Market research API |
| Competitor Research | Externi data | Scraping + analiza |
| Evaluate Opportunity | Externi data | Market data |
| Check Order Status | Order detail | Shopify orders API (uz mame zaklad) |
| Process Refund | Shopify refund API | write_orders scope |
| Fulfill Order | Shopify fulfillment API | write_fulfillments scope |
| Low Stock Audit | Inventory API | read_inventory scope (mame) |
| Create Discount | Shopify discount API | write_price_rules scope |

**Disabled services zobrazuji:** badge "Coming Soon" + kratky popis co bude umet. Karta je seda/dimmed.

---

### Sub-tab 3: PRICING (bulk price edit — uz specifikovany vyse)

Beze zmeny — viz BONUS Task 1 vyse.

---

### Implementace Shopify sub-navigation

```jsx
// Shopify.jsx
const [subTab, setSubTab] = useState('dashboard');

return (
  <div>
    <div className="sh-subnav">
      <button className={subTab === 'dashboard' ? 'active' : ''} onClick={() => setSubTab('dashboard')}>
        Dashboard
      </button>
      <button className={subTab === 'services' ? 'active' : ''} onClick={() => setSubTab('services')}>
        Services
      </button>
      <button className={subTab === 'pricing' ? 'active' : ''} onClick={() => setSubTab('pricing')}>
        Pricing
      </button>
    </div>
    
    {subTab === 'dashboard' && <ShopifyDashboard storeId={storeId} />}
    {subTab === 'services' && <ShopifyServices storeId={storeId} onNavigate={onNavigate} />}
    {subTab === 'pricing' && <ShopifyPricing storeId={storeId} />}
  </div>
);
```

### Nove soubory
| Soubor | Akce |
|--------|------|
| `components/ShopifyDashboard.jsx` + CSS | **NOVY** — Alethe-style dashboard (KPIs, chart, payment, top products/customers) |
| `components/ShopifyServices.jsx` + CSS | **NOVY** — 6-category services grid |
| `components/ShopifyPricing.jsx` + CSS | **NOVY** — bulk price editor (presunout z Shopify.jsx) |
| `components/ServiceCard.jsx` + CSS | **NOVY** — reusable service card s ikonou, title, description, actions |
| `pages/Shopify.jsx` | PREPSAT — sub-navigation + 3 sub-taby |
| `lib/shopify-admin.js` | Edit — pridat getTopCustomers, getPaymentFulfillmentStatus, getCollectionCount, getCustomerCount |
| `api/shopify/overview.js` | Edit — pridat customer count, collection count, payment/fulfillment status do response |
| `lib/api.js` | Edit — pridat bulk price API funkce |

---

### Krok 7: E2E test
1. Import novy produkt na Shopify → sync → cron (nebo Scan Now) → event detekovan → proposal vytvoren
2. Overview: vidim proposal "Generate creatives for [produkt]"
3. Klik Approve → kreativy se generuji → success toast
4. Klik Dismiss → proposal zmizi
5. Approve All → vsechny pending se provedou
6. Pipeline log ukazuje AGENT entries
7. Po 6h cron bezi znovu → nove eventy pokud jsou

---

## Verifikace

### Event detection
- Cron bezi kazdych 6h (overit v Vercel logs)
- Scan Now funguje manualne
- Eventy se neukladaji duplicitne (deduplikace)
- Kazdy event ma spravny type, severity, metadata

### Proposals
- Kazdy event ma prave 1 proposal
- Approve → akce se provede (kreativy generovane / listing optimalizovany)
- Reject → proposal dismissed, event dismissed
- Approve All → vsechny pending se provedou najednou
- Expired proposals (> 7 dni) se nezobrazuji

### Overview
- Proposals serazeny podle severity (critical → high → medium → low)
- Approve/Dismiss buttony funguji s toast feedback
- Recent Activity ukazuje historii akci
- Pipeline section (ApprovalQueue + TerminalLog) pod proposals
- Store izolace — kazdy store vidi jen sve proposals

### Multi-store
- Elegance House proposals neviditelne v Isola a naopak
- Cron prochazi oba story
- Kazdy event/proposal ma store_id

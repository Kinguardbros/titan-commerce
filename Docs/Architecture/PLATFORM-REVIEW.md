# Titan Commerce Platform Review — E-Commerce Mentor Perspective

> Autor: Zkušený ecom mentor, hledající jednotnou platformu pro řízení Shopify storů, reklam, kreativ, a ekonomiky businessu.
> Datum: 2026-04-12

---

## 1. Executive Summary

**Titan Commerce** je multi-store SaaS dashboard postavený na React + Vite (frontend), Vercel Serverless (backend), Supabase (DB/Storage) a AI službách (Claude Sonnet 4, Higgsfield, fal.ai). Spravuje 3 Shopify story (Elegance House, Isola, Eleganz Haus) s plnou datovou izolací přes `store_id`.

### Verdikt

Solidní "operator-built" nástroj, který řeší reálné workflow bolesti — zejména AI generování kreativ a optimalizace produktových listingů. Ale jako denní podvozek pro seriózní ecom business má zásadní mezery v ad trackingu, přesnosti P&L a týmovém přístupu.

### Co dělá dobře (Top 3)

1. **AI kreativní pipeline je funkční a unikátní** — 7+ stylů (ad_creative, lifestyle, UGC, beach...), per-product prompt specializace, brand knowledge injection z nahraných dokumentů, feedback learning z approved/rejected kreativ. Tohle žádný Triple Whale ani Canva nemá v jednom.
2. **Import-to-optimization workflow** — Scrapni URL konkurenta → vytvoř produkt v Shopify → AI přepíše listing (Claude) → automaticky generuj kreativy. Celý flow v 4 krocích, s approval workflow. Tohle šetří hodiny.
3. **Multi-store izolace je důkladná** — `store_id` FK na všech 12+ tabulkách, store switcher s localStorage persistencí, per-store Shopify credentials. Přepínání mezi story funguje čistě.

### Kde to zaostává (Top 3)

1. **Meta Ads integrace je nefunkční** — Všechny 4 env proměnné jsou prázdné. Kód existuje (read-only), ale zero reálné funkcionality. Pro ecom operátora, který utrácí na Meta, je to deal-breaker.
2. **P&L dashboard není dostatečně přesný pro rozhodování** — Transakční poplatky hardcodované na 3.5%, chybí shipping costs, chybí returns/refunds. Nepřesný profit = špatná rozhodnutí o ad budgetech.
3. **Žádná autentizace pro tým** — Jedno sdílené heslo, žádné role, žádný audit trail per user. Nemůžeš bezpečně dát přístup VA nebo designérovi.

### Pro koho je to dnes

Solo operátor nebo micro-tým (2-3 lidi) spravující Shopify story, který chce AI kreativy a product copy. **Není** vhodný pro týmy potřebující role-based přístup, multi-channel ad management, nebo enterprise spolehlivost.

---

## 2. Feature-by-Feature Assessment

### 2a. Multi-Store Management — 4/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Deep |
| **Business value** | Critical |

**Co funguje:** 3 story s vlastními Shopify credentials, kompletní datová izolace, store switcher v headeru, per-store brand config (JSONB).

**Co chybí:** Per-store user permissions — každý vidí všechny story. Žádné cross-store srovnání (side-by-side KPIs).

---

### 2b. Product Management — 4/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Deep |
| **Business value** | Critical |

**Co funguje:**
- Shopify sync (REST API v2024-01)
- Import z URL konkurenta (Cheerio scraper) — 4-step wizard
- Inline product editor (title, description, tags, variants, metafields, images)
- Paginated grid (50/page, 3 view modes, search, filtry, sort)
- Bulk pricing editor
- Size chart management (manuální + Claude Vision z obrázku)

**Co chybí:** Inventory management, variant-level COGS, supplier/landed cost tracking, bulk product editing (beyond pricing).

---

### 2c. AI Creative Generation (Images + Video) — 4/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Deep |
| **Business value** | High |

**Co funguje:**
- 2 image engines: Higgsfield (Nano Banana, Flux Kontext Max, Soul) + fal.ai (FLUX.2, Ideogram v3)
- Video: DOP Turbo (image-to-video)
- 7+ stylů: ad_creative, product_shot, beach, lifestyle, review_ugc, static_clean, static_split, static_urgency
- Per-product prompt specializace (Mathilda, Elara mají custom prompty)
- Brand knowledge injection přes skill chain systém
- Feedback learning: approved/rejected kreativy ovlivňují budoucí generování
- Text overlay options, aspect ratio volba, model selection
- Rate limits: 20 images/hr, 10 videos/hr

**Co chybí:** A/B test framework pro kreativy. Žádný automatický refresh cadence. Batch generation at scale je limitovaný.

---

### 2d. AI Product Optimization — 3.5/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Functional |
| **Business value** | High |

**Co funguje:**
- Claude Sonnet 4 přepisuje: title, description, SEO, tags, product type, vendor, varianty
- Approval workflow: optimize → pending → review/edit → approve (push to Shopify) / reject
- Store knowledge injection (brand-voice, audience-personas, product-specific skills)
- Variant standardizace (S/M/L/XL, barvy do EN)

**KRITICKÝ BUG:** Brand system prompt v `lib/claude.js` (řádky 37-69) je **hardcodovaný na Elegance House**. Při optimalizaci produktů pro Isola nebo Eleganz Haus dostávají brand voice Elegance House. Tohle je data corruption bug.

**Co chybí:** Before/after conversion tracking. Bulk optimization. Multi-store brand prompt.

---

### 2e. Analytics (Shopify) — 3/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Functional |
| **Business value** | Medium |

**Co funguje:**
- KPIs: revenue, orders, AOV, currency, delta vs předchozí období
- Daily revenue chart (7/14/30 dní, CSS bars)
- Top products s trend %, creative count, approved count
- Traffic source attribution (UTM parsing z Shopify)
- Recent orders, top customers

**Co chybí:** Cohort analysis, LTV kalkulace, customer segmentace, cross-store srovnání. Data freshness indicator. Žádný caching — každý page load volá Shopify API live (až 250 orders).

---

### 2f. Profit Dashboard — 2.5/5

| | |
|---|---|
| **Status** | Částečně funkční |
| **Hloubka** | Surface |
| **Business value** | Critical (ale nepřesný) |

**Co funguje:**
- Denní P&L: Revenue - COGS - Adspend - Fees = Profit
- COGS management per product (manuální vstup)
- Manual adspend pro TikTok/Pinterest/Other
- ROAS kalkulace, 7/14/30d views, CSV export

**Problémy:**
- Transakční poplatky hardcodované na 3.5% (Shopify EU = 1.9%, US = 2.9%, PayPal = jiné)
- Žádné shipping costs — pro fashion brand zásadní nákladová položka
- Žádné returns/refunds — fashion má 20-40% return rate
- Meta adspend je prázdný (Meta nepřipojená)
- Žádný automated adspend sync z žádného kanálu

**Verdikt:** Nepřesný P&L je horší než žádný P&L — vede ke špatným rozhodnutím.

---

### 2g. Meta Ads Integration — 0/5

| | |
|---|---|
| **Status** | Placeholder |
| **Hloubka** | Zero |
| **Business value** | Critical (nefunkční) |

Kód v `lib/meta-api.js` existuje (read-only). Všechny 4 env proměnné prázdné. UI ukazuje "not connected" placeholder. Žádný OAuth flow. Žádné write capabilities.

**Single biggest gap** celé platformy.

---

### 2h. Event Detection & Proposal System — 3/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Basic |
| **Business value** | Medium |

**Co funguje:** Cron denně 8:00 UTC. 3 event typy: product_no_creatives (high), revenue_declining (medium), winner_detected (low). Proposal queue s approve/dismiss/approve all.

**Co chybí:** Jen 3 event typy. Žádné ad performance events, inventory alerts, seasonal patterns. Jednoduchý threshold comparison.

**Potenciál:** Dobrý pattern. S Meta + více event typy může být velmi užitečný.

---

### 2i. Brand Knowledge System — 4/5

| | |
|---|---|
| **Status** | Funkční |
| **Hloubka** | Deep |
| **Business value** | Medium-High |

**Co funguje:** Upload dokumentů (PDF, DOCX, TXT, obrázky) → Claude Vision extraction → auto-klasifikace → skill generation → injekce do kreativ i copy.

**Unikátní:** Žádný konkurent nemá "nahraju brand guidelines PDF a AI je automaticky aplikuje na generované kreativy i copy."

---

## 3. Architecture & Scalability Review

### 3a. Infrastructure
- Vercel Hobby plan: 12 routes (všech 12 využito), 1 cron, 60s timeout
- `api/system.js` = **1,597 řádků, 37 action handlers** (CLAUDE.md říká 666/15 — zastaralá docs)
- Mega-handler = single point of failure

### 3b. Database
- Supabase Postgres, RLS enabled, indexy na klíčových sloupcích
- Žádný migration tool — raw SQL v `/sql/`, manuální spouštění
- Realtime enabled pro creatives, pipeline_log, products

### 3c. Authentication & Security
- **Jedno sdílené heslo** (`APP_PASSWORD`)
- HMAC token s expiry (24h/30d)
- Žádná user identity, žádné role, žádný audit trail
- Rate limiting in-memory — resetuje se při cold startu (nefunguje)

### 3d. Frontend
- React 19 + Vite, code splitting
- `CreativeStudio.jsx` = 989 řádků s inline styles (porušuje vlastní 300-line pravidlo)
- Žádný TypeScript, žádné testy

### 3e. API Design
- Vše přes `/api/system?action=X` — žádné REST konvence
- Žádné API versioning, request validace, dokumentace

---

## 4. Business Value — Mapování na denní workflow

| Potřeba operátora | Titan feature | Stav | Alternativa |
|---|---|---|---|
| "Jak si vedl store včera?" | Shopify tab KPIs | Funkční | Shopify admin, Triple Whale |
| "Jsem profitabilní?" | Profit tab P&L | **Nepřesný** | Triple Whale, Lifetimely |
| "Potřebuju nový ad kreativy" | Studio / Generate | Funkční | Canva, agentura |
| "Lepší copy pro listing" | Product Optimizer | Funkční (bug: hardcoded brand) | Jasper, ChatGPT |
| "Produkt konkurenta" | Import Modal | **Funkční a unikátní** | Importify |
| "Jak performují Meta ads?" | Meta Panel | **Nefunkční** | Meta Ads Manager |
| "Trackovat TikTok spend" | Manual entry | Minimální | Platformové dashboardy |
| "Na čem pracovat dál?" | Proposal system | Basic (3 events) | Intuice |
| "Tým reviewuje kreativy" | Approval queue | Funkční | Slack, Asana |
| "Konzistentní brand voice" | Brand Knowledge | **Funkční a unikátní** | Brand guidelines doc |

**80/20:** Creative generation + product import/optimization šetří 5-10h/týden. Analytics a P&L zatím nepřidávají nad Shopify native.

---

## 5. Critical Gaps

### Deal-Breakers
1. **Meta Ads nefunkční** — polovina dashboardu prázdná
2. **P&L nepřesnost** — hardcoded fees, žádné shipping/returns
3. **Žádná týmová auth** — jedno heslo, žádné role
4. **Brand prompt hardcoded** na Elegance House pro všechny story

### Important Missing
5. Žádná TikTok/Pinterest API (jen manuální adspend)
6. Žádný inventory management
7. Žádná customer analytics (LTV, kohorty)
8. Žádný A/B testing pro kreativy
9. Žádné automated testy
10. Rate limiter in-memory (nefunguje na serverless)

---

## 6. Competitive Context

| vs | Analytika | Kreativy | P&L | Product Mgmt |
|---|---|---|---|---|
| **Triple Whale** | Řádově napřed | Nemá | Real P&L | Nemá |
| **Shopify Admin** | Lepší native | Nemá | Nemá | Srovnatelný |
| **Canva** | Nemá | Flexibilnější, manuální | Nemá | Nemá |
| **Lifetimely/BeProfit** | Nemá | Nemá | Auto-synced, přesný | Nemá |
| **Titan** | Základní | **AI + brand knowledge (unikát)** | Nepřesný | **Import pipeline (unikát)** |

### Unikátní differentiátory
- Import → optimize → generate pipeline v jednom flow
- Brand knowledge extraction z dokumentů → injekce do kreativ i copy
- Event → proposal pattern jako základ pro "AI commerce assistant"

---

## 7. Prioritized Roadmap

### P0 — Must Have (Weeks 1-4)

| # | Task | Proč | Effort |
|---|---|---|---|
| 1 | **Připojit Meta Ads API** (read-only) | Odemyká reálný adspend v P&L, campaign visibility, LOOPER | 2-3 dny |
| 2 | **Opravit P&L přesnost** | Real transaction fees, shipping, returns/refunds | 3-4 dny |
| 3 | **Multi-store brand prompt** | Fix bug: `lib/claude.js:37-69` hardcoded na Elegance House | 30 min |
| 4 | **Základní automated testy** | Auth, system.js routing, sync, generation | 2-3 dny |

### P1 — High Impact (Weeks 5-8)

| # | Task | Proč | Effort |
|---|---|---|---|
| 5 | **User auth s rolemi** | Supabase Auth, min: admin/editor/viewer | 1 týden |
| 6 | **Rozdělit system.js** | 1,597 řádků = unmaintainable | 3-4 dny |
| 7 | **TikTok Ads API** (read-only) | Auto-sync adspend | 2-3 dny |
| 8 | **PUBLISHER agent** | Approved kreativa → Meta ad (killer feature) | 1-2 týdny |

### P2 — Medium Impact (Weeks 9-16)

| # | Task | Effort |
|---|---|---|
| 9 | A/B testing framework pro kreativy | 1-2 týdny |
| 10 | Inventory tracking + low stock alerts | 1 týden |
| 11 | Cross-store comparison dashboard | 3-4 dny |
| 12 | Database migration tooling (Supabase CLI) | 1-2 dny |

### P3 — Nice to Have

| # | Task |
|---|---|
| 13 | Light theme (brief v Docs/Briefs/LIGHT-THEME.md) |
| 14 | Full mobile responsive (brief v Docs/Briefs/UX-RESPONSIVE.md) |
| 15 | Pinterest API |
| 16 | Customer analytics (LTV, kohorty) |
| 17 | Error tracking (Sentry) |

---

## 8. Quick Wins (High ROI, Low Effort)

| # | Co | Effort | Impact |
|---|---|---|---|
| A | **Fix hardcoded brand prompt** — načítat z `stores.brand_config` | 30 min | Bug fix pro 2/3 storů |
| B | **Cron schedule nesoulad** — vercel.json vs CLAUDE.md | 5 min | Docs alignment |
| C | **Aktualizovat CLAUDE.md** — system.js: 1,597 řádků / 37 akcí (ne 666/15) | 30 min | Onboarding |
| D | **Přidat Sentry** | 1 hod | Error visibility |
| E | **Cache Shopify API** (60s TTL) | 2 hod | Performance |
| F | **Transaction fee per store** v brand_config | 1 hod | P&L přesnost |
| G | **"Last synced" timestamp** | 30 min | Data freshness |
| H | **Rate limiter do Supabase** | 1 hod | Real enforcement |

---

## 9. Hints na rozšíření

### 9a. "Morning Report" Agent
Každé ráno v 8:00: včerejší revenue vs 7d average, top/worst 3 produkty, adspend vs budget, stav kreativ, inventory alerts. Odeslat do Slacku/emailu.

### 9b. Creative Refresh Cadence
"Kreativa starší než 14 dní → navrhni regeneraci." Ads fatigue je reálný problém. Event system to může detekovat.

### 9c. Competitor Price Monitoring
Scraper 1x/týden kontroluje URL konkurentů, alertuje na cenové změny. Proposal system integration.

### 9d. Product Performance Scoring
Auto health score: revenue trend + ad performance + creative count + conversion rate. Vizualizace v product gridu.

### 9e. Ad Budget Optimizer
S Meta: navrhovat budget reallocation. "Produkt X ROAS 4.2, Y ROAS 1.1 → přesuň $50/den." Jako proposal ke schválení.

### 9f. Seasonal Playbook
Předdefinované playbook pro Black Friday, Valentine's, Summer Sale. Auto-návrh kreativ, produktů, discount strategií.

### 9g. Unit Economics Calculator
Per-product: selling price - COGS - shipping - fee - ad CPA = margin per unit. Threshold alerts ("pod 20% margin").

### 9h. WhatsApp/Email Automation
Post-purchase + pre-abandonment flows. Klaviyo integrace nebo nativní.

### 9i. Multi-Channel Creative Adaptation
1 kreativa → 4 formáty: Meta Feed (1:1), Meta Story (9:16), TikTok (9:16), Pinterest (2:3). Jeden click.

### 9j. AI Pricing Assistant
Competitor data + margin targets + sales velocity → optimální cena jako proposal.

---

## 10. Celkové hodnocení

| Oblast | Score | Komentář |
|---|---|---|
| Product Management | 4/5 | Solidní, import workflow unikátní |
| Creative Generation | 4/5 | Funkční, brand knowledge je killer feature |
| Product Optimization | 3.5/5 | Dobrý základ, hardcoded brand = bug |
| Analytics | 3/5 | Základní, nepřidává nad Shopify native |
| P&L / Profit | 2.5/5 | Nepřesný — horší než žádný |
| Ad Management | 0/5 | Kompletně nefunkční |
| Event System | 3/5 | Dobrý pattern, jen 3 event typy |
| Brand Knowledge | 4/5 | Unikátní a inovativní |
| Architecture | 2.5/5 | Mega-handler, žádné testy/typy |
| Security / Team | 1.5/5 | Jedno heslo, žádné role |
| **CELKEM** | **3/5** | **Silný na kreativy a produkty. Slabý na analytics, ads, team. S P0 roadmap → 4/5.** |

---

## Klíčové soubory

| Soubor | Proč |
|---|---|
| `api/system.js` (1,597 ř.) | Mega-handler, 37 akcí, single point of failure |
| `lib/claude.js` | Hardcoded Elegance House brand (ř. 37-69) |
| `lib/meta-api.js` | Meta ready ale nefunkční (prázdné credentials) |
| `lib/auth.js` (35 ř.) | Celý auth = jedno heslo |
| `lib/higgsfield.js` | Creative engine — nejsofistikovanější část |
| `lib/shopify-admin.js` | Shopify klient, potřebuje real fee data |
| `apps/dashboard/src/pages/Profit.jsx` | P&L, potřebuje shipping/returns/fee variabilitu |

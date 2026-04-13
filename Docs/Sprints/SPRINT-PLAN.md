# Titan Commerce — Sprint Plan

> Vychází z: `Docs/Architecture/PLATFORM-REVIEW.md` (ecom mentor assessment, 2026-04-12)
> Porovnáno s: předchozí architecture review plan + `project_full_roadmap.md` + `project_backlog.md`
> Autor: Development Manager
> Datum: 2026-04-12

---

## Kontext: Co se změnilo oproti předchozím plánům

Předchozí plány (architecture review, roadmap Sprint 9-15+) se zaměřovaly na **refactoring a nové features**. Platform review ale odhalil, že **existující features mají kritické bugy a gaps**, které musí mít přednost:

1. **Brand prompt je hardcoded na Elegance House** — 2 ze 3 storů dostávají špatný brand voice (data corruption)
2. **P&L je nepřesný** — hardcoded 3.5% fees, žádné shipping/returns. Nepřesný P&L = špatná rozhodnutí
3. **Meta Ads je kompletně nefunkční** — polovina dashboardu je placeholder
4. **Žádné testy** — refactoring bez testů = riskantní

**Strategie:** Nejdřív opravit co je broken, pak přidat co chybí, pak refactorovat.

---

## Sprint 0: Bug Fixes & Quick Wins (3 dny)

**Cíl:** Opravit kritické bugy a quick wins z review. Zero-risk, okamžitá hodnota.
**Prerekvizity:** Žádné.

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 0.1 | Fix hardcoded brand prompt | `BRAND_SYSTEM_PROMPT` v `lib/claude.js:37-69` je hardcoded na Elegance House. Přepsat: načítat brand voice ze `stores.brand_config` JSONB nebo `store_skills` tabulky (skill_type='brand-voice'). `buildOptimizationPrompt()` na řádku 76 taky hardcoduje "Elegance House store" — dynamizovat. Vendor v JSON template (ř. 96) taky hardcoded. | `lib/claude.js` | S (1-2h) | **Must** |
| 0.2 | Transaction fee per store | Nahradit hardcoded `0.035` v `system.js:118-119` hodnotou z `stores.brand_config.transaction_fee_pct`. Přidat default 0.035 jako fallback. Přidat sloupec nebo JSONB klíč. | `api/system.js:118-119`, `stores` table | S (1h) | **Must** |
| 0.3 | Strip admin_token z frontend response | V `system.js:56-58` action `stores_list`: odstranit `admin_token` z response, poslat jen `has_admin: !!admin_token`. Frontend `hasAdminAccess()` v `lib/store-context.js` upravit na kontrolu `has_admin` boolean. | `api/system.js:56-58`, frontend `useActiveStore` | S (30min) | **Must** |
| 0.4 | Rate limiter do Supabase | Nahradit in-memory `Map()` v `lib/rate-limit.js` (17 řádků). Nová tabulka `rate_limits(id, key, created_at)` + index. Funkce zůstane sync-compatible wrapper nad async Supabase query. | `lib/rate-limit.js`, nový SQL migration | S (1-2h) | **Should** |
| 0.5 | Aktualizovat CLAUDE.md | system.js: 1,597 ř. / 37 akcí (ne 666/15). Přidat `lib/fal.js` do Key Files. Opravit cron schedule info. Přidat agent names (OPTIMIZER, IMPORTER, PRICING, CLEANUP, AUTH, SKILL_GEN). | `CLAUDE.md` | S (30min) | **Should** |
| 0.6 | Fix bare catch blocks | Přidat `console.error` s kontextem do: `lib/auth.js:21`, `api/creatives/generate.js`, `api/auth/shopify.js:23`. | 3 soubory | S (30min) | **Should** |
| 0.7 | "Last synced" timestamp na Products | Uložit `last_synced_at` do localStorage po úspěšném sync. Zobrazit v UI: "Synced 2h ago". | `pages/Products.jsx`, `lib/api.js` | S (30min) | **Could** |

### Definition of Done
- [ ] Optimalizace produktu pro Isola/Eleganz Haus používá správný brand voice (ne Elegance House)
- [ ] P&L pro store s 2.9% fee ukazuje jiný výsledek než store s 1.9% fee
- [ ] DevTools Network tab neukazuje `admin_token` v stores_list response
- [ ] Rate limit funguje i po Vercel cold restartu
- [ ] CLAUDE.md odpovídá realitě (system.js řádky, akce, cron)
- [ ] `vercel dev` — všech 5 tabů funguje bez regression

### Rizika
- **0.1 brand prompt:** `getStoreKnowledge()` (ř. 7-35) už načítá per-store data — ale `BRAND_SYSTEM_PROMPT` (ř. 37-69) je statický string. Řešení: buď celý prompt generovat dynamicky, nebo mít fallback pro story bez brand-voice skillu.
- **0.4 rate limiter:** Async Supabase query v synchronním `rateLimit()` volání — bude potřeba refactor callerů na async.

---

## Sprint 1: P&L Přesnost + Základní Testy (2 týdny)

**Cíl:** P&L dashboard ukazuje čísla, kterým může operátor důvěřovat pro rozhodování o ad budgetech.
**Prerekvizity:** Sprint 0 (transaction fee per store).

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 1.1 | Shipping costs v P&L | Přidat `shipping_cost` do profit kalkulace. Dvě možnosti: (a) per-order z Shopify API (`shipping_lines` v order response) — přesné ale pomalé, (b) flat rate per store v `brand_config.avg_shipping_cost` — rychlé. **Doporučení:** Shopify API data (jsou v order response, stačí parsovat `order.shipping_lines[].price`). | `api/system.js` profit_summary akce (~ř. 81-170), `lib/shopify-admin.js` getRevenueSummary | M (4-6h) | **Must** |
| 1.2 | Returns/Refunds v P&L | Shopify orders mají `financial_status: 'refunded'/'partially_refunded'` a `refunds[]` array. Parsovat z order dat, odečíst od revenue. Zobrazit v daily P&L jako separátní sloupec. | `api/system.js` profit_summary, `pages/Profit.jsx` | M (4-6h) | **Must** |
| 1.3 | Payment gateway fee variabilita | Shopify order response obsahuje `payment_gateway_names[]`. Mapovat: `shopify_payments` → store fee, `paypal` → 3.49%+€0.49, `klarna` → 2.99%. Přidat fee mapping do `stores.brand_config.payment_fees`. | `api/system.js` profit_summary | M (3-4h) | **Should** |
| 1.4 | Vitest setup + auth testy | Nastavit Vitest pro backend (`lib/` a `api/`). Napsat testy pro: `verifyAuth()` (valid/expired/tampered token), `rateLimit()` (window enforcement), `requireFields()` validace. Mock Supabase clienta. | Nový `vitest.config.js`, `tests/auth.test.js`, `tests/rate-limit.test.js` | M (1 den) | **Must** |
| 1.5 | Testy pro system.js routing | Testovat: neznámá akce → 400, `stores_list` nevrací `admin_token`, `profit_summary` kalkulace s mock daty (ověřit fee, shipping, returns). | `tests/system.test.js` | M (1 den) | **Must** |
| 1.6 | P&L přesnost indikátor | UI warning v Profit.jsx: "X produktů nemá COGS" (existuje), přidat: "Shipping costs: actual/estimated", "Returns: tracked/not tracked". Zelená/žlutá/červená indikace přesnosti. | `pages/Profit.jsx` | S (2-3h) | **Should** |
| 1.7 | Extract shared event detection | Duplikovaná logika v `cron/detect-events.js` a `system.js` `scan_events`. Nový `lib/event-detector.js` se sdílenou funkcí `detectEventsForStore(store, supabase)`. | `lib/event-detector.js` (nový), `api/cron/detect-events.js`, `api/system.js` | S (2h) | **Should** |

### Definition of Done
- [ ] P&L pro Elegance House ukazuje: Revenue - COGS - Shipping - Returns - Adspend - Fees = Profit
- [ ] Shipping je parsovaný ze Shopify order dat (ne flat rate)
- [ ] Refunded orders snižují revenue
- [ ] Transaction fees se liší per payment gateway
- [ ] `npm test` projde — min 10 testů (auth, rate-limit, routing, P&L kalkulace)
- [ ] Profit.jsx ukazuje přesnost indikátor ("X products missing COGS", "Shipping: tracked")
- [ ] Event detection není duplikovaný — jeden zdroj pravdy

### Rizika
- **1.1 Shipping:** Shopify REST API vrací `shipping_lines` v order response — ale `getRevenueSummary()` v `shopify-admin.js` možná neparsuje všechna pole. Ověřit response shape.
- **1.2 Returns:** Refund může být partial — potřeba sčítat `refund_line_items[].subtotal`, ne jen flagovat celý order.
- **1.4 Testy:** Vercel serverless handlers mají specifický `(req, res)` interface — potřeba mock nebo helper pro testování.

---

## Sprint 2: Meta Ads Read-Only + system.js Modularizace (2 týdny)

**Cíl:** Meta Ads data viditelná v dashboardu. system.js rozdělený na udržitelné moduly.
**Prerekvizity:** Sprint 0 + 1 (testy existují, base je stabilní).

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 2.1 | Meta Ads API credentials setup | Vytvořit Meta App, získat long-lived token, nastavit env proměnné. Dokumentovat postup v README nebo Docs/. Per-store Meta credentials (Elegance House a Eleganz Haus mají separátní ad accounty). Uložit do `stores.brand_config.meta_*` nebo separátní sloupce. | `.env`, `stores` tabulka, docs | M (4-6h) | **Must** |
| 2.2 | Meta read-only integrace | `lib/meta-api.js` kód existuje ale nebyl testován s reálnými credentials. Otestovat: `getAccountInsights()`, `getCampaigns()`, `getActiveAdsCount()`. Upravit na per-store credentials (aktuálně čte z env). | `lib/meta-api.js`, `api/system.js` meta_overview akce | M (1 den) | **Must** |
| 2.3 | Meta adspend do P&L (automatický) | Po připojení Meta: `performance` tabulka se plní reálnými daty. profit_summary akce už čte z `performance` → ověřit že funguje end-to-end. Přidat daily sync: cron nebo on-demand fetch Meta spend dat. | `api/system.js` profit_summary, `api/cron/detect-events.js` | M (4-6h) | **Must** |
| 2.4 | MetaPanel real data | `components/MetaPanel.jsx` (71 řádků) ukazuje "not connected" placeholder. Připojit na reálná data: KPIs (spend, impressions, conversions, ROAS), active campaigns list, top/worst ads. | `components/MetaPanel.jsx`, `hooks/useMetaOverview.js` | M (4-6h) | **Should** |
| 2.5 | system.js modularizace | Extrahovat 37 action handlers do `lib/actions/` modulů. system.js zůstane jako router (~50-80 řádků). Moduly: stores, pipeline, kpi, profit, proposals, optimizations, creatives, products, pricing, skills, docs, size-chart, events, meta. | `api/system.js` → `lib/actions/*.js` | L (3-4 dny) | **Must** |
| 2.6 | Input validation helper + aplikace | Nový `lib/validate.js` s `requireFields()`. Aplikovat na všechny POST akce v nových modulech během extrakce (2.5). | `lib/validate.js` (nový), všechny `lib/actions/*.js` | M (součást 2.5) | **Should** |

### Definition of Done
- [ ] MetaPanel ukazuje reálné KPIs (ne "not connected")
- [ ] P&L zahrnuje automatický Meta adspend (ne jen manual entry)
- [ ] `api/system.js` je pod 100 řádků (router only)
- [ ] Každý action modul v `lib/actions/` je pod 200 řádků
- [ ] Všechny POST akce validují required fields přes `requireFields()`
- [ ] Existující testy stále projdou + nové testy pro Meta integrations
- [ ] `npm run build` projde, všech 5 tabů funguje

### Rizika
- **2.1 Meta credentials:** Meta App Review proces může trvat týdny pro production access. Začít s development credentials (omezený scope ale funkční pro read-only). Potřeba Business Verification.
- **2.2 Per-store Meta:** Aktuální `lib/meta-api.js` čte credentials z env proměnných (globální). Potřeba refactor na per-store: buď `stores.brand_config.meta_*` nebo separátní `meta_credentials` tabulka.
- **2.5 Modularizace:** Vercel importuje `api/system.js` jako single function. Importy z `lib/actions/` musí být static (ne dynamic) aby Vercel bundler je zahrnul. Ověřit s `vercel dev` po každém kroku.

---

## Sprint 3: User Auth + RBAC (2 týdny)

**Cíl:** Bezpečně dát přístup VA, designérovi, nebo partnerovi. Audit trail per user.
**Prerekvizity:** Sprint 2 (system.js modularizovaný — auth middleware se aplikuje čistěji na moduly).

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 3.1 | Supabase Auth setup | Zapnout Supabase Auth (email/password). Vytvořit `user_roles` tabulku (user_id FK → auth.users, role: admin/editor/viewer, store_access: uuid[]). Seed: aktuální uživatel jako admin. | Supabase dashboard, nový SQL migration, `lib/auth.js` | M (4-6h) | **Must** |
| 3.2 | Login screen migration | `pages/Login.jsx` (67 ř.): nahradit password gate za Supabase Auth login (email + password). Přidat registraci (invite-only: admin vytvoří usera). Zachovat stávající UI design. | `pages/Login.jsx`, `lib/api.js` (auth token handling) | M (1 den) | **Must** |
| 3.3 | Backend auth middleware | `lib/auth.js`: nahradit HMAC verifikaci za Supabase JWT verifikaci. `withAuth()` middleware extrahuje user ID + role z JWT. Přidat `withRole(role)` middleware pro role-based kontrolu. | `lib/auth.js` | M (4-6h) | **Must** |
| 3.4 | Role-based UI | Viewer: read-only (žádné generate, optimize, approve, edit). Editor: vše kromě store settings. Admin: full access. Podmíněné renderování tlačítek v UI. | `App.jsx`, `pages/*.jsx`, `components/*.jsx` | M (1 den) | **Should** |
| 3.5 | Per-user audit trail | Pipeline log: přidat `user_id` sloupec. Při každé akci logovat kdo ji provedl. TerminalLog zobrazuje user name. | `pipeline_log` tabulka, `lib/actions/*.js`, `components/TerminalLog.jsx` | M (4-6h) | **Should** |
| 3.6 | Store access control | User může mít přístup jen k vybraným storům (ne všem 3). `user_roles.store_access` = uuid[] array. Backend: filtrovat stores_list a všechny queries. Frontend: store switcher ukazuje jen povolené story. | `lib/actions/stores.js`, `hooks/useActiveStore.jsx` | M (4-6h) | **Could** |

### Definition of Done
- [ ] Login funguje přes email + heslo (Supabase Auth)
- [ ] Starý password gate je odstraněn
- [ ] Viewer role nemůže generovat kreativy ani optimalizovat produkty
- [ ] Pipeline log ukazuje kdo provedl jakou akci
- [ ] Admin může vytvořit nového uživatele s rolí
- [ ] `user_roles` RLS: user vidí jen svůj záznam, admin vidí všechny

### Rizika
- **Breaking change:** Všichni stávající session tokeny přestanou fungovat. Komunikovat dopředu, naplánovat migration window.
- **3.2 Login:** Supabase Auth vyžaduje email verifikaci by default — pro interní tým vypnout (Supabase dashboard → Auth → Settings).
- **3.6 Store access:** Pokud user nemá přístup k žádnému storu → error state. Přidat graceful handling.

---

## Sprint 4: TikTok Ads + Event System Enhancement (2 týdny)

**Cíl:** Automatický adspend sync z TikToku. Event systém detekuje víc situací.
**Prerekvizity:** Sprint 2 (Meta funguje, P&L je přesný).

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 4.1 | TikTok Marketing API read-only | Nový `lib/tiktok-api.js`. Read-only: campaign list, daily spend, impressions, conversions. Per-store credentials v `stores.brand_config.tiktok_*`. | `lib/tiktok-api.js` (nový), `stores` table | M (2-3 dny) | **Must** |
| 4.2 | TikTok adspend do P&L | Nahradit `manual_adspend` channel='tiktok' automatickým fetche z API. Zachovat manual jako fallback pro story bez TikTok credentials. | `lib/actions/profit.js`, cron | M (4-6h) | **Must** |
| 4.3 | Nové event typy | Rozšířit `lib/event-detector.js`: `creative_fatigue` (kreativa starší než 14 dní, stále aktivní), `high_roas_product` (ROAS > 4x, navrhni scale), `low_margin_alert` (margin pod 20%), `no_recent_creative` (top product, 30+ dní bez nové kreativy). | `lib/event-detector.js` | M (1 den) | **Should** |
| 4.4 | Shopify webhook pro product sync | Registrovat webhooky: `products/create`, `products/update`, `products/delete`. Nový action `webhook_shopify` v system.js. HMAC verifikace. Zachovat full sync jako manual "Re-sync All". | `lib/actions/products.js`, Shopify Admin API | M (2-3 dny) | **Should** |
| 4.5 | Cross-store comparison widget | Nový komponent na Overview: side-by-side KPIs (revenue, orders, ROAS) pro všechny story. Malý, informativní — ne full dashboard. | `components/CrossStoreComparison.jsx` (nový), `pages/Overview.jsx` | S (4-6h) | **Could** |
| 4.6 | Shopify API cache (60s TTL) | Shopify overview data se fetchují live při každém page load. Přidat in-memory cache s 60s TTL na server-side (v `lib/shopify-admin.js`). Na serverless = per-instance cache, ale stačí pro eliminaci duplicitních requestů v rámci jednoho page load. | `lib/shopify-admin.js` | S (2h) | **Could** |

### Definition of Done
- [ ] TikTok spend se automaticky objeví v P&L (pro story s TikTok credentials)
- [ ] Manuální TikTok entry stále funguje jako fallback
- [ ] Event systém detekuje 7+ typů událostí (místo 3)
- [ ] Proposal queue ukazuje `creative_fatigue` a `low_margin_alert` propozice
- [ ] Product sync funguje přes webhooky (nové/upravené produkty se objeví automaticky)
- [ ] Shopify tab se loaduje rychleji (cached API responses)

### Rizika
- **4.1 TikTok API:** TikTok Marketing API vyžaduje app review. Development access má limity (1 ad account). Začít s jedním storem.
- **4.4 Webhooky:** Vercel Hobby nemá dedikovaný webhook endpoint — potřeba přidat jako action do system.js. Webhook payload validace (HMAC) je kritická — bez ní security hole.

---

## Sprint 5: PUBLISHER Agent + CreativeStudio Refactor (2 týdny)

**Cíl:** Approved kreativy se jedním klikem publikují do Meta. CreativeStudio je udržitelný.
**Prerekvizity:** Sprint 2 (Meta API funkční), Sprint 3 (user auth — kdo publikoval).

### Tasky

| # | Task | Popis | Soubory | Effort | Priorita |
|---|------|-------|---------|--------|----------|
| 5.1 | Meta Ads write capabilities | Rozšířit `lib/meta-api.js`: `createCampaign()`, `createAdSet()`, `createAd()`, `updateAdStatus()`. Per-store ad account IDs. | `lib/meta-api.js` | L (2-3 dny) | **Must** |
| 5.2 | PUBLISHER agent | Nový `lib/agents/publisher.js`. Flow: approved kreativa → vybere campaign → vytvoří ad set + ad → status tracking. Defaults z `agents/publisher.md` spec: $50/day, Conversions, Lookalike 1%. Jako proposal ke schválení (ne automatický publish). | `lib/agents/publisher.js` (nový), `lib/actions/creatives.js` | L (3-4 dny) | **Must** |
| 5.3 | "Publish to Meta" UI | Tlačítko v CreativeEditor (approved kreativy). Modal: campaign selection, budget, targeting preview → confirm → PUBLISHER agent. Status tracking v creative detail. | `components/CreativeEditor.jsx`, nový `components/PublishModal.jsx` | M (1 den) | **Must** |
| 5.4 | CreativeStudio.jsx extraction — konstanty | Extrahovat STYLE_MAP, MODEL_MAP, SCENES, MODEL_COST do `components/studio/constants.js`. | `components/CreativeStudio.jsx` → `components/studio/constants.js` | S (1h) | **Should** |
| 5.5 | CreativeStudio.jsx extraction — styly | Extrahovat inline styles do `components/studio/studio-styles.css`. Nahradit JS style objects CSS třídami. | `components/CreativeStudio.jsx` → `components/studio/studio-styles.css` | M (4-6h) | **Should** |
| 5.6 | CreativeStudio.jsx extraction — komponenty | Rozdělit na: StylePicker, ImageConfig, VideoConfig, GenerateControls. Shell pod 200 řádků. | `components/studio/*.jsx` (4 nové) | M (1 den) | **Should** |
| 5.7 | useCreativeStudioState hook | 30+ useState → useReducer v custom hooku. | `hooks/useCreativeStudioState.js` (nový) | M (3-4h) | **Should** |

### Definition of Done
- [ ] Approved kreativa se dá jedním klikem publikovat do Meta (přes approval flow)
- [ ] PUBLISHER agent loguje do pipeline_log
- [ ] CreativeStudio.jsx shell je pod 200 řádků
- [ ] Žádný soubor v `components/studio/` nepřekračuje 250 řádků
- [ ] Inline styles jsou v CSS souboru (prerequisite pro light theme)
- [ ] Všech 5 tabů funguje, creative generation workflow bez regression

### Rizika
- **5.1 Meta Write:** Meta API write access vyžaduje vyšší permission level než read-only. Může být blokováno App Review.
- **5.2 PUBLISHER:** Budget a targeting defaults musí být konzervativní — chyba = reálné peníze. Vždy přes approval.
- **5.5 CSS extraction:** 989 řádků inline stylů → CSS je mechanicky náročné. Postupovat po komponentách, testovat po každém kroku.

---

## Backlog (P2/P3 + Hints z Review)

Seřazeno podle business impact. Zařadit do budoucích sprintů podle aktuální priority.

### P2 — Medium Impact

| # | Task | Effort | Business Value | Zdroj |
|---|------|--------|----------------|-------|
| B1 | A/B testing framework pro kreativy | 1-2 týdny | High — data-driven creative decisions | Review P2 #9 |
| B2 | LOOPER agent (performance scoring feedback loop) | 1-2 týdny | High — closes the creative optimization loop | Review P2, Roadmap Sprint 10 |
| B3 | Inventory tracking + low stock alerts | 1 týden | Medium — prevents stockouts | Review P2 #10 |
| B4 | Cross-store comparison dashboard (full) | 3-4 dny | Medium — strategic overview | Review P2 #11 |
| B5 | Database migration tooling (Supabase CLI) | 1-2 dny | Medium — dev productivity | Review P2 #12 |
| B6 | Unit Economics Calculator (per-product margin) | 3-4 dny | High — "pod 20% margin" alerts | Review Hint 9g |
| B7 | Bulk product optimization | 2-3 dny | Medium — efektivita | Review 2d |

### P3 — Nice to Have

| # | Task | Effort | Business Value | Zdroj |
|---|------|--------|----------------|-------|
| B8 | Light theme | 2-3 dny | Low — visual preference | Review P3 #13, Docs/Briefs/LIGHT-THEME.md |
| B9 | Full mobile responsive | 3-4 dny | Low-Medium — field access | Review P3 #14, Docs/Briefs/UX-RESPONSIVE.md |
| B10 | Pinterest Ads API | 2-3 dny | Low — minor ad channel | Review P3 #15 |
| B11 | Customer analytics (LTV, kohorty) | 1-2 týdny | Medium — long-term value | Review P3 #16 |
| B12 | Sentry error tracking | 1-2 hod | Medium — operational visibility | Review P3 #17 |
| B13 | TypeScript migration | 2-3 týdny | Medium — dev productivity | Architecture review |
| B14 | CI/CD (GitHub Actions) | 0.5 dne | Medium — quality gate | Architecture review |

### Hints na rozšíření (Future)

| # | Hint | Impact | Effort | Prerekvizity |
|---|------|--------|--------|--------------|
| H1 | Morning Report Agent (Slack/email) | High | 1 týden | Meta funguje, P&L přesný |
| H2 | Creative Refresh Cadence (>14d → navrhni regeneraci) | High | 2-3 dny | Sprint 4 event typy |
| H3 | Competitor Price Monitoring (scraper + alerts) | Medium | 1 týden | Scraper utils existují |
| H4 | Product Performance Scoring (health score) | Medium | 3-4 dny | Meta + P&L data |
| H5 | Ad Budget Optimizer (ROAS-based reallocation) | High | 1-2 týdny | PUBLISHER + LOOPER |
| H6 | Seasonal Playbook (BF, Valentine's, Summer) | Medium | 1 týden | Brand knowledge system |
| H7 | Multi-Channel Creative Adaptation (1 → 4 formáty) | Medium | 3-4 dny | Video engine |
| H8 | AI Pricing Assistant (competitor + margin → optimal price) | Medium | 1 týden | Competitor monitoring |
| H9 | Klaviyo integrace | Medium | 1-2 týdny | — |
| H10 | Gorgias integrace | Low | 1-2 týdny | — |

---

## Dependency Graf

```
Sprint 0 (Bug Fixes)
  ├── 0.1 Brand prompt fix ──────────────────────┐
  ├── 0.2 Transaction fee per store ─────────┐    │
  ├── 0.3 Strip admin_token                  │    │
  ├── 0.4 Rate limiter Supabase              │    │
  └── 0.5-0.7 Quick wins                     │    │
                                             │    │
Sprint 1 (P&L Přesnost + Testy)             │    │
  ├── 1.1 Shipping costs ◄──────────────────┘    │
  ├── 1.2 Returns/Refunds                        │
  ├── 1.3 Payment gateway fees                    │
  ├── 1.4-1.5 Testy (auth, routing, P&L)         │
  └── 1.7 Event detection dedup                   │
                                                  │
Sprint 2 (Meta + Modularizace)                    │
  ├── 2.1 Meta credentials setup                  │
  ├── 2.2 Meta read-only ◄── 2.1                 │
  ├── 2.3 Meta adspend → P&L ◄── 2.2             │
  ├── 2.4 MetaPanel real data ◄── 2.2            │
  └── 2.5 system.js modularizace                  │
                                                  │
Sprint 3 (User Auth)                              │
  ├── 3.1-3.3 Supabase Auth ◄── 2.5 (moduly)     │
  ├── 3.4 Role-based UI                           │
  └── 3.5 Per-user audit trail                    │
                                                  │
Sprint 4 (TikTok + Events)                        │
  ├── 4.1-4.2 TikTok API ◄── Sprint 1 (P&L)     │
  ├── 4.3 Nové event typy ◄── 1.7 (dedup)        │
  └── 4.4 Shopify webhooks                        │
                                                  │
Sprint 5 (PUBLISHER + Refactor)                   │
  ├── 5.1-5.3 PUBLISHER ◄── 2.2 (Meta) + 3.x    │
  └── 5.4-5.7 CreativeStudio refactor ◄──────────┘
                                                  │
Backlog                                           │
  ├── B1 A/B Testing ◄── PUBLISHER (Sprint 5)    │
  ├── B2 LOOPER ◄── PUBLISHER (Sprint 5)          │
  ├── B8 Light Theme ◄── 5.5 (CSS extraction)     │
  ├── H1 Morning Report ◄── Meta + P&L            │
  └── H5 Budget Optimizer ◄── PUBLISHER + LOOPER  │
```

---

## Doporučení Development Managera

### 1. Sprint 0 je non-negotiable
Brand prompt bug (0.1) je **data corruption** — 2 ze 3 storů dostávají špatný brand voice. To je nejhorší druh bugu, protože výstup vypadá OK ale je špatně. Opravit jako PRVNÍ věc.

### 2. P&L přesnost před novými features
Review správně identifikuje: "Nepřesný P&L je horší než žádný P&L." Sprint 1 musí dodat důvěryhodná čísla dřív než přidáme Meta spend data (Sprint 2), jinak přidáváme přesná data do nepřesného systému.

### 3. Meta Ads: začít s development credentials
Review říká "2-3 dny" pro Meta API — realistické pro kód, ale **Meta App Review může trvat týdny**. Doporučuji:
- Sprint 2: development credentials (omezené, ale funkční)
- Sprint 4+: production credentials (po schválení app review)
- Neblokovat ostatní sprinty kvůli Meta review process

### 4. system.js modularizace zařadit DO Sprintu 2, ne separátně
Předchozí plán měl modularizaci jako standalone. Review ji má jako P1. Doporučuji ji udělat **společně s Meta integrací** — přidáváme nový action modul (meta), ideální čas na extrakci všech ostatních.

### 5. CreativeStudio refactor odložit na Sprint 5
Předchozí plán měl refactor jako Sprint 2. Ale review ukazuje, že **P&L, Meta, Auth** mají vyšší business value. CreativeStudio funguje — je ugly ale functional. Refactor je prerequisite pro light theme (B8), ale light theme je P3.

### 6. Co z review přeskočit nebo odložit
- **Light theme (P3 #13):** Nízká business value, závisí na CSS extraction. Odložit za Sprint 5.
- **Full mobile responsive (P3 #14):** Dashboard se primárně používá na desktopu. Odložit.
- **TypeScript migration:** Review to nezmiňuje (správně). Odložit až po refactorech.
- **CI/CD:** Přidat po Sprint 1 (testy existují), ale není sprint-worthy — udělat jako quick task.

### 7. Rozdíl oproti předchozímu plánu
| Oblast | Předchozí plán | Tento plán | Důvod změny |
|--------|---------------|------------|-------------|
| Pořadí | Security → Refactor → UX | Bug fixes → P&L → Meta → Auth | Business value first |
| system.js | Standalone sprint | Součást Meta sprintu | Efektivnější |
| CreativeStudio | Sprint 2 | Sprint 5 | P&L/Meta/Auth mají vyšší ROI |
| Meta Ads | "Blocked on credentials" | Sprint 2 (dev credentials) | Unblock early |
| Testy | Backlog/low priority | Sprint 1 | Review říká P0, souhlasím |
| Light theme | Sprint 3 | Backlog | P3, nízký business impact |

---

## Timeline Overview

```
Week 1      : Sprint 0 — Bug Fixes & Quick Wins (3 dny)
Week 1-2    : Sprint 1 — P&L Přesnost + Testy
Week 3-4    : Sprint 2 — Meta Ads + system.js Modularizace
Week 5-6    : Sprint 3 — User Auth + RBAC
Week 7-8    : Sprint 4 — TikTok + Event System
Week 9-10   : Sprint 5 — PUBLISHER + CreativeStudio Refactor
Week 11+    : Backlog prioritizace (A/B testing, LOOPER, nebo Morning Report)
```

Celkem: **10 týdnů** od bug fixes po PUBLISHER agent. Každý sprint doručí měřitelnou business hodnotu.

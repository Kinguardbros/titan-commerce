# DEV BRIEF — Sprint 1: P&L Přesnost + Bug Fixes + Testy

> **Projekt:** Titan Commerce (multi-store SaaS dashboard)
> **Datum:** 2026-04-12
> **Prerekvizita:** Přečti si `CLAUDE.md` v rootu projektu — kompletní architektura, konvence, pravidla.

---

## Kontext

P&L dashboard (Profit tab) ukazuje nepřesná čísla. Nepřesný P&L = špatná rozhodnutí o ad budgetech. Navíc je v kódu několik kritických bugů (hardcoded brand voice, security leak). Cílem sprintu je opravit bugy a dostat P&L na úroveň, které operátor může důvěřovat.

Meta Ads integrace je v řešení na straně třetí strany — **v tomto sprintu ji neřeš.**

---

## Nalezené bugy (opravit PRVNÍ)

### BUG 1 — Hardcoded brand prompt (KRITICKÝ)

`lib/claude.js:37-69` — `BRAND_SYSTEM_PROMPT` je statický string hardcodovaný na Elegance House. Když se optimalizuje produkt pro Isola nebo Eleganz Haus, dostane brand voice Elegance House. To je data corruption — 2 ze 3 storů dostávají špatný výstup.

**Co je hardcoded:**
- Řádek 37: `"You are a copywriter for Elegance House, a women's fashion e-commerce brand."`
- Řádek 52: `Vendor: Always "Elegance House"`
- Řádek 76: `buildOptimizationPrompt()` — `"Rewrite this imported product listing for Elegance House store."`
- Řádek 96: JSON template — `"vendor": "Elegance House"`

**Co udělat:**
- `BRAND_SYSTEM_PROMPT` přestat používat jako statický string. Dynamicky sestavit system prompt z `store_skills` tabulky (skill_type `'brand-voice'`), kde brand voice pro každý store už existuje. Funkce `getStoreKnowledge()` na řádcích 7-35 to částečně dělá — ale výsledek se jen přidává do user message, ne do system promptu.
- Nový přístup: `async function buildSystemPrompt(storeId)` — načte brand-voice skill z DB, pokud neexistuje → fallback na generický prompt (bez "Elegance House"). Store name a vendor vzít ze `stores` tabulky.
- `buildOptimizationPrompt(rawProduct, brandContext)` — nahradit "Elegance House store" za store name z parametru.
- Vendor v JSON template — dynamicky z `stores.name`.
- `optimizeProduct()` signatura potřebuje `storeId` (už ho má, řádek 104) — předat store info do obou prompt funkcí.

---

### BUG 2 — P&L nerespektuje aktivní store

`api/system.js:81-170` (akce `profit_summary`) volá `getRevenueSummary(days)` a `getRecentOrders(250)` — to jsou **default exporty** z `lib/shopify-admin.js:283-288`, které vždy volají Elegance House (default klient). Nemá per-store routing.

Stejně tak frontend: `hooks/useProfit.js` nepředává `storeId`, `lib/api.js:225` `getProfitSummary(days)` nepřidává `store_id` parametr.

**Co udělat:**
- V `profit_summary` akci: přijímat `store_id` z query parametru
- Načíst store přes `getStore(store_id)`, vytvořit Shopify klienta přes `createShopifyClient(store.shopify_url, store.admin_token)`
- Volat `client.getRevenueSummary(days)` a `client.getRecentOrders(250)` místo default exportů
- Frontend `hooks/useProfit.js` — předávat `storeId` do API callu
- `lib/api.js:225` `getProfitSummary(days)` — přidat `&store_id=${storeId}` parametr

---

### BUG 3 — Transaction fee hardcoded na 3.5%

`api/system.js:118-119` — `dailyMap[date].transaction_fees += order.total * 0.035`

**Co udělat:**
- Přidat do `stores.brand_config` JSONB klíč `transaction_fee_pct` (Shopify EU = 0.019, US = 0.029, PayPal = 0.0349)
- V profit_summary akci: načíst fee z `store.brand_config.transaction_fee_pct`, fallback na `0.035`
- SQL update pro existující story:
```sql
UPDATE stores SET brand_config = brand_config || '{"transaction_fee_pct": 0.019}' WHERE name = 'Elegance House';
UPDATE stores SET brand_config = brand_config || '{"transaction_fee_pct": 0.019}' WHERE name = 'Isola';
UPDATE stores SET brand_config = brand_config || '{"transaction_fee_pct": 0.029}' WHERE name = 'Eleganz Haus';
```

---

### BUG 4 — admin_token v frontend response

`api/system.js:56-58` — akce `stores_list` vrací výsledek `getAllStores()`, který v `lib/store-context.js:16` selectuje `admin_token`. Shopify Admin API token je viditelný v browser DevTools.

**Co udělat:**
```js
if (action === 'stores_list') {
  const stores = await getAllStores();
  const safeStores = stores.map(({ admin_token, ...rest }) => ({
    ...rest,
    has_admin: !!admin_token
  }));
  return res.status(200).json(safeStores);
}
```
Frontend `lib/store-context.js:20` — `hasAdminAccess(store)` upravit na: `return !!(store?.has_admin || store?.admin_token)` (backward compatible).

---

### BUG 5 — Rate limiter nefunguje na serverless

`lib/rate-limit.js` — in-memory `Map()` se resetuje při každém Vercel cold startu.

**Co udělat:**
- Nová tabulka:
```sql
CREATE TABLE rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_rate_limits_key_time ON rate_limits(key, created_at);
```
- `rateLimit()` funkci přepsat na async — volá Supabase:
  1. DELETE staré záznamy (`created_at < now() - windowMs`)
  2. COUNT záznamy pro klíč v okně
  3. Pokud pod limitem → INSERT nový záznam, return true
  4. Jinak return false
- Callery v `api/creatives/generate.js` a dalších adaptovat na `await rateLimit(...)` (aktuálně synchronní volání)

---

## Nové features

### 1.1 — Shipping costs v P&L

Shopify REST API vrací `shipping_lines` v order response. `getRecentOrders()` v `lib/shopify-admin.js:122-126` aktuálně tyto data NEPARSUJE — mapuje jen `id, name, total, currency, status, created_at, items`.

**Co udělat:**
- V `getRecentOrders()` (řádek 125): přidat do mapu `shipping: (o.shipping_lines || []).reduce((s, l) => s + parseFloat(l.price || 0), 0)` a `payment_gateway: o.payment_gateway_names?.[0] || 'unknown'`
- V profit_summary akci: přidat sloupec `shipping` do `dailyMap` inicializace
- `dailyMap[date].shipping += order.shipping || 0`
- Odečíst shipping od profitu: `profit = revenue - cogs - adspend - fees - shipping`
- Frontend `Profit.jsx`: přidat Shipping sloupec do daily P&L tabulky a do KPI summary

---

### 1.2 — Returns/Refunds v P&L

Shopify orders mají `financial_status` ('paid', 'refunded', 'partially_refunded') a `refunds[]` array.

**Co udělat:**
- V `getRecentOrders()`: přidat `financial_status: o.financial_status`, `refund_amount: (o.refunds || []).reduce((s, r) => s + r.transactions?.reduce((ts, t) => ts + parseFloat(t.amount || 0), 0) || 0, 0)`
- V profit_summary: přidat `returns` sloupec do dailyMap
- `dailyMap[date].returns += order.refund_amount || 0`
- Revenue kalkulace: net_revenue = revenue - returns
- Profit: `revenue - returns - cogs - adspend - fees - shipping`
- Frontend: Returns sloupec v P&L tabulce, červeně

---

### 1.3 — Payment gateway fee variabilita

Aktuálně flat 3.5%. Reálně: Shopify Payments EU = 1.9%, US = 2.9%, PayPal = 3.49%+fixed, Klarna = 2.99%.

**Co udělat:**
- Přidat do `stores.brand_config` JSONB:
```json
{
  "payment_fees": {
    "shopify_payments": 0.019,
    "paypal": 0.0349,
    "klarna": 0.0299,
    "default": 0.035
  }
}
```
- V profit_summary: `const feeRate = store.brand_config?.payment_fees?.[order.payment_gateway] || store.brand_config?.payment_fees?.default || 0.035`
- Kalkulovat fee per-order podle skutečného payment gateway (ne flat rate)

---

### 1.4 — P&L přesnost indikátor

V `Profit.jsx` existuje warning "X products missing COGS". Rozšířit o:
- "Shipping: ✅ Tracked from Shopify" nebo "⚠️ Not available"
- "Returns: ✅ Tracked" nebo "⚠️ Not tracked"
- "Transaction fees: ✅ Per-gateway" nebo "⚠️ Flat rate (3.5%)"
- Vizuálně: zelená/žlutá ikonka vedle KPI karet

---

### 1.5 — Vitest setup + testy

V projektu neexistují žádné testy. Nastavit Vitest a napsat minimálně:
- `tests/auth.test.js` — `verifyAuth()` s valid/expired/tampered tokenem
- `tests/rate-limit.test.js` — rate limit enforcement (mock Supabase)
- `tests/profit.test.js` — P&L kalkulace s mock order daty — ověřit fee, shipping, returns výpočet
- `tests/system-routing.test.js` — neznámá akce → 400, stores_list nevrací admin_token

Nastavení: `vitest.config.js` v rootu, `"test": "vitest run"` do package.json scripts.

---

### 1.6 — Extract shared event detection

`api/cron/detect-events.js` a `api/system.js` akce `scan_events` obsahují duplikovaný kód pro detekci eventů.

**Co udělat:**
- Nový `lib/event-detector.js` s funkcí `detectEventsForStore(store, supabase)`
- Obě místa importují a volají tuto sdílenou funkci
- Jeden zdroj pravdy

---

### 1.7 — CLAUDE.md aktualizace

Po dokončení všech tasků aktualizuj CLAUDE.md:
- system.js: aktuální počet řádků a akcí
- Přidat `lib/fal.js` do Key Files tabulky
- Přidat `lib/event-detector.js` do Key Files tabulky
- Opravit profit_summary popis (shipping, returns, per-gateway fees)
- Přidat agent names do pipeline_log sekce (OPTIMIZER, IMPORTER, PRICING, CLEANUP, AUTH, SKILL_GEN)

---

### 1.8 — Fix bare catch blocks

- `lib/auth.js:21` — `catch {}` (swallows HMAC errors)
- `api/auth/shopify.js:23` — `catch {}` (swallows OAuth errors)
- `api/creatives/generate.js` — bare catch na metadata parsing

Přidat `console.error('[Module] Description:', { context })` do každého catch bloku. CLAUDE.md zakazuje `catch (e) {}`.

---

### 1.9 — "Last synced" timestamp

Po úspěšném product sync uložit `last_synced_at` timestamp do localStorage. Zobrazit v `Products.jsx`: "Synced 2h ago" / "Never synced" vedle Sync tlačítka.

---

## Pořadí práce (doporučené)

1. **BUG 1** (brand prompt) — kritický, 1-2h
2. **BUG 4** (admin_token) — security, 30min
3. **BUG 2** (P&L store routing) — prerequisite pro vše další, 1-2h
4. **BUG 3** (transaction fee) — součást P&L fix, 1h
5. **1.1** Shipping → **1.2** Returns → **1.3** Gateway fees (stavíš na BUG 2+3)
6. **BUG 5** (rate limiter) — 1-2h
7. **1.8** Bare catch blocks — 30min
8. **1.5** Vitest + testy — napsat po implementaci, aby testoval reálný kód
9. **1.4** P&L indikátor — UI finish
10. **1.6** Event detection extract — refactoring
11. **1.9** Last synced — quick win
12. **1.7** CLAUDE.md update — na konci

---

## Definition of Done

- [ ] `optimizeProduct()` pro Isola vrací Isola brand voice (ne Elegance House)
- [ ] `optimizeProduct()` pro Eleganz Haus vrací Eleganz Haus brand voice
- [ ] P&L pro Isola ukazuje Isola orders (ne Elegance House)
- [ ] P&L obsahuje: Revenue - Returns - COGS - Shipping - Adspend - Fees = Profit
- [ ] Shipping parsovaný ze Shopify `shipping_lines` (ne flat rate)
- [ ] Refunded/partially refunded orders snižují revenue
- [ ] Transaction fees se liší per payment gateway
- [ ] DevTools Network tab neukazuje `admin_token` v stores_list response
- [ ] Rate limit funguje i po Vercel cold restartu
- [ ] `npm test` projde — minimálně 10 testů
- [ ] Profit.jsx ukazuje přesnost indikátory (shipping/returns/fees status)
- [ ] Event detection — jeden zdroj pravdy (`lib/event-detector.js`)
- [ ] CLAUDE.md aktualizovaný
- [ ] `npm run build` projde
- [ ] `vercel dev` — všech 5 tabů funguje, store switching funguje

---

## Pravidla (z CLAUDE.md)

- Max 300 řádků per soubor — pokud nový soubor roste, extrahuj
- `catch (e) {}` je zakázáno — vždy loguj
- `npm install` vždy s `--legacy-peer-deps`
- Structured logging: `console.error('[Module] Description:', { key: value })`
- Měna: EUR (ne USD)
- Nepush do Shopify bez approval workflow
- Po každé větší změně aktualizuj CLAUDE.md

---

## Rizika

- **BUG 1 (brand prompt):** `getStoreKnowledge()` (ř. 7-35) už načítá per-store data — ale `BRAND_SYSTEM_PROMPT` je statický. Řešení: dynamický prompt z DB, fallback pro story bez brand-voice skillu. Ověřit, že všechny 3 story mají `brand-voice` skill v `store_skills` tabulce.
- **BUG 2 (P&L store routing):** Profit tab se předává `storeId` prop z `App.jsx` — ověřit data flow `App → Profit → useProfit → api.getProfitSummary`.
- **BUG 5 (rate limiter):** Async Supabase query nahradí synchronní volání — všechny callery musí přejít na `await`. Hledat usage: `rateLimit(` v celém projektu.
- **1.1 (Shipping):** Shopify REST API vrací `shipping_lines` — ale jen pokud order má shipping. Digital products nemají. Ošetřit fallback na 0.
- **1.2 (Returns):** Refund může být partial — sčítat `refund.transactions[].amount`, ne flagovat celý order. Testovat s reálnými Shopify daty.
- **1.5 (Testy):** Vercel serverless handlers mají `(req, res)` interface — potřeba mock request/response objekty pro unit testy.

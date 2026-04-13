# DEV BRIEF — Sprint 2: system.js Modularizace

> **Projekt:** Titan Commerce (multi-store SaaS dashboard)
> **Datum:** 2026-04-13
> **Prerekvizita:** Přečti si `CLAUDE.md` v rootu projektu.

---

## Kontext

`api/system.js` má **1849 řádků a 45 action handlerů** v jedné funkci. Neudržitelné — těžká orientace, velké diffy, žádná izolace. Cíl: rozřezat do logických modulů v `lib/actions/`, system.js zůstane jako thin router (~80 řádků).

**KRITICKÉ OMEZENÍ:** Vercel Hobby má limit 12 serverless routes. Všech 12 je obsazených. `api/system.js` MUSÍ zůstat jako jediný route soubor — moduly v `lib/actions/` jsou importované funkce, NE nové API routes.

---

## Přístup

### system.js router pattern

Nový system.js bude vypadat takto (~80 řádků):

```js
import { withAuth } from '../lib/auth.js';

// GET actions
import { storesList } from '../lib/actions/stores.js';
import { pipelineLog } from '../lib/actions/pipeline.js';
import { kpi, metaOverview, insights } from '../lib/actions/analytics.js';
import { profitSummary } from '../lib/actions/profit.js';
import { proposalsList, approveProposal, rejectProposal, approveAllProposals, scanEvents } from '../lib/actions/proposals.js';
import { pendingOptimizations, optimizeProduct, approveOptimization, rejectOptimization, saveOptimization } from '../lib/actions/optimizations.js';
// ... etc

const GET_ACTIONS = {
  stores_list: storesList,
  pipeline_log: pipelineLog,
  kpi: kpi,
  profit_summary: profitSummary,
  // ... all GET actions
};

const POST_ACTIONS = {
  update_creative: updateCreative,
  optimize_product: optimizeProduct,
  // ... all POST actions
};

async function handler(req, res) {
  const action = req.query.action || req.body?.action;
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    if (req.method === 'GET') {
      const fn = GET_ACTIONS[action];
      if (!fn) return res.status(400).json({ error: `Unknown GET action: ${action}` });
      return fn(req, res);
    }
    if (req.method === 'POST') {
      const fn = POST_ACTIONS[action];
      if (!fn) return res.status(400).json({ error: `Unknown POST action: ${action}` });
      return fn(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`[system/${action}] Error:`, err);
    return res.status(500).json({ error: `Action '${action}' failed`, details: err.message });
  }
}

export default withAuth(handler);
```

### Pravidla pro moduly

Každý modul v `lib/actions/`:
1. **Exportuje pojmenované funkce** — `export async function storesList(req, res) { ... }`
2. **Vlastní importy** — každý modul importuje jen co potřebuje (supabase, getStore, atd.)
3. **Supabase client** — sdílený z `lib/supabase.js` (už existuje), ne vytvářet nový v každém modulu
4. **Max 300 řádků** per soubor (CLAUDE.md pravidlo)
5. **Žádné funkční změny** — jen přesun kódu, logika zůstává identická

---

## Sdílené závislosti

Tyto importy se opakují napříč moduly. Modul si importuje jen co potřebuje:

```js
// Většina modulů:
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Moduly pracující se Shopify:
import { getStore, getAllStores } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';

// Moduly s rate limitingem:
import { rateLimit } from '../rate-limit.js';

// Moduly s AI:
// import Anthropic dynamicky: const Anthropic = (await import('@anthropic-ai/sdk')).default;
```

**TIP:** `upsertSkill()` funkce (aktuálně ř. 18-47 v system.js) se používá v `skills.js` a `docs.js` — extrahovat do sdíleného `lib/skill-utils.js` nebo nechat v `skills.js` a importovat z `docs.js`.

---

## 13 modulů — co kam patří

### 1. `lib/actions/stores.js` (~15 řádků)

**GET:**
- `stores_list` (ř. 57-65) — vrací `getAllStores()` se stripnutým `admin_token`

### 2. `lib/actions/pipeline.js` (~15 řádků)

**GET:**
- `pipeline_log` (ř. 66-73) — `pipeline_log` tabulka, filtrovaná per store_id

### 3. `lib/actions/analytics.js` (~50 řádků)

**GET:**
- `kpi` (ř. 74-85) — 7d agregace z `performance` tabulky
- `meta_overview` (ř. 403-410) — Meta API read (if connected)
- `insights` (ř. 241-265) — action cards (products without creatives, declining, winners)

### 4. `lib/actions/profit.js` (~140 řádků)

**GET:**
- `profit_summary` (ř. 86-220) — kompletní P&L (revenue, COGS, shipping, returns, fees, adspend). Největší single action.

### 5. `lib/actions/proposals.js` (~105 řádků)

**GET:**
- `proposals_list` (ř. 266-281) — pending proposals s expiry filtrem

**POST:**
- `approve_proposal` (ř. 729-763) — execute proposal akce
- `reject_proposal` (ř. 764-773) — update status
- `approve_all_proposals` (ř. 774-791) — bulk approve
- `scan_events` (ř. 792-812) — manuální trigger event detection (volá `detectEventsForStore()`)

### 6. `lib/actions/optimizations.js` (~180 řádků)

**GET:**
- `pending_optimizations` (ř. 221-240) — list pending

**POST:**
- `optimize_product` (ř. 484-552) — Claude AI optimization
- `approve_optimization` (ř. 553-608) — push to Shopify
- `reject_optimization` (ř. 609-626) — update status
- `save_optimization` (ř. 627-637) — save draft

### 7. `lib/actions/creatives.js` (~210 řádků)

**POST:**
- `update_creative` (ř. 456-467) — update hook/headline
- `generate_branded` (ř. 638-728) — generate branded content via Higgsfield
- `push_creative_to_shopify` (ř. 1262-1322) — upload to Shopify
- `cleanup_stale` (ř. 828-865) — delete old pending creatives

### 8. `lib/actions/products.js` (~280 řádků) ⚠ blízko limitu

**GET:**
- `product_detail` (ř. 299-346) — full Shopify product data

**POST:**
- `scrape_product` (ř. 1473-1514) — scrape URL
- `import_confirm` (ř. 1515-1640) — import scraped product to Shopify + auto-optimize + auto-generate
- `update_product_full` (ř. 1388-1472) — full product update to Shopify
- `bulk_price` (ř. 813-827) — bulk variant price update

### 9. `lib/actions/pricing.js` (~20 řádků)

**POST:**
- `update_cogs` (ř. 468-475) — update product COGS
- `manual_adspend` (ř. 476-483) — add manual adspend entry

### 10. `lib/actions/skills.js` (~175 řádků)

**GET:**
- `get_skills` (ř. 391-402) — list all skills for store

**POST:**
- `generate_skills` (ř. 866-975) — generate from store_knowledge
- `regenerate_skill` (ř. 976-1024) — regenerate single skill

**Poznámka:** `upsertSkill()` helper funkce (ř. 18-47) patří sem — exportovat pro použití v `docs.js`.

### 11. `lib/actions/docs.js` (~285 řádků) ⚠ blízko limitu

**GET:**
- `store_docs` (ř. 347-376) — recursive file listing
- `store_docs_download` (ř. 377-390) — get public URL

**POST:**
- `upload_store_doc` (ř. 1025-1111) — upload + auto-process
- `process_single_file` (ř. 1112-1174) — process one inbox file
- `process_inbox` (ř. 1175-1261) — batch process inbox

**Import:** `upsertSkill` z `skills.js`, `extractText/classifyDocument/extractInsights/identifyProduct` z `doc-processor.js`

### 12. `lib/actions/size-chart.js` (~105 řádků)

**GET:**
- `read_size_chart` (ř. 282-298) — read from Shopify metafield
- `refresh_size_charts` (ř. 411-430) — bulk check all products

**POST:**
- `save_size_chart` (ř. 1323-1348) — save to Shopify metafield + update has_size_chart
- `parse_size_chart_image` (ř. 1349-1387) — Claude Vision extract

### 13. `lib/actions/custom-styles.js` (~235 řádků)

**GET:**
- `custom_styles` (ř. 431-455) — list custom styles for store

**POST:**
- `analyze_style` (ř. 1641-1688) — Claude Vision analyze reference photos
- `create_custom_style` (ř. 1689-1734) — save style to DB + Storage
- `delete_custom_style` (ř. 1735-1763) — delete skill + Storage files
- `describe_style` (ř. 1764-1786) — Claude generate style from text
- `scrape_style` (ř. 1787-1849) — scrape URL + analyze

---

## Input validation helper — `lib/validate.js`

Nový helper (~15 řádků):

```js
export function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    return { error: `Missing required fields: ${missing.join(', ')}`, status: 400 };
  }
  return null;
}

export function requireQuery(query, fields) {
  return requireFields(query, fields);
}
```

Použití v modulu:
```js
import { requireFields } from '../validate.js';

export async function saveOptimization(req, res) {
  const invalid = requireFields(req.body, ['store_id', 'product_id']);
  if (invalid) return res.status(invalid.status).json({ error: invalid.error });
  // ...
}
```

Aplikovat na všechny POST akce během extrakce.

---

## Pořadí práce (doporučené)

**Fáze 1: Infrastruktura**
1. Vytvořit `lib/actions/` složku
2. Vytvořit `lib/validate.js`

**Fáze 2: Extrakce malých modulů** (nízké riziko, rychlé)
3. `stores.js` (15 ř.)
4. `pipeline.js` (15 ř.)
5. `pricing.js` (20 ř.)
6. `analytics.js` (50 ř.)
7. → Po každém: ověřit `vercel dev` + příslušné akce

**Fáze 3: Střední moduly**
8. `proposals.js` (105 ř.)
9. `size-chart.js` (105 ř.)
10. `profit.js` (140 ř.)
11. `skills.js` (175 ř.) — exportovat `upsertSkill()`

**Fáze 4: Velké moduly**
12. `optimizations.js` (180 ř.)
13. `creatives.js` (210 ř.)
14. `custom-styles.js` (235 ř.)
15. `products.js` (280 ř.)
16. `docs.js` (285 ř.) — importuje `upsertSkill` z skills.js

**Fáze 5: Finalizace**
17. Přepsat `system.js` na router (importy + ACTIONS map)
18. Smazat veškerý extrahovaný kód z system.js
19. Finální test: `npm run build` + `npm test` + `vercel dev` všech 5 tabů
20. Aktualizovat CLAUDE.md (nová struktura `lib/actions/`)

---

## KRITICKÁ PRAVIDLA

1. **Žádné funkční změny** — jen přesun kódu. Logika, response formát, error handling zůstávají identické.
2. **Static importy** — Vercel bundler potřebuje static imports. Žádné `await import()` v router mapě.
3. **`upsertSkill()` sdílená** — exportovat z `skills.js`, importovat v `docs.js`
4. **Supabase client** — v každém modulu vlastní instance (ne sdílená): `const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)`
5. **Anthropic SDK** — dynamic import v modulech co to potřebují: `const Anthropic = (await import('@anthropic-ai/sdk')).default`
6. **Po každé extrakci testovat** — neextrahovat 5 modulů najednou bez testu
7. **Max 300 řádků** per modul. `products.js` (280) a `docs.js` (285) jsou na hraně — pokud při extrakci narostou, rozdělit.
8. **`lib/higgsfield.js` prompt logika je SACRED** — nedotýkat se. `generate_branded` v `creatives.js` volá `buildStyledPrompt()` — jen přesunout volání, neměnit.

---

## Definition of Done

- [ ] `api/system.js` je pod 100 řádků (router only)
- [ ] 13 modulů v `lib/actions/` — každý pod 300 řádků
- [ ] `lib/validate.js` existuje a je aplikovaný na všechny POST akce
- [ ] Všech 45 akcí funguje identicky (žádná funkční změna)
- [ ] `npm run build` projde
- [ ] `npm test` projde (21 testů)
- [ ] `vercel dev` — všech 5 tabů funguje, store switching, generování, P&L, proposals
- [ ] CLAUDE.md aktualizovaný (nová `lib/actions/` struktura v Key Files)

---

## Rizika

- **Vercel bundler:** Static importy jsou nutné. Pokud modul nemá side-effect import na top level, Vercel ho neinkluduje. Ověřit po každém kroku s `vercel dev`.
- **Circular dependencies:** `docs.js` importuje `upsertSkill` z `skills.js`. Pokud `skills.js` importuje něco z `docs.js` → circular. Ověřit.
- **`products.js` (280 ř.) a `docs.js` (285 ř.):** Na hraně 300 limitu. Při přidávání validace mohou přerůst → rozdělit (`products.js` → `products.js` + `product-import.js`).
- **Testy:** `tests/system-routing.test.js` testuje system.js handler — po refactoru musí stále fungovat (router deleguje na moduly, ale interface je stejný).

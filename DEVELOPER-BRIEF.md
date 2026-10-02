# BUG — Kolekce v Products ukazuje jen produkty z první stránky (Isola: 17 z 20 podprsenek)

*Nahlásil Dan, 2026-10-02.*

**Příčina:** `apps/dashboard/src/lib/api.js::getAllProducts` přes svůj název načte jen první stránku
(`getProducts(storeId, { limit: 200 })`). Isola má 228 produktů, takže 28 z nich v „celém katalogu“ chybí.
Kolekce Bras má 20 produktů, ale 3 jsou na 2. stránce (Underwire Support Seamless Unlined Balconette Bra,
Wireless Leopard V-Neck Contour Bra, Wireless Support & Lift V-Neck Mesh Bra) → filtr kolekce ukáže 17.

**Kde se to projevuje:**
- `pages/Products.jsx` ~ř. 112: filtr kolekce / ceny / statusu a hledání (načtení celého katalogu).
- `App.jsx` ~ř. 73 a ~ř. 139: otevření produktu z URL `?product=` a `handleNavigateToProduct` (produkt z 2. stránky se nenajde).
- `AssignProductsToChartModal.jsx` ř. 18: přiřazení size chartu (chybí produkty z 2. stránky).

**Oprava:** `getAllProducts(storeId, show_archived)` ať stránkuje přes všechny stránky (stejně jako už existující
`getAllProductsPaged`, ale s podporou `show_archived`), případně obě funkce sloučit do jedné.

**Acceptance criteria:**
- Products → filtr kolekce „Bras“ u Isoly ukáže 20 produktů (ověřit proti isolaworld.com/collections/bras).
- Otevření produktu z 2. stránky přes `?product=<id>` funguje.
- Size chart modal nabízí všech 228 produktů Isoly.

## Pro developera — copy-paste prompt (bug)

Oprav bug popsaný v DEVELOPER-BRIEF.md (sekce „BUG — Kolekce v Products ukazuje jen produkty z první stránky“).

Klíčové soubory:
- apps/dashboard/src/lib/api.js (getAllProducts, getAllProductsPaged)
- apps/dashboard/src/pages/Products.jsx, apps/dashboard/src/App.jsx, apps/dashboard/src/components/AssignProductsToChartModal.jsx

Acceptance criteria:
- Filtr kolekce „Bras“ u Isoly ukáže 20 produktů, ne 17
- Produkt z 2. stránky jde otevřít přes ?product=<id>
- Size chart modal nabízí všechny produkty store

Postup:
1. Načti DEVELOPER-BRIEF.md a uvedené soubory
2. getAllProducts ať stránkuje přes všechny stránky (zachovat show_archived)
3. Ověř v dashboardu na Isole (228 produktů)
4. Vytvoř PR s názvem "fix(products): load every page of the catalog, not just the first 200"

Pokud něco není jasné, zeptej se před začátkem implementace.

---

# DEVELOPER-BRIEF — Přepínač „zobrazit původ“ u recenzí + hromadná úprava (Reviews panel)

*Zadal Dan, 2026-10-02.*

## Kontext

Recenze importované z jiného obchodu mají v `product_reviews.origin_site` hostname obchodu (např. `celeste-dor.com`,
`amazon.com`). Push (`lib/actions/reviews-push.js::push_reviews_to_shopify`) je dnes pošle do Shopify jen tehdy, když má
store zapnuté `brand_config.features.review_origin_label`, a pak u nich téma vypíše „Originally posted on …“.
Jinak je celé zadrží (`held_back`).

Dan chce o tom rozhodovat **sám u každé recenze** v dashboardu, ne přes nastavení celého obchodu. Příklad: recenze z
`celeste-dor.com` (obchod z jejich skupiny, se souhlasem) chce zobrazovat jako vlastní, bez štítku; jiné ponechat se
štítkem. Potřebuje to i hromadně (stovky recenzí naráz).

Isola: 469 recenzí podprsenek naimportovaných 2026-10-02 s `origin_site` (345× celeste-dor.com, 81× amazon.com,
26× oeak.com, 8× delimira.com, 6× dobreva.com, 3× vertvie.com), všechny `pending`.

## Požadavky

### 1. DB — nový sloupec `product_reviews.show_origin`
- `sql/add-review-show-origin.sql`: `ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS show_origin boolean NOT NULL DEFAULT true;`
- `origin_site` se nemaže, zůstává jako záznam, odkud recenze je. `show_origin` jen říká, jestli se původ ukáže na webu.
- Význam má jen u řádků s `origin_site`; u vlastních recenzí se ignoruje.

### 2. Push — `lib/actions/reviews-push.js`
- Recenze s `origin_site` a `show_origin = false` se chová jako vlastní recenze: jde do metafieldu i do průměru **bez
  ohledu** na `review_origin_label`, v payloadu **bez** `origin_site` (`toStorefrontReview`), a označí se `published`.
- Recenze s `origin_site` a `show_origin = true` beze změny (gate přes `review_origin_label`, se štítkem).
- `refreshStoreReviewsAggregate` (cca ř. 283): `show_origin = false` počítat jako vlastní.
- Do `select` přidat `show_origin`; `heldNote` a `held_back` počítat jen z `show_origin = true`.
- ⚠️ V lokálním working tree na `main` je neuložená změna v tomhle souboru, která maže definice `showsOrigin` a `heldNote`
  (použití zůstala → ReferenceError při pushi). **Nebrat ji**, vycházet z `9caaf17`.

### 3. API
- `update_review` (`lib/actions/reviews.js`): přijímat `show_origin` (boolean).
- Nová akce `set_review_origin` (POST, `lib/actions/reviews.js`, router v `api/system.js`):
  `{ ids: string[], store_id, show_origin: boolean }` → update jen řádků daného `store_id`. Gate `products:edit` +
  `hasStoreAccess` jako `set_review_status`. Pokud se mění `published` recenze, označit produkt k re-push
  (`flagProductNeedsRepush`). Vrátit `{ updated }`. Max 1000 ids na request.
- Volitelně v `import_amazon_reviews` přijmout request-level `show_origin` (default `true`), ať jde rovnou importovat
  jako „bez štítku“.
- `apps/dashboard/src/lib/api.js`: `setReviewOrigin(ids, showOrigin, storeId)`.

### 4. UI — `apps/dashboard/src/components/ReviewsPanel.jsx` (+ `ReviewsPanel.css`)
- Nový sloupec **Origin**: hostname z `origin_site` (nebo „—“) + **checkbox „Show origin“** přímo v řádku
  (inline toggle → `set_review_origin` s jedním id). Pro recenze bez `origin_site` disabled.
- **Výběr řádků**: checkbox na začátku každého řádku + „vybrat vše“ v hlavičce (vybrat vše = aktuálně zobrazené).
- **Hromadná lišta** při ≥1 vybrané: „Show origin“, „Hide origin“, „Approve“, „Reject“ (poslední dvě přes existující
  `setReviewStatus`). Po akci reload seznamu + toast s počtem.
- Rychlý filtr nad tabulkou: Origin = vše / bez původu / `<hostname>` (seznam z načtených recenzí) — aby šlo vybrat
  např. všechny `celeste-dor.com` a jedním klikem jim vypnout štítek.
- `ReviewDetail.jsx`: checkbox „Show ‘Originally posted on …’“ (jen když má recenze `origin_site`).

### 5. Testy (vitest)
- push: `show_origin=false` + flag vypnutý → recenze v payloadu, bez `origin_site`, v průměru, označena `published`.
- push: `show_origin=true` + flag vypnutý → zadržena (beze změny proti `reviews-push-origin.test.js`).
- `set_review_origin`: 403 bez `products:edit`, 403 cizí store, update jen v rámci `store_id`, re-push flag.

## Acceptance criteria
- V Reviews panelu u Isola produktu vidím sloupec Origin s checkboxem a můžu ho přepnout u jedné recenze.
- Vyberu filtrem všechny `celeste-dor.com`, „vybrat vše“, „Hide origin“ → všechny mají `show_origin=false`.
- Push takového produktu pošle recenze do Shopify bez štítku, i když `review_origin_label` není zapnutý.
- Recenze se `show_origin=true` se chovají jako dnes.
- Migrace aplikovaná na prod Supabase před deployem kódu; testy zelené.

## Out of scope
- Změny tématu (`titan-reviews.liquid`) — štítek už umí podle `origin_site` v payloadu.
- Mazání `origin_site`, změna `review_origin_label` logiky pro celý store.

## Soubory
- `sql/add-review-show-origin.sql` (nový)
- `lib/actions/reviews-push.js`, `lib/actions/reviews.js`, `lib/actions/reviews-amazon.js` (volitelně), `api/system.js`
- `apps/dashboard/src/lib/api.js`, `apps/dashboard/src/components/ReviewsPanel.jsx`, `ReviewsPanel.css`, `ReviewDetail.jsx`
- `tests/reviews-push-origin.test.js`, nový `tests/review-origin-bulk.test.js`
- `CLAUDE.md` (tabulka `product_reviews`, popis reviews-push)

---

## Pro developera — copy-paste prompt

Pracuj na úkolu popsaném výše v DEVELOPER-BRIEF.md (sekce „Přepínač ‚zobrazit původ‘ u recenzí + hromadná úprava“).

Klíčové soubory:
- sql/add-review-show-origin.sql (nový)
- lib/actions/reviews-push.js
- lib/actions/reviews.js + api/system.js
- apps/dashboard/src/components/ReviewsPanel.jsx, ReviewDetail.jsx, lib/api.js

Acceptance criteria:
- Sloupec Origin s checkboxem „Show origin“ v Reviews panelu (inline toggle)
- Výběr řádků + „vybrat vše“ + hromadné Show/Hide origin, Approve, Reject; filtr podle origin
- Push: `show_origin=false` jde do Shopify bez štítku i bez `review_origin_label`; `show_origin=true` beze změny
- Testy push + set_review_origin zelené; migrace aplikovaná na prod před deployem

Postup:
1. Načti DEVELOPER-BRIEF.md a relevantní existující kód (vycházej z commitu 9caaf17, ne z neuložené změny v reviews-push.js)
2. Implementuj změny
3. Vitest (push + bulk endpoint), ruční ověření v dashboardu na Isola produktu
4. Vytvoř PR s názvem "feat(reviews): per-review show-origin toggle + bulk edit"

Pokud něco není jasné, zeptej se před začátkem implementace.

---

# Předchozí zadání

# DEVELOPER-BRIEF — Model Info metafieldy (Isola "model wearing" size)

## Kontext

Isola Shopify theme má na produktové stránce hotovou sekci **"Our model is wearing size X"**
(`snippets/size-guide-drawer.liquid`), která čte tyto Shopify product metafieldy v namespace `custom`:

| Metafield | Typ | Účel |
|---|---|---|
| `custom.show_model_info` | boolean | zobrazit/skrýt model sekci |
| `custom.model_size` | single_line_text | velikost (`S`, `M`, `One Size`…) |
| `custom.model_height` | single_line_text | výška (`175 cm`) |
| `custom.model_image` | file/image | (volitelné, později) |
| `custom.model_bust/waist/hips` | single_line_text | (zatím NEpoužíváme — bez měr) |

Tyto metafieldy jsou aktuálně **prázdné** u všech ~63 active Isola produktů. Cíl: naplnit je
hromadně přes Titan Commerce (TC už metafieldy do Shopify zapisuje — viz `size_chart_text`).

**Odvozená velikost modelky (175 cm) — logika podle typu produktu:**
- název obsahuje `bikini` / `two-piece` / `tie-side` / `string` → **S** (menší kusy)
- `dress` / `one-piece` / `swimsuit` / `tankini` / `cover-up` / `maxi` / `sarong` → **M**
- `One Size` → převzít `One Size`
- číselný systém (`7-8`,`9-10`…) → prostřední hodnota
- výška vždy `175 cm`, `show_model_info` vždy `true`

Podklad: vygenerované CSV `~/Desktop/Projects/isola-model-info.csv`
(sloupce: Handle, Title, Shopify ID, Available Sizes, custom.model_height, custom.model_size,
custom.show_model_info). 63 produktů, rozložení 41×M, 18×S, 3×One Size, 1×číselné.

## Požadavky

### 1. Nová action `save_model_info` (POST) — `lib/actions/model-info.js`
Vzor: existující `lib/actions/size-chart.js::save_size_chart` (řádky 49-72). Zapíše 3 metafieldy
jednoho produktu do Shopify a označí stav v DB.

- Vstup: `{ store_id, product_id, model_size, model_height, show_model_info }`
- Ověř store (`getStore`), `admin_token`, dohledej `shopify_id` z `products` tabulky.
- Přes `createShopifyClient(...).updateMetafield(shopify_id, 'custom', key, value, type)` zapiš:
  - `model_size` → type `single_line_text_field`
  - `model_height` → type `single_line_text_field`
  - `show_model_info` → type `boolean` (hodnota `'true'`/`'false'` jako string — ověř, že Shopify
    boolean metafield přijímá string; jinak použij `'true'`/`''`)
- Zaloguj do `pipeline_log` (`agent: 'MODEL_INFO'`, level success), stejně jako size-chart (ř.65-69).
- Vrať `{ ok: true }`.

### 2. Action `read_model_info` (GET) — stejný soubor
Vzor: `read_size_chart` (ř.11-25). Vrátí aktuální 3 metafieldy produktu pro zobrazení v UI.

### 3. (volitelné, doporučené) Action `bulk_save_model_info` (POST)
Hromadný zápis pro všechny produkty store podle odvozovací logiky výše — aby se nemuselo
klikat 63×. Vstup: `{ store_id }` (+ volitelně override mapa `{ product_id: size }`).
- Načti všechny active produkty store (`products` where `store_id`, `status='active'`,
  `shopify_id not null`). POZOR: vyfiltruj ne-produkty (handle `mystery-gift`,
  `shipping-insurance`, `navidium-shipping-protection`, `shipping-protection`).
- Pro každý odvoď `model_size` dle logiky z Kontextu (typ z `title`). Velikosti variant
  TC DB NEMÁ — buď je dotáhni ze Shopify (`getFullProduct` → options), nebo přijmi
  předpočítané z CSV/UI. **Doporučení:** přijmout mapu `{ shopify_id: model_size }` z frontendu
  (frontend ji spočítá z CSV), backend jen zapíše — jednodušší, deterministické.
- Iteruj sekvenčně (Shopify rate-limit), loguj průběh, vrať `{ total, updated, failed }`.

### 4. Router — `api/system.js`
Zaregistruj `save_model_info`, `read_model_info` (+ `bulk_save_model_info`) do importu (ř.11 vzor)
a do dispatch mapy (ř.35+ vzor). NENÍ potřeba nová Vercel routa — pod 12-route limitem,
jen rozšíření thin routeru.

### 5. Dashboard UI (pokud size-chart UI existuje, přidat vedle něj)
- Na detailu produktu: pole `model_size` (text/select), `model_height` (default `175 cm`),
  toggle `show_model_info`. Tlačítko "Save model info" → `save_model_info`.
- Tlačítko "Bulk fill model sizes" (per store) → `bulk_save_model_info` s předpočítanou mapou.
- Pokud size-chart UI zatím není, stačí backend actions + bulk; UI dořešíme samostatně.

## Acceptance criteria
- `save_model_info` zapíše 3 metafieldy do Shopify; ověřitelné v Admin → produkt → Metafields.
- Theme sekce "Our model is wearing size X" se na PDP zobrazí (po zápisu `show_model_info=true`).
- `bulk_save_model_info` naplní všech ~63 active produktů dle logiky, vyloučí 3 ne-produkty.
- Žádná regrese existujících size-chart actions; system.js se nerozbije (import-guard test prošel).
- Multi-store: action respektuje `store_id` + per-store `admin_token` (jako size-chart).

## Out of scope
- `model_image`, `model_bust/waist/hips` (zatím bez měr a foto modelky).
- Theme změny (sekce už existuje, čte metafieldy).
- Reálné velikosti z focení — logika je odhad z názvu; ruční override přes UI je možný.

## Soubory
- NOVÝ: `lib/actions/model-info.js`
- UPRAVIT: `api/system.js` (registrace actions)
- UPRAVIT: dashboard product detail (pokud size-chart UI existuje) — `src/...`
- VZOR: `lib/actions/size-chart.js`, `lib/shopify-admin.js::updateMetafield`
- PODKLAD: `~/Desktop/Projects/isola-model-info.csv`

---

## Pro developera — copy-paste prompt

Pracuj na úkolu popsaném výše v DEVELOPER-BRIEF.md (Model Info metafieldy).

Klíčové soubory:
- NOVÝ: `lib/actions/model-info.js` (vzor: `lib/actions/size-chart.js`)
- `api/system.js` (registrace actions — import ř.11 vzor + dispatch mapa)
- `lib/shopify-admin.js` (`updateMetafield` — pozor na metafield typy)
- podklad: `~/Desktop/Projects/isola-model-info.csv`

Acceptance criteria:
- `save_model_info` + `read_model_info` actions fungují (zápis/čtení 3 metafieldů: model_size, model_height, show_model_info v namespace `custom`)
- `bulk_save_model_info` naplní všech ~63 active Isola produktů dle logiky (typ z názvu → S/M/One Size), vyloučí 3 ne-produkty (mystery-gift, shipping-insurance, navidium-shipping-protection, shipping-protection)
- Theme sekce "Our model is wearing size X" se po zápisu zobrazí na PDP
- Žádná regrese size-chart actions, system.js se nerozbije
- Multi-store: respektuje store_id + per-store admin_token

Postup:
1. Načti DEVELOPER-BRIEF.md + existující `lib/actions/size-chart.js` jako vzor
2. Vytvoř `lib/actions/model-info.js` (save/read + bulk)
3. Zaregistruj actions v `api/system.js`
4. (pokud existuje size-chart UI) přidej model-info pole na product detail + bulk tlačítko
5. Otestuj zápis na 1 produktu → ověř v Shopify Admin Metafields → ověř že theme PDP sekci zobrazí
6. Vytvoř PR s názvem "feat(model-info): write model_size/height metafields to Shopify"

Pokud něco není jasné, zeptej se před začátkem implementace.

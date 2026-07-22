---
id: feature-01
slug: publications-manager
status: active
appetite: medium              # 4 dev-days
owner: dan
created: 2026-07-23
shipped: null
flag:
  name: feature.publications_manager.enabled
  tool: env-var               # Titan nemá PostHog → process.env.FEATURE_PUBLICATIONS_MANAGER
  default: off
  cleanup_by: 2026-09-01
depends_on: []
blocks: []
informs: []
files_owned:
  - lib/actions/publications.js
  - lib/actions/exports.js
  - apps/dashboard/src/components/products/StatusFilter.jsx
  - apps/dashboard/src/components/products/SelectionToolbar.jsx
  - apps/dashboard/src/components/products/BulkConfirmModal.jsx
  - sql/add-publications-manager.sql
  - tests/publications.test.js
  - tests/exports.test.js
files_shared:
  - lib/product-upsert.js       # fix status hardcode
  - api/auth/shopify.js         # + write_publications, read_publications scopes
  - lib/shopify-admin.js        # + publishableUnpublish/Publish GraphQL wrappers
  - api/system.js               # register publications.* + exports.* actions
  - apps/dashboard/src/pages/Products.jsx  # filter + bulk bar + export button
  - lib/rate-limit.js           # + publications_manager_bulk entry
---

# Publications Manager

> Bulk-unlist Shopify products from Online Store + export product URLs to CSV, without clicking every product individually in Shopify Admin.

## Job story

When mám v Shopify hodně nově přidaných produktů ve stavu DRAFT a chci je zpřístupnit jen přes přímý link (ne v katalogu),
I want to hromadně přes Titan Commerce (a) přepnout jejich status na ACTIVE a (b) odpojit je z Online Store sales channelu,
so I can s každým produktem nemusím klikat individuálně v Shopify Adminu a odkazy dál použít (interní distribuce, sdílení).

## Problem (Shape Up)

**Pain:** Dan spravuje Isola (Shopify) přes Titan. Má desítky DRAFT produktů, které chce jako "unlisted" — aktivní přímý link, ale skryté z Online Store katalogu (YouTube-unlisted analogy). Shopify na to nemá bulk UI ani nativní status; musí se `status ACTIVE` + `publishableUnpublish(online_store)`. Ruční klikání přes desítky produktů = hodiny.

**Cost of not shipping:** Titan už má Shopify integraci, `bulk_price` pattern — ale (a) neukládá reálný status (hardcode `'active'` v `product-upsert.js:25`), (b) nemá `write_publications` scope, (c) nemá publications logiku, (d) chybí produktový CSV export. Bez fixu = pokračující ruční práce = ztracený čas.

## Appetite

`medium (4 dev-days)`. Kill at 1.5× (6d) without green ACs.

## Solution sketch (rough — NOT a design spec)

- Fix `product-upsert.js:25` → ukládat `p.status` (draft/active/archived)
- `+ stores.online_store_publication_id` (one-shot GraphQL lookup při reautorizaci)
- `+ write_publications` + `read_publications` scopes → user reinstaluje appku
- Nový `lib/actions/publications.js` — `bulk_make_unlisted` + `bulk_make_listed` (per-product loop, jeden fail nezastaví batch)
- Nový `lib/actions/exports.js` — `export_products_csv` (respektuje filter)
- Register nové actions v `api/system.js` router
- Products.jsx UI: `StatusFilter` + checkbox selection + `BulkActionsBar` (unlisted/listed/export) + `BulkConfirmModal`
- Re-sync všech existujících stores po deployi upsert fixu

## Acceptance criteria (Gherkin)

```gherkin
Scenario: Bulk make draft products unlisted (active + hidden from Online Store)
  Given jsem v Products tab s aplikovaným filtrem "Status: Draft"
  And mám vybraných 5 produktů přes checkboxy
  When kliknu "Make Unlisted" v bulk actions baru
    # akce = productUpdate(status=ACTIVE) + publishableUnpublish(online_store)
  And potvrdím confirm modal (obsahuje seznam všech 5 titulů)
  Then všech 5 produktů se v Shopify přepne na status=ACTIVE (pokud byly DRAFT)
  And všech 5 se odpojí z Online Store publication
  And přímý product URL (myshopify.com/products/{handle}) vrací 200 a produkt
  And v Titan DB se aktualizuje jejich status na 'active' a publication_online_store na false
  And UI zobrazí success toast "5 produktů unlisted"

Scenario: Per-product error handling in bulk operation
  Given 5 selected produktů, jeden má invalid state v Shopify
  When spustím bulk unpublish
  Then 4 produkty se úspěšně upravily
  And 1 produkt selhal s konkrétní error zprávou
  And UI zobrazí partial success ("4 OK, 1 selhal — [detail]")
  And bulk operace se nezastaví na tom jednom failu

Scenario: Export filtered products to CSV
  Given jsem v Products tab s libovolným aktivním filtrem
  When kliknu "Export CSV"
  Then stáhne se CSV obsahující title, product_url, visibility
    # visibility = human-readable: 'draft' | 'listed' | 'unlisted' | 'archived'
  And obsahuje pouze produkty odpovídající aktuálnímu filtru
```

## Edge cases (Happy / Sad / Weird / Hostile-STRIDE)

| Quadrant | Case | Handling |
|---|---|---|
| **Happy** | 5-10 clean drafts → bulk make unlisted | All → ACTIVE + unpublished, DB sync, success toast |
| **Happy** | Export 100 řádků s filtrem | CSV stáhne < 3 s, jen filtrované řádky |
| **Sad** | Shopify rate limit mid-batch | Exp. backoff, retry 3×, partial success + audit log |
| **Sad** | Síťový timeout na jednom produktu | Označen failed, batch pokračuje, UI hlásí partial |
| **Sad** | Produkt už archived v Shopify | Skip s hláškou, batch pokračuje |
| **Sad** | Prázdný filter → export | CSV s hlavičkou, 0 řádků, NIKDY 404 |
| **Weird** | Produkt v POS/jiném publication | Dotýkáme se JEN Online Store, ostatní beze změny |
| **Weird** | Produkt smazán ze Shopify (v DB ještě je) | 404 → per-item error "product not found", pokračuj |
| **Weird** | Export 10 000+ řádků | Streaming CSV; async není v MVP → hard cap 5 000 |
| **Weird** | Titles s uvozovkami/čárkami/emoji/RTL | RFC 4180 escaping, UTF-8 BOM pro Excel |
| **Weird** | Dva bulk requesty na stejné produkty | Last-write-wins v Shopify; UI disabluje tlačítka během in-flight |
| **Hostile — S** | Bez session zavolá `/api/actions` | `withAuth()` guard + 401 |
| **Hostile — T** | Manipulace `product_ids` z cizího store | Server ověří že každý product_id patří `store_id` z body přes `products.store_id`; odmítne mismatch |
| **Hostile — R** | "Já bulk nespustil" | `pipeline_log` řádek (agent=`PUBLISHER` — existing registry entry, store_id, N produktů, duration, failed IDs) |
| **Hostile — I** | CSV obsahuje ceny/marže/COGS | Whitelist: `title, product_url, visibility` (draft/listed/unlisted/archived) |
| **Hostile — D** | User spustí bulk na 10 000+ produktech | Hard cap 500/request; UI + server enforce |
| **Hostile — E** | (N/A — auth je password gate, ne per-user) | Ochrana = validace store_id v body přes `getStore()` |

## Impact declarations

### Data model impact

```yaml
new_tables: []
new_columns:
  - stores.online_store_publication_id VARCHAR NULL              -- Shopify publication GID, one-shot lookup
  - products.publication_online_store BOOLEAN NULL DEFAULT NULL  -- cached publication state
new_indexes: []
migrations:
  - sql/add-publications-manager.sql
breaking: false
```

### API impact

```yaml
new_actions:            # via api/system.js router — NO new Vercel routes (12-route Hobby cap)
  - bulk_make_unlisted    # productUpdate(ACTIVE) + publishableUnpublish(online_store)
  - bulk_make_listed      # productUpdate(ACTIVE) + publishablePublish(online_store)
  - export_products_csv
modified_files:
  - lib/product-upsert.js    # hardcode → p.status
  - api/auth/shopify.js      # + write_publications, read_publications scopes
  - api/system.js            # register new actions
breaking: true               # scope change → user MUSÍ reautorizovat appku
auth: withAuth() global password gate; store isolation = require store_id in body + getStore()
rate_limit: publications_manager_bulk 10/min/user (lib/rate-limit.js); hard cap 500 products/call
error_handling: per-product try/catch → pipeline_log + partial-success response (NEVER swallow — CLAUDE.md rule)
```

### UI impact

```yaml
pages_touched: [/dashboard#products]      # Products.jsx — zero selection UI dnes, vše nové
new_components:                            # extracted (Products.jsx už 421 > 300 limit)
  - StatusFilter.jsx
  - SelectionToolbar.jsx                   # checkboxes + select-all + bulk dropdown
  - BulkConfirmModal.jsx
shared_components_modified: [Products.jsx] # + selectedIds state + filter + toolbar + export
new_routes: []                             # Vercel Hobby 12/12 cap už hit
```

## Feature flag + rollout

```yaml
flag:
  name: feature.publications_manager.enabled
  tool: env-var                    # process.env.FEATURE_PUBLICATIONS_MANAGER (Titan nemá PostHog)
  default: off
  cleanup_by: 2026-09-01
rollout:
  - { cohort: dan-only,   percent: 100, soak: 48h }  # interní testing na Isola store
  - { cohort: all-stores, percent: 100, soak: -    }
guardrails:
  - per-product error rate < 5 %
  - žádný unbounded error v prod logu
  - Shopify GraphQL cost < 80 % throttle limit
kill_switch: flip env var → UI tlačítka se schovají, in-flight bulk dokončí
```

## Success metric (NSM + guardrail)

```
NSM:       Dan unlistuje ≥ 20 produktů z drafts do 7 dnů po launchi
Guardrail: 0 unbounded errors; per-product error rate < 5 % v bulk operacích
```

## Kill criteria (MANDATORY)

- Kill if: > 1.5× appetite spent (> 6 dev-dnů) a Gherkin scenarios nezelené
- Kill if: Shopify Partner review zablokuje přidání `write_publications` scope
- Kill if: Dan neužije featuru do 30 dnů po launchi (= evaporated demand)
- Kill if: > 3 prod incidenty spojené s bulk operacemi v prvních 14 dnech

## Sub-scopes (for scope hammering)

```
mvp:
  - Fix product-upsert.js sync (real status)
  - Migrace + online_store_publication_id lookup
  - write_publications scope + reautorizace
  - bulk_make_unlisted action (+ api/system.js router entry)
  - StatusFilter + row checkboxes + SelectionToolbar + BulkConfirmModal UI
  - store_id validation via getStore() (multi-store isolation)
  - Happy path Gherkin scenario green

polish:
  - bulk_make_listed (reverse action — re-publish to Online Store)
  - CSV export action + tlačítko
  - Success/error toast styling
  - Loading states / skeleton

hardening:
  - Per-product error handling (partial success; NEVER `catch (e) {}`)
  - Rate limit backoff (Shopify GraphQL cost — respect throttle status.currentlyAvailable)
  - Audit log v pipeline_log (agent=PUBLISHER — existing registry entry, wire up here)
  - Timeout / retry logic (single retry per product on 5xx / rate-limit)
  - Full edge-case grid scenarios green

instrumentation:
  - Success metric event (publications_manager_bulk_unlisted_count)
  - Guardrail alert (error rate > 5 %)
  - Log každé bulk akce s N produktů + duration + list of failed product_ids
```

**Cut order under time pressure: instrumentation → polish → hardening. Never cut MVP.**

## Rabbit holes / No-gos

- Don't: další publication channels (POS/Buy Button/FB) — jen Online Store
- Don't: scheduling ("unpublish za 3 dny") — jen okamžité akce
- Don't: undo/history — forward-only (Shopify Admin má audit log)
- No: úprava Shopify collections/tags v bulk akci
- No: úprava cizích stores
- No: CSV sloupce s cost/margin daty (info-disclosure)

## DoD overrides

`none` — inherits project defaults.

## Related decisions / open questions

- `[[D-TBD]]` env-var flag over PostHog (Titan nemá PostHog); log při přesunu do `building/`
- `[[D-TBD]]` reuse `api/system.js` router over new Vercel route (12-route Hobby cap)
- `[[Q-TBD]]` Shopify Partner Review nový scope `write_publications`? (verifikuj před reautorizací)

## Changelog (append-only)

- `2026-07-23` Spec created + self-reviewed against CLAUDE.md.
- `2026-07-23` Post-explore fixes: flat snake_case actions; `PUBLISHER` agent (already in registry); auth = password gate → store isolation via `getStore(store_id)` from body; `SelectionToolbar.jsx` extracted (Products.jsx has zero selection UI); CSV `visibility` = human-readable `draft|listed|unlisted|archived`.

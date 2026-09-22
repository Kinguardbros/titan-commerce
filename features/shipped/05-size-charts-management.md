---
id: feature-05
slug: size-charts-management
status: shipped
appetite: medium              # ~4 dev-days equivalent
owner: dan
created: 2026-09-22
shipped: 2026-09-22
flag:
  name: feature.size_charts_management.enabled
  tool: env-var                # Titan has no PostHog → process.env.FEATURE_SIZE_CHARTS_MANAGEMENT
  default: off
  cleanup_by: 2026-11-22
depends_on: []
blocks: []
informs: []
files_owned:
  - lib/size-chart-shopify.js
  - lib/size-chart-validate.js
  - lib/actions/size-chart.js
  - sql/add-products-size-chart-ref.sql
  - apps/dashboard/src/pages/SizeCharts.jsx (+.css)
  - apps/dashboard/src/components/SizeChartTableEditor.jsx (+.css)
  - apps/dashboard/src/components/SizeChartAssignment.jsx (+.css)
  - apps/dashboard/src/components/AssignSizeChartModal.jsx (+.css)
  - apps/dashboard/src/components/AssignProductsToChartModal.jsx (+.css)
  - tests/size-chart-validate.test.js
  - tests/size-chart-shopify.test.js
  - tests/size-chart-actions.test.js
files_shared:
  - api/system.js                                # register size_charts_list/detail/validate/create/update/duplicate/assign/unassign/refresh_has_size_chart, drop read/save/refresh_size_charts
  - api/products/list.js                          # + size_chart_name column
  - apps/dashboard/src/lib/api.js                 # new size-chart functions, drop the old three, err.body attached on non-ok fetchJSON
  - apps/dashboard/src/App.jsx                    # new "Size Charts" tab
  - apps/dashboard/src/pages/Products.jsx          # bulk "Assign size chart…", chart-name tooltip on the Size indicator
  - apps/dashboard/src/components/ProductDetail.jsx        # SizeChartEditor → SizeChartAssignment
  - apps/dashboard/src/components/MetafieldEditor.jsx      # also filter custom.size_chart out of the raw editor
files_retired:
  - apps/dashboard/src/components/SizeChartEditor.jsx (+.css)  # operated on the disconnected custom.size_chart_text metafield
---

# Size Charts Management

> A per-store Size Charts page that is the control surface over the `size_chart` Shopify metaobject the Clara Atelier storefront theme actually reads — create, edit, duplicate charts and assign/unassign them to products, in place of the old mechanism that wrote a metafield the theme never rendered.

## Job story

When a size chart on the storefront is wrong, missing, or needs assigning to a newly imported product,
I want to manage the shared `size_chart` metaobject (table, columns, rows, note, unit) and its product assignments directly from Titan,
so I don't have to hand-edit Shopify Admin's raw metaobject/metafield forms or run one-off scripts per chart.

## Problem (Shape Up)

**Pain:** Titan's existing size-chart UI (`SizeChartEditor.jsx` + `read_size_chart`/`save_size_chart`/`refresh_size_charts`) read and wrote `custom.size_chart_text`, a plain-text metafield. Clara Atelier's storefront theme (`snippets/clara-size-chart.liquid`) reads a completely different mechanism: a shared `size_chart` metaobject referenced by `custom.size_chart` (`metaobject_reference`). The dashboard's "size chart" feature had been silently editing data nothing on the storefront ever displayed — `has_size_chart` and the "Save to Shopify" success toast were both lying. The last real write via the old mechanism was 2026-09-15; every edit since landed on a metafield nobody reads.

**Cost of not shipping:** Every product's real size chart still has to be managed by hand-editing a Shopify Admin metaobject form or by re-running `scripts/import-size-charts.mjs` for a whole product group at a time — no way to edit a single chart's numbers, see which products use it, or assign an existing chart to a newly imported product from inside Titan.

## Appetite

`medium (~4 dev-days equivalent)`. Kill at 1.5× without green ACs.

## Solution sketch (rough — NOT a design spec)

- `lib/size-chart-shopify.js` — GraphQL helpers over the real mechanism: list/get/upsert/update `size_chart` metaobjects, a paginated store-wide scan of every product's `custom.size_chart` reference + real size option values + legacy `custom.size_chart_text` presence, and `metafieldsSet`/`metafieldsDelete` in batches of 25 (Shopify's cap, same as `scripts/import-size-charts.mjs` and `clara-atelier/tools/attach-size-chart.py`).
- `lib/size-chart-validate.js` — pure validation per the data contract: row/column length match (blocks save), cell type + bare-value checks, unit-in-header-vs-`unit:cm` check, and size-label-vs-real-product-options mismatch (warns, never blocks).
- `lib/actions/size-chart.js` rewritten around the metaobject mechanism: `size_charts_list`, `size_chart_detail`, `validate_size_chart`, `create_size_chart`, `update_size_chart` (via `metaobjectUpdate`), `duplicate_size_chart`, `assign_size_chart_products`, `unassign_size_chart_products`, `refresh_has_size_chart` (also reports how many products still carry the unused legacy metafield). `parse_size_chart_image` (Claude Vision) is kept — still useful for prefilling a chart draft from a screenshot.
- `products.size_chart_id`/`size_chart_name` — a best-effort display cache on `products` (Shopify stays the source of truth), kept in sync by the actions above; `has_size_chart` is repointed to mean "references a `size_chart` metaobject".
- Dashboard: new **Size Charts** tab (list + editable grid + live CM/INCH preview + Save/Create/Duplicate + assigned-products list with add/remove), a **Products** tab bulk "Assign size chart…" action for a filtered selection, and a lightweight per-product **Size Chart** widget in Product Detail replacing the old editor.
- Fixed the stale-Clara-token problem the size-chart save surfaced (`lib/shopify-token.js`/`lib/shopify-failure.js`, shipped separately the same day): reactive `client_credentials` refresh + retry-once-on-401 wired into `createShopifyClient`, so this feature (and every other Shopify write) survives the 24h token expiry without a human re-pasting one.

## Acceptance criteria (Gherkin)

```gherkin
Scenario: List every size chart for a store with live product counts
  Given jsem na tabu "Size Charts" se zvolenou store Clara Atelier
  Then vidím řádek pro každý size_chart metaobjekt obchodu
  And každý řádek zobrazuje name, handle, columns, počet řádků, unit a počet produktů, které na něj odkazují

Scenario: Edit an existing chart and see the storefront's CM/INCH behavior in the preview
  Given otevřu detail existující tabulky
  When upravím buňku v měřicím sloupci a přepnu preview na INCH
  Then hodnota se vydělí 2,54 a zaokrouhlí na jedno desetinné místo, popisek velikosti (první sloupec) se nezmění
  And po kliknutí Save se zapíše přes metaobjectUpdate

Scenario: Validation blocks a malformed table, warns on a label mismatch
  Given řádek tabulky má jiný počet buněk než columns
  When kliknu Save
  Then uložení je odmítnuto s chybou a nic se nezapíše do Shopify
  Given tabulka je platná, ale první buňka řádku neodpovídá žádné reálné hodnotě size option přiřazeného produktu
  When kliknu Save
  Then uložení proběhne a zobrazí se warning, ne blokující chyba

Scenario: Bulk-assign a chart to a filtered product selection
  Given jsem v Products tabu s vyfiltrovanou a vybranou skupinou produktů
  When kliknu "Assign size chart…" a vyberu tabulku
  Then metafieldsSet zapíše referenci po dávkách max 25 produktů
  And Products list ukáže název přiřazené tabulky u každého produktu

Scenario: The old mechanism is retired, its data left alone
  Given produkt měl dřív nastavený custom.size_chart_text
  When otevřu Size Charts / Product Detail
  Then tato stará hodnota se nikde nezobrazuje jako pravda ani needituje
  And zůstává nedotčená v Shopify; refresh_has_size_chart nahlásí počet produktů, které ji ještě nesou
```

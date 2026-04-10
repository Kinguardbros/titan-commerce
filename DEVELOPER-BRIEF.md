# Developer Brief: Sprint 10 — Size Chart Tool + Full Product Editor

## Project: Titan Commerce Limited
**Design:** `skills/nextbyte-design/SKILL.md`

---

## SCOPE

Dva velke cile:
1. **Size Chart Tool** — vložit text nebo fotku → zapíše do Shopify metafield `custom.size_chart_text`
2. **Full Product Editor** — kompletní Shopify product management v Titan Commerce (title, description, cena, varianty, tagy, SEO, metafields, images)

Rozdeleno na 3 faze v tomto sprintu.

---

## Faze 1: Size Chart Tool

### Metafield spec
```
Namespace: custom
Key: size_chart_text
Type: Multi-line text
Format: CSV-style — carkou oddelene hodnoty, radky oddelene novym radkem

Priklad obsahu:
Size, US, Bust (in), Waist (in), Hips (in), Bust (cm), Waist (cm), Hips (cm)
S, 4–6, 34–35, 27–28, 37–38, 86–89, 69–71, 94–97
M, 8–10, 36–37, 29–30, 39–40, 91–94, 74–76, 99–102
L, 12–14, 38–40, 31–33, 41–43, 97–102, 79–84, 104–109
```

### Kde v UI
V **ProductWorkspace** — nova sekce "Size Chart" pod kreativy:

```
ProductWorkspace
├─ [+ Image] [▶ Video] [✨ Optimize] [Open in Studio →]
├─ Creatives (images / videos)
└─ SIZE CHART ──────────────────────────────────────────
   │
   │ ┌─ Current Size Chart ──────────────────────────┐
   │ │ Size │ US   │ Bust │ Waist │ Hips │ ...       │
   │ │ S    │ 4-6  │ 34-35│ 27-28 │ 37-38│           │
   │ │ M    │ 8-10 │ 36-37│ 29-30 │ 39-40│           │
   │ │ L    │ 12-14│ 38-40│ 31-33 │ 41-43│           │
   │ └──────────────────────────────────────────────┘
   │
   │ [Edit Size Chart]  [Import from Image 📷]
   │
```

### Dva zpusoby vstupu

**A) Textovy/tabulkovy editor:**
Klik [Edit Size Chart] → modal:

```
┌─ EDIT SIZE CHART ─────────────────────────────────────┐
│                                                        │
│ Headers (carkou oddelene):                             │
│ [Size, US, Bust (in), Waist (in), Hips (in)]    [+ Col]│
│                                                        │
│ ┌──────┬──────┬──────┬──────┬──────┐                  │
│ │ Size │ US   │ Bust │ Waist│ Hips │                  │
│ ├──────┼──────┼──────┼──────┼──────┤                  │
│ │ [S ] │ [4-6]│[34-35]│[27-28]│[37-38]│ [🗑]          │
│ │ [M ] │[8-10]│[36-37]│[29-30]│[39-40]│ [🗑]          │
│ │ [L ] │[12-14]│[38-40]│[31-33]│[41-43]│ [🗑]          │
│ └──────┴──────┴──────┴──────┴──────┘                  │
│ [+ Add Row]                                            │
│                                                        │
│ Preview:                                               │
│ Size, US, Bust (in), Waist (in), Hips (in)            │
│ S, 4–6, 34–35, 27–28, 37–38                           │
│ M, 8–10, 36–37, 29–30, 39–40                          │
│ L, 12–14, 38–40, 31–33, 41–43                         │
│                                                        │
│              [Save to Shopify]  [Cancel]               │
└────────────────────────────────────────────────────────┘
```

**B) Import z fotky (AI vision):**
Klik [Import from Image 📷] → upload fotku size chartu → Claude Vision ji precte → automaticky vyplni tabulku → uzivatel zkontroluje → save.

```js
// Backend: poslat fotku na Claude Vision API
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1000,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'url', url: imageUrl } },
      { type: 'text', text: 'Extract the size chart from this image. Return ONLY CSV format: first line is headers separated by commas, each following line is one size row separated by commas. Example:\nSize, US, Bust (in), Waist (in)\nS, 4-6, 34-35, 27-28' }
    ]
  }]
});
// Parse CSV response → fill table
```

### Backend

**`api/system.js` — nova akce `save_size_chart`:**
```json
POST { "action": "save_size_chart", "store_id": "uuid", "product_id": "uuid", "size_chart_text": "Size, US, Bust...\nS, 4-6..." }
```

Flow:
1. Nacist store → overit admin_token
2. Nacist product → ziskat shopify_id
3. Zapsat metafield pres Shopify Admin API:
```js
// Nova funkce v lib/shopify-admin.js:
async updateMetafield(productShopifyId, namespace, key, value, type = 'multi_line_text_field') {
  return rest(`products/${productShopifyId}/metafields.json`, 'POST', {
    metafield: { namespace, key, value, type }
  });
}
```
4. Pipeline log: `agent: 'SIZE_CHART', message: 'Updated size chart for {title}'`
5. Toast: "Size chart saved to Shopify!"

**`api/system.js` — nova akce `read_size_chart`:**
```json
GET { "action": "read_size_chart", "store_id": "uuid", "product_id": "uuid" }
```
Nacte metafield `custom.size_chart_text` z Shopify a vrati text.

**`api/system.js` — nova akce `parse_size_chart_image`:**
```json
POST { "action": "parse_size_chart_image", "image_url": "https://..." }
```
Posle fotku na Claude Vision → vrati CSV text.

### Frontend

**`components/SizeChartEditor.jsx`** + CSS — NOVY

Vlastnosti:
- Zobrazeni aktualni size chart jako tabulka (parsovany z CSV textu)
- [Edit] → modal s tabulkovym editorem (input per bunka)
- [+ Add Row] / [🗑 Delete Row] / [+ Add Column]
- Headers jako prvni radek
- Live preview CSV textu pod tabulkou
- [Import from Image 📷] → file upload → Claude Vision → auto-fill tabulky
- [Save to Shopify] → POST save_size_chart → toast
- Loading state behem save a image parse

### Soubory
| Soubor | Akce |
|--------|------|
| `components/SizeChartEditor.jsx` + CSS | **NOVY** |
| `pages/ProductWorkspace.jsx` | Edit — pridat Size Chart sekci |
| `api/system.js` | Edit — pridat save_size_chart, read_size_chart, parse_size_chart_image |
| `lib/shopify-admin.js` | Edit — pridat updateMetafield(), getMetafield() |
| `lib/api.js` | Edit — pridat saveSizeChart(), readSizeChart(), parseSizeChartImage() |

---

## Faze 2: Product Detail View (Read all Shopify fields)

### Ucel
Zobrazit VSECHNA data o produktu v ProductWorkspace — ne jen title/price/images co mame ted. Clovek vidi kompletni stav produktu bez nutnosti otvirat Shopify admin.

### Co nacist z Shopify Admin API
```js
// Nova funkce v lib/shopify-admin.js:
async getFullProduct(shopifyProductId) {
  const data = await rest(`products/${shopifyProductId}.json?fields=id,title,body_html,vendor,product_type,tags,status,variants,options,images,metafields`);
  return data?.product;
}
```

### Data ktera zobrazit v ProductWorkspace

```
PRODUCT DETAIL ─────────────────────────────────────────

┌─ BASIC INFO ──────────────────────────────────────────┐
│ Title:        Bella | High-Waist Comfort Pants         │
│ Status:       ACTIVE  ●                                │
│ Vendor:       Elegance House                           │
│ Type:         Pants                                    │
│ Tags:         pants, high-waist, comfort-fit           │
│ Handle:       bella-high-waist-comfort-pants            │
│ Shopify ID:   8234567890                               │
└────────────────────────────────────────────────────────┘

┌─ DESCRIPTION ─────────────────────────────────────────┐
│ <rendered HTML description>                            │
└────────────────────────────────────────────────────────┘

┌─ VARIANTS ────────────────────────────────────────────┐
│ Option 1: Size    Option 2: Color                      │
│                                                        │
│ Variant          │ Price │ SKU     │ Inventory │ Status│
│ S / Black        │ €129  │ BEL-SB  │ 24       │ ●     │
│ M / Black        │ €129  │ BEL-MB  │ 18       │ ●     │
│ L / Black        │ €129  │ BEL-LB  │ 7        │ ⚠     │
│ S / Navy         │ €129  │ BEL-SN  │ 31       │ ●     │
│ M / Navy         │ €129  │ BEL-MN  │ 22       │ ●     │
└────────────────────────────────────────────────────────┘

┌─ IMAGES ──────────────────────────────────────────────┐
│ [img1] [img2] [img3] [img4] [img5]                    │
│ 5 images                                               │
└────────────────────────────────────────────────────────┘

┌─ SEO ─────────────────────────────────────────────────┐
│ Meta Title:       Bella High-Waist Comfort Pants | EH  │
│ Meta Description: Discover our figure-flattering...     │
│ URL Handle:       /products/bella-high-waist-comfort    │
└────────────────────────────────────────────────────────┘

┌─ METAFIELDS ──────────────────────────────────────────┐
│ custom.size_chart_text: Size, US, Bust...              │
│ (+ dalsi metafields pokud existuji)                    │
└────────────────────────────────────────────────────────┘
```

### Backend

**`api/system.js` — nova akce `product_detail`:**
```json
GET { "action": "product_detail", "store_id": "uuid", "product_id": "uuid" }
```
1. Nacist product z Supabase (ziskat shopify_id)
2. Zavolat `getFullProduct(shopifyId)` na Shopify Admin API
3. Nacist metafields: `GET /admin/api/2024-01/products/{id}/metafields.json`
4. Vratit vse v jednom response

### Frontend

**Rozsirit `ProductWorkspace.jsx`** o sekce:
- Basic Info (read-only — zatim)
- Description (rendered HTML)
- Variants tabulka
- Images gallery
- SEO info
- Metafields list

### Soubory
| Soubor | Akce |
|--------|------|
| `lib/shopify-admin.js` | Edit — pridat getFullProduct(), getProductMetafields() |
| `api/system.js` | Edit — pridat product_detail akce |
| `lib/api.js` | Edit — pridat getProductDetail() |
| `pages/ProductWorkspace.jsx` + CSS | Edit — pridat detail sekce |

---

## Faze 3: Product Editor (Write all fields)

### Ucel
Editovat vsechna pole produktu primo z Titan Commerce → zapsat do Shopify. Kompletni nahrada Shopify admin pro product management.

### Co jde editovat

| Pole | Edit UI | Shopify API |
|------|---------|-------------|
| Title | Input text | `product.title` |
| Description | Rich text editor (nebo textarea s HTML) | `product.body_html` |
| Price | Input number per variant | `variant.price` |
| Compare at price | Input number per variant | `variant.compare_at_price` |
| Vendor | Input text | `product.vendor` |
| Product type | Input text / select | `product.product_type` |
| Tags | Tag input (chips) | `product.tags` (comma separated) |
| Status | Select: Active / Draft / Archived | `product.status` |
| SKU | Input per variant | `variant.sku` |
| SEO Title | Input (max 60 chars) | `product.metafields_global_title_tag` |
| SEO Description | Textarea (max 155 chars) | `product.metafields_global_description_tag` |
| Images | Reorder / delete / add (URL) | `product.images` |
| Metafields | Key-value editor | `/products/{id}/metafields` |

### UI v ProductWorkspace

Kazda sekce ma [Edit] tlacitko. Klik → inline edit mode (inputy misto textu). [Save] → zapise do Shopify. [Cancel] → vrati readonly.

```
┌─ BASIC INFO ────────────────────── [Edit] ────────────┐
│ Title: [Bella | High-Waist Comfort Pants      ]  ← input│
│ Vendor: [Elegance House                       ]       │
│ Type: [Pants                                  ]       │
│ Tags: [pants ×] [high-waist ×] [comfort ×] [+ Add]   │
│ Status: [Active ▾]                                     │
│                                                        │
│                    [Save Changes] [Cancel]              │
└────────────────────────────────────────────────────────┘
```

### Backend

Reuse existujici `updateProduct()` v `lib/shopify-admin.js` — uz umi title, description, vendor, product_type, tags, SEO.

Pridat:
```js
// Variant update (cena, SKU, compare_at_price):
async updateVariant(variantId, updates) // uz existuje

// Product status:
async updateProductStatus(productId, status) {
  return rest(`products/${productId}.json`, 'PUT', { product: { status } });
}

// Image reorder/delete:
async updateProductImages(productId, images) {
  return rest(`products/${productId}.json`, 'PUT', { product: { images } });
}

// Metafield create/update (uz bude z Faze 1):
async updateMetafield(productId, namespace, key, value, type)
```

**`api/system.js` — nova akce `update_product_full`:**
```json
POST {
  "action": "update_product_full",
  "store_id": "uuid",
  "product_id": "uuid",
  "updates": {
    "title": "...",
    "body_html": "...",
    "vendor": "...",
    "product_type": "...",
    "tags": "...",
    "status": "active",
    "seo_title": "...",
    "seo_description": "...",
    "variants": [{ "id": 123, "price": "129.00", "sku": "BEL-SB" }],
    "metafields": [{ "namespace": "custom", "key": "size_chart_text", "value": "..." }]
  }
}
```

### DULEZITE: Approval workflow
Product edit je PRIMO — ne pres approval queue. Uzivatel edituje a klika Save → zapise do Shopify hned. Toto je vedomejsi rozhodnuti nez Optimizer (kde AI navrhuje).

Ale: logovat VSECHNY zmeny do pipeline_log s before/after hodnotami pro audit trail.

### Soubory
| Soubor | Akce |
|--------|------|
| `api/system.js` | Edit — pridat update_product_full akce |
| `lib/shopify-admin.js` | Edit — pridat updateProductStatus(), updateProductImages() |
| `lib/api.js` | Edit — pridat updateProductFull() |
| `pages/ProductWorkspace.jsx` + CSS | Edit — pridat inline edit mode pro vsechny sekce |
| `components/TagInput.jsx` + CSS | **NOVY** — tag chips input (pridat/odebrat tagy) |
| `components/VariantEditor.jsx` + CSS | **NOVY** — editovatelna variants tabulka |
| `components/ImageManager.jsx` + CSS | **NOVY** — image gallery s reorder/delete/add |
| `components/MetafieldEditor.jsx` + CSS | **NOVY** — key-value metafield editor |

---

## Poradi prace — DELEJ V TOMTO PORADI

### Krok 1: Size Chart backend (Faze 1)
Pridat `updateMetafield()`, `getMetafield()` do shopify-admin.js. Pridat `save_size_chart`, `read_size_chart`, `parse_size_chart_image` akce do system.js. Otestovat: zapise size chart do Shopify metafield.

### Krok 2: Size Chart frontend (Faze 1)
SizeChartEditor komponenta + integrace do ProductWorkspace. Otestovat: edit tabulku → save → overit v Shopify admin.

### Krok 3: Image parse (Faze 1)
Claude Vision integrace pro parse fotky size chartu. Otestovat: upload fotku → AI vyplni tabulku.

### Krok 4: Product Detail read (Faze 2)
`getFullProduct()` + `getProductMetafields()` v backend. ProductWorkspace zobrazuje vsechny sekce read-only. Otestovat: otevre produkt → vidi varianty, images, SEO, metafields.

### Krok 5: Product Editor write (Faze 3)
Inline edit mode v ProductWorkspace. TagInput, VariantEditor, ImageManager, MetafieldEditor komponenty. Otestovat: edit title → Save → overit v Shopify.

### Krok 6: E2E test
1. Otevre produkt → vidi kompletni detail (varianty, images, SEO, metafields, size chart)
2. Edit Size Chart → tabulkovy editor → Save → overit na store frontendu
3. Import Size Chart z fotky → AI parsuje → vyplni tabulku → Save
4. Edit title → Save → overit v Shopify admin
5. Edit cenu varianty → Save → overit
6. Pridat/odebrat tag → Save → overit
7. Zmenit status Draft/Active → Save → overit
8. Edit SEO title/description → Save → overit
9. Pipeline log ukazuje vsechny zmeny s before/after

---

## Verifikace

### Size Chart
- Read: otevre produkt → sekce Size Chart zobrazuje aktualni tabulku z metafield
- Write: edit → Save → metafield `custom.size_chart_text` updatovany v Shopify
- Image parse: upload fotku → Claude Vision → tabulka se vyplni → Save
- Prazdny produkt: ukazuje "No size chart" s [Add Size Chart] CTA
- Funguje jen pro story s admin_token

### Product Detail
- Vsechny sekce zobrazuji realna Shopify data
- Varianty: tabulka s Size, Color, Price, SKU, Inventory
- Images: gallery s thumbnaily
- SEO: meta title + description
- Metafields: vsechny custom metafields

### Product Editor
- Kazda sekce ma [Edit] / [Save] / [Cancel]
- Save zapise do Shopify OKAMZITE (ne pres approval)
- Pipeline log: kazda zmena logovana s before/after
- Toast: "Product updated!" / "Failed: {details}"
- Varianty: edit ceny, SKU pro kazdy variant zvlast
- Tags: chip input s [×] pro delete a [+ Add]
- Status: dropdown Active/Draft/Archived
- Store izolace: edit jen pro aktivni store

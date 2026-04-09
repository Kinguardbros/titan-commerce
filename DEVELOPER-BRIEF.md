# Developer Brief: Sprint 9 — Quick Fixes + Product Import

## Project: Titan Commerce Limited
**Design:** `skills/nextbyte-design/SKILL.md`

---

## Task 1: Quick Fixes (30 min celkem)

### 1a. Cron schedule fix
V `vercel.json` zmenit:
```json
// PRED:
{ "path": "/api/cron/detect-events", "schedule": "0 8 * * *" }

// PO:
{ "path": "/api/cron/detect-events", "schedule": "0 */6 * * *" }
```
Event detection kazdych 6 hodin misto jednou denne.

### 1b. Isola shopify_url fix
Spustit v Supabase:
```sql
UPDATE stores SET shopify_url = 'swimwear-brand.myshopify.com' WHERE slug = 'isola';
```
Custom domena nefunguje pro Shopify Admin API.

### 1c. CLAUDE.md aktualizace
Soucasny CLAUDE.md je outdated (z Sprintu 3). Aktualizovat aby odpovidal realite:
- 5 tabu: Overview | Shopify | Studio | Products | Profit
- 3 story: Elegance House, Isola, Eleganz Haus
- Agent system: events, proposals, cron
- Studio: branded + product creatives
- Shopify: dashboard + pricing (inline)
- Auth: password gate + withAuth middleware
- Toast system
- Design: Nextbyte Dark Luxe
- DB: 14 tabulek vcetne events, proposals, stores

---

## Task 2: Product Import via URL Scraper — HLAVNI FEATURE

### Ucel
Importovat winner produkty z jinych obchodu jednim klikem. Paste URL → scrape → preview → edit → import do Shopify → auto-optimize listing → auto-generate kreativy.

### Existujici backend (REUSE — uz existuje, nepis od nuly)
- `lib/scraper-utils.js` — `scrapeProduct(url)`, `scrapeCollectionUrls(url)`, `generateHooks()`, `generateHeadlines()`
- `lib/shopify-admin.js` — `updateProduct()` pro zapis do Shopify
- `lib/claude.js` — `optimizeProduct()` pro AI optimalizaci listingu
- `api/creatives/generate.js` — generovani kreativ

### Flow

```
Products tab → [Import] button (vedle Sync Shopify)
  → Import modal otevre se
    → Step 1: PASTE URL
    │  ┌─────────────────────────────────────────┐
    │  │ Product or collection URL:               │
    │  │ [https://competitor.com/products/...]     │
    │  │                              [Scrape →]  │
    │  └─────────────────────────────────────────┘
    │
    → Step 2: PREVIEW (po scrape)
    │  ┌─────────────────────────────────────────┐
    │  │ [IMG] [IMG] [IMG]                        │
    │  │                                          │
    │  │ Title: Summer Floral Maxi Dress    [Edit]│
    │  │ Price: $49.95                      [Edit]│
    │  │ Description: Light and breezy...   [Edit]│
    │  │ Images: 5 found                          │
    │  │ Features: Polyester, Machine wash...     │
    │  │                                          │
    │  │ ☑ Auto-optimize listing (Claude AI)      │
    │  │ ☑ Auto-generate 4 creatives              │
    │  │                                          │
    │  │        [Import to Shopify →]             │
    │  └─────────────────────────────────────────┘
    │
    → Step 3: IMPORTING
    │  ┌─────────────────────────────────────────┐
    │  │ ✅ Product scraped                       │
    │  │ ✅ Created in Shopify                    │
    │  │ ⏳ Optimizing listing with Claude AI...  │
    │  │ ⏳ Generating 4 creatives...             │
    │  └─────────────────────────────────────────┘
    │
    → Step 4: DONE
       ┌─────────────────────────────────────────┐
       │ ✅ Import complete!                      │
       │                                          │
       │ "Bella | Floral Maxi Summer Dress"       │
       │ Created in Shopify + 4 creatives pending │
       │                                          │
       │ [View Product] [Import Another]          │
       └─────────────────────────────────────────┘
```

### Backend

**`api/products/import.js`** — POST endpoint (NOVY)

Input: `{ "url": "https://competitor.com/products/summer-dress" }`

Flow:
1. Detekovat typ URL: `/products/` → single, `/collections/` → collection
2. Single: zavolat `scrapeProduct(url)` → vratit preview
3. Collection: zavolat `scrapeCollectionUrls(url)` → pro kazdy `scrapeProduct()` → vratit list

Response (single):
```json
{
  "mode": "single",
  "product": {
    "title": "Summer Floral Maxi Dress",
    "price": "$49.95",
    "description": "Light and breezy...",
    "images": ["https://cdn.shopify.com/...", "..."],
    "features": ["Polyester", "Machine wash"],
    "url": "https://competitor.com/products/summer-dress"
  }
}
```

Response (collection):
```json
{
  "mode": "collection",
  "products": [ { ... }, { ... }, { ... } ]
}
```

**`api/products/import-confirm.js`** — POST endpoint (NOVY)

Input:
```json
{
  "store_id": "uuid",
  "product_data": {
    "title": "Bella | Floral Maxi Summer Dress",
    "description": "<p>Light and breezy...</p>",
    "price": "49.95",
    "images": ["https://...jpg"],
    "product_type": "Dresses",
    "vendor": "Elegance House",
    "tags": ["dresses", "summer"]
  },
  "auto_optimize": true,
  "auto_generate": true,
  "generate_count": 4
}
```

Flow:
1. Nacist store z DB → overit admin_token
2. Vytvorit produkt v Shopify pres `createProduct()`
3. Ulozit do Supabase `products` tabulky (se store_id)
4. Pokud `auto_optimize` → zavolat `optimizeProduct()` → ulozit jako pending optimization
5. Pokud `auto_generate` → spustit generovani kreativ (top 2 styly)
6. Pipeline log: `agent: 'IMPORTER'`
7. Vratit: `{ product_id, shopify_id, optimization_pending, creatives_count }`

**DULEZITE:** Shopify create NEVYZADUJE approval (import). Ale optimization a kreativy projdou approval workflow.

### Pridat do `lib/shopify-admin.js`

```js
async createProduct(productData) {
  return rest('products.json', 'POST', {
    product: {
      title: productData.title,
      body_html: productData.description,
      vendor: productData.vendor,
      product_type: productData.product_type,
      tags: Array.isArray(productData.tags) ? productData.tags.join(', ') : productData.tags,
      variants: [{ price: productData.price }],
      images: (productData.images || []).map(src => ({ src })),
    }
  });
}
```

### Frontend

**`components/ImportModal.jsx`** + CSS — NOVY

4-step wizard modal. Viz ASCII mockup vyse.

Klicove UI detaily:
- Step 1: URL input + Scrape button. Detekce: collection vs product
- Step 2: Editable preview — title, price, description jako inputy. Image gallery. Checkboxy pro auto-optimize/generate.
- Step 3: Progress checklist se spinnerem u kazdeho kroku
- Step 4: Success s linky [View Product] [Import Another]
- Collection mode: grid s checkboxy, "Select All", batch import
- Toast feedback na kazdem kroku
- Loading state behem scrape (~3-5s)

### Pridat do `lib/api.js`

```js
export function scrapeProductUrl(url) {
  return fetchJSON('/api/products/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function confirmImport(data) {
  return fetchJSON('/api/products/import-confirm', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

### Pridat do `pages/Products.jsx`

Import button vedle Sync Shopify:
```jsx
<button className="products-import-btn" onClick={() => setShowImport(true)}>
  ↓ Import
</button>
```

### Nove soubory
| Soubor | Akce |
|--------|------|
| `api/products/import.js` | **NOVY** — scrape endpoint |
| `api/products/import-confirm.js` | **NOVY** — create + optimize + generate |
| `components/ImportModal.jsx` + CSS | **NOVY** — 4-step wizard |
| `lib/shopify-admin.js` | Edit — pridat `createProduct()` |
| `lib/api.js` | Edit — pridat scrapeProductUrl, confirmImport |
| `pages/Products.jsx` | Edit — pridat Import button + modal |
| `vercel.json` | Edit — cron schedule |
| `CLAUDE.md` | Edit — aktualizovat |

---

## Poradi prace

### Krok 1: Quick fixes (Task 1)
Cron fix + Isola URL + CLAUDE.md. 30 minut.

### Krok 2: Backend (Task 2)
`api/products/import.js` + `import-confirm.js` + `createProduct()`. Otestovat: POST s URL → vraci scraped data.

### Krok 3: Frontend ImportModal (Task 2)
4-step wizard. Otestovat: paste URL → scrape → preview → import → produkt v Shopify.

### Krok 4: E2E test
1. Products tab → Import → paste URL konkurencniho produktu
2. Scrape → preview (title, images, price)
3. Edit title na brand format
4. Check auto-optimize + auto-generate
5. Import → produkt vytvoren v Shopify
6. Optimization pending v Overview
7. Kreativy pending
8. Collection URL → list → vyber → bulk import

---

## Verifikace

### Quick fixes
- `vercel.json` cron = `0 */6 * * *`
- Isola shopify_url = `swimwear-brand.myshopify.com`
- CLAUDE.md aktualni

### Product Import
- Single product URL → scrape → preview → import ✅
- Collection URL → list → vyber → bulk import ✅
- Auto-optimize → pending optimization (ne Shopify push)
- Auto-generate → pending kreativy
- Produkt v Shopify admin + Products tab
- Pipeline log: IMPORTER entry
- Toast feedback na kazdem kroku
- Store izolace: import do aktivniho store
- Funguje JEN pro story s admin_token

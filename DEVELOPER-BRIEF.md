# Developer Brief: Sprint 8 — Performance Optimization

## Project: Titan Commerce Limited
**Design:** `skills/nextbyte-design/SKILL.md`

---

## PROC TENTO SPRINT

Dashboard se nacita 3-5 sekund. Hlavni priciny:
1. N+1 DB queries v Shopify overview (60 queries na 10 produktu)
2. Serialni Shopify API cally (misto paralelních)
3. Zadna pagination (500+ produktu najednou)
4. Zadne cachovani (kazdy tab switch = novy fetch)
5. Dead dependency (recharts 200KB)
6. api/system.js = 666 radku v jednom souboru

---

## Task 1: Fix N+1 queries — NEJVETSI DOPAD

### Problem
`lib/shopify-admin.js` → `getTopProductsWithCreatives()` dela 3 DB queries PER PRODUKT v loop:
```js
// SPATNE — 30 queries pro 10 produktu:
for (const p of products) {
  const dbP = await supabase.from('products').select('id').ilike('title', ...).single();
  const { count: total } = await supabase.from('creatives').select(count).eq('product_id', dbP.id);
  const { count: approved } = await supabase.from('creatives').select(count).eq('product_id', dbP.id).eq('status', 'approved');
}
```

### Fix — 1 query misto 30
```js
// SPRAVNE — 1 bulk query:
const titles = products.map(p => p.title.split('|')[0].trim());

// Nacist vsechny matching products najednou
const { data: dbProducts } = await supabase
  .from('products')
  .select('id, title')
  .in('title', titles);  // nebo .or() s ilike

// Nacist creative counts pro vsechny products najednou
const productIds = dbProducts.map(p => p.id);
const { data: creativeCounts } = await supabase
  .rpc('get_creative_counts', { product_ids: productIds });
  // Nebo: raw SQL pres supabase.rpc()

// Alternativa bez RPC — 2 queries misto 30:
const { data: allCreatives } = await supabase
  .from('creatives')
  .select('product_id, status')
  .in('product_id', productIds);

// Agregovat client-side:
for (const p of products) {
  const match = dbProducts.find(db => db.title.includes(p.title.split('|')[0].trim()));
  if (match) {
    p.creative_count = allCreatives.filter(c => c.product_id === match.id).length;
    p.approved_count = allCreatives.filter(c => c.product_id === match.id && c.status === 'approved').length;
    p.product_id = match.id;
  }
}
```

**Vysledek:** 2-3 queries misto 30. Usetri 400-800ms.

---

## Task 2: Paralelizovat Shopify API cally

### Problem
`getRevenueDelta()` vola `getRevenueSummary()` dvakrat seriove — kazdy vola `fetchOrders()`:
```js
// SPATNE — serialni:
const current = await this.getRevenueSummary(days);     // 200-400ms
const total2x = await this.getRevenueSummary(days * 2);  // 200-400ms
```

### Fix
```js
// SPRAVNE — paralelni:
const [current, total2x] = await Promise.all([
  this.getRevenueSummary(days),
  this.getRevenueSummary(days * 2),
]);
```

Stejne pro `getTopProductsWithCreatives()` kde vola `fetchOrders(days)` a `fetchOrders(days*2)` seriove.

**Vysledek:** 200-400ms uspora.

---

## Task 3: Odstranit recharts dependency

### Problem
`recharts` je v `apps/dashboard/package.json` ale CLAUDE.md rika "zadne chart knihovny — pouzivat CSS bary". Dead dependency = +200KB v bundlu.

### Fix
```bash
cd apps/dashboard && npm uninstall recharts --legacy-peer-deps
```

A overit ze nikde neni import:
```bash
grep -r "recharts" apps/dashboard/src/
```
Pokud nekde je — nahradit CSS bary.

**Vysledek:** -200KB bundle size.

---

## Task 4: Pagination produktu

### Problem
`Products.jsx` nacita VSECHNY produkty najednou (500+). Vsechny obrazky se renderuji.

### Fix — pagination
```js
// api/products/list.js — pridat pagination:
const page = parseInt(req.query.page) || 1;
const limit = parseInt(req.query.limit) || 50;
const offset = (page - 1) * limit;

const { data, count } = await supabase
  .from('products')
  .select('*', { count: 'exact' })
  .eq('store_id', storeId)
  .order('title')
  .range(offset, offset + limit - 1);

return res.json({ products: data, total: count, page, pages: Math.ceil(count / limit) });
```

Frontend:
```jsx
// Products.jsx — pridat pagination controls:
const [page, setPage] = useState(1);
// fetch s ?page=X&limit=50
// "Load more" button nebo page numbers dole
```

### Lazy loading obrazku
```jsx
// Vsude kde je product image:
<img src={product.image_url} loading="lazy" alt={product.title} />
```

**Vysledek:** 10x rychlejsi initial load (50 misto 500 produktu).

---

## Task 5: API response caching

### Problem
Kazdy tab switch = novy fetch ze Shopify API (2-3s). Data se nemeni kazdou minutu.

### Fix — client-side cache v hookach

```js
// hooks/useShopifyOverview.js — pridat cache:
const CACHE = {};
const CACHE_TTL = 60000; // 60 sekund

export function useShopifyOverview(days, storeId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const cacheKey = `shopify-${storeId}-${days}`;

  const refresh = useCallback(async (force = false) => {
    // Check cache
    if (!force && CACHE[cacheKey] && Date.now() - CACHE[cacheKey].timestamp < CACHE_TTL) {
      setData(CACHE[cacheKey].data);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const result = await getShopifyOverview(days, storeId);
    CACHE[cacheKey] = { data: result, timestamp: Date.now() };
    setData(result);
    setLoading(false);
  }, [days, storeId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh: () => refresh(true) }; // force refresh on manual click
}
```

Stejny vzor pro `useProposals`, `useInsights`, `useProfit`.

**Vysledek:** Tab switch = instant (z cache). Manual refresh = fresh data.

---

## Task 6: Deduplikovat API cally

### Problem
`Shopify.jsx` vola `getProducts(storeId)` DVAKRAT na mount (radky 23 a 25).

### Fix
Odstranit duplikat. Overit vsechny stranky ze nevolaji stejny endpoint vicekrat.

```bash
grep -n "getProducts\|getShopifyOverview\|getProposals" apps/dashboard/src/pages/*.jsx
```

---

## Task 7: Rozdelit api/system.js

### Problem
666 radku, 13+ akci v jednom souboru. Pomalý Vercel cold start, tezke debugovani.

### Fix — rozdelit na moduly
```
api/system.js (666 lines) → rozdelit na:
├── api/system/stores.js      — stores_list
├── api/system/pipeline.js    — pipeline_log
├── api/system/kpi.js         — kpi, profit_summary
├── api/system/proposals.js   — proposals_list, approve, reject, approve_all, scan_events
├── api/system/optimizer.js   — optimize_product, approve/reject optimization
├── api/system/creatives.js   — update_creative, generate_branded, cleanup_stale
├── api/system/pricing.js     — bulk_price, update_cogs, manual_adspend
```

Kazdy soubor ~80-100 radku. Sdileny helper: `lib/system-helpers.js` pro spolecny kod.

**POZOR:** Frontend `lib/api.js` vola `/api/system?action=X` — bud zachovat tento pattern (jeden router v system.js co deleguje) nebo updatovat frontend na nove URL.

**Doporuceni:** Zachovat `/api/system` jako router ale presunout logiku do separatnich souboru:
```js
// api/system.js — tenky router:
import { handleStores } from './system/stores.js';
import { handleProposals } from './system/proposals.js';
// ...

export default withAuth(async (req, res) => {
  const action = req.query.action || req.body?.action;
  switch (action) {
    case 'stores_list': return handleStores(req, res);
    case 'proposals_list':
    case 'approve_proposal': 
    case 'reject_proposal': return handleProposals(req, res);
    // ...
  }
});
```

---

## Task 8: Vite code splitting

### Problem
Cely dashboard v jednom JS bundlu. Vsechny taby se nacitaji i kdyz uzivatel otevre jen Overview.

### Fix — lazy loading tabu
```jsx
// App.jsx:
import { lazy, Suspense } from 'react';

const Overview = lazy(() => import('./pages/Overview'));
const Shopify = lazy(() => import('./pages/Shopify'));
const Studio = lazy(() => import('./pages/Studio'));
const Products = lazy(() => import('./pages/Products'));
const Profit = lazy(() => import('./pages/Profit'));

// V rendereru:
<Suspense fallback={<div className="page-loading">Loading...</div>}>
  {activeTab === 'Overview' && <Overview ... />}
  {activeTab === 'Shopify' && <Shopify ... />}
  // ...
</Suspense>
```

A v `vite.config.js`:
```js
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        }
      }
    }
  }
});
```

**Vysledek:** Initial load nacte jen vendor + aktivni tab. Ostatni taby on-demand.

---

## Task 9: Skeleton loadery

### Problem
"Loading..." text misto vizualniho feedbacku. Layout shift kdyz data prijdou.

### Fix — skeleton komponenta
```jsx
// components/Skeleton.jsx
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-img skeleton-pulse" />
      <div className="skeleton-text skeleton-pulse" style={{ width: '80%' }} />
      <div className="skeleton-text skeleton-pulse" style={{ width: '40%' }} />
    </div>
  );
}

export function SkeletonKPI() {
  return (
    <div className="skeleton-kpi">
      <div className="skeleton-text skeleton-pulse" style={{ width: '60%', height: 12 }} />
      <div className="skeleton-text skeleton-pulse" style={{ width: '40%', height: 28 }} />
    </div>
  );
}
```

```css
.skeleton-pulse {
  background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 6px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
```

Pouzit ve VSECH loading states misto "Loading..." textu.

---

## Poradi prace — DELEJ V TOMTO PORADI (od nejvyssiho dopadu)

### Krok 1: Fix N+1 queries (Task 1) ← NEJVETSI DOPAD
Prepsat getTopProductsWithCreatives na bulk query. Test: `/api/shopify/overview` odpovida pod 1s misto 3s.

### Krok 2: Paralelizovat API cally (Task 2)
Promise.all() v getRevenueDelta a getTopProductsWithCreatives. Test: Shopify tab load pod 2s.

### Krok 3: Odstranit recharts (Task 3)
npm uninstall. Test: bundle size zmenseny o ~200KB.

### Krok 4: Client-side cache (Task 5)
Cache v hookach (60s TTL). Test: tab switch = instant, manual refresh = fresh data.

### Krok 5: Pagination + lazy loading (Task 4)
Products page: 50 per page + `loading="lazy"` na obrazky. Test: Products tab load pod 1s.

### Krok 6: Deduplikace (Task 6)
Odstranit duplicitni API cally. Grep + fix.

### Krok 7: Code splitting (Task 8)
Lazy import tabu + Vite chunks. Test: initial bundle < 300KB.

### Krok 8: Skeleton loadery (Task 9)
Nahradit "Loading..." skeleton komponentami.

### Krok 9: Split system.js (Task 7)
Router pattern + separatni moduly. Test: zadna zmena v chovani, mensi soubory.

---

## Verifikace

### Performance metriky (pred vs po)
- Shopify tab load: 3-5s → pod 1.5s
- Products tab load: 2-3s → pod 0.5s
- Tab switch: 2-3s → instant (cache)
- Initial bundle: ~600KB → pod 350KB
- Products render: 500 najednou → 50 s pagination

### Jak merit
- Network tab: sledovat response time vsech API callu
- Lighthouse: Performance score pred a po
- Bundle size: `npm run build` → velikost dist/assets/*.js

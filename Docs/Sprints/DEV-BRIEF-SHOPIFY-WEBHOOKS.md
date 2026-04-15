# DEV BRIEF — Shopify Webhooks (Automatic Product Sync)

> **Projekt:** Titan Commerce
> **Datum:** 2026-04-14
> **Prerekvizita:** Přečti si `CLAUDE.md` + `/Users/dan/.claude/plans/graceful-marinating-aho.md` (plán)
> **Cíl store:** Isola (`swimwear-brand.myshopify.com`) — po ověření rollout na další

---

## Kontext

Dan mění produkty v Shopify denně. Manuální "Sync Shopify" tlačítko zdržuje. Webhooky = produkty se aktualizují v Titan Commerce automaticky když se změní v Shopify.

**3 topics:** `products/create`, `products/update`, `products/delete`

---

## Klíčový insight (ušetří migrace!)

**Žádný nový `webhook_secret` sloupec není potřeba.** Při programové registraci přes Admin API podepisuje Shopify webhook payloady **app `client_secret`**, který už máme v `stores.client_secret` (uložené z OAuth flow).

---

## KRITICKÁ PRAVIDLA

- **`lib/higgsfield.js` NEDOTÝKAT SE** (sacred file, Dan má strict rule)
- Max 300 řádků per soubor
- `catch (e) {}` zakázáno — vždy structured log
- Prefix logů: `[webhook]`, `[webhook-handler]`, `[webhook-action]`
- Shopify webhook HMAC je **base64** (NE hex jako OAuth callback v `api/auth/shopify.js:16-27`)

---

## Route budget (KRITICKÉ)

Aktuálně **12/12 Vercel routes využito**. Pro webhook endpoint musíš **konsolidovat `api/products/sync.js` do `api/system.js`** jako action `sync_products` (dostupný přes `?action=sync_products`). Tím uvolníš 1 slot pro `api/webhooks/shopify.js`.

Sync je jedna funkce (~150 řádků) co přijímá `store_id` v body — sedí přesně do system.js action patternu. Frontend v `apps/dashboard/src/lib/api.js` má `syncProducts(storeId)` → změnit URL z `/api/products/sync` na `/api/system?action=sync_products`.

---

## Pořadí implementace

### 1. Extract `lib/product-upsert.js` (~60 ř.)

Vytáhnout upsert logiku z `api/products/sync.js` ř. 81-114. Funkce:

```js
export async function upsertProductFromShopify(storeId, storeUrl, p) {
  const images = (p.images || []).map((img) => img.src);
  const upsertData = {
    shopify_id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.variants?.[0]?.price || null,
    description: (p.body_html || '').replace(/<[^>]*>/g, '').slice(0, 2000),
    image_url: images[0] || null,
    images: JSON.stringify(images),
    product_url: `https://${storeUrl}/products/${p.handle}`,
    product_type: p.product_type || null,
    vendor: p.vendor || null,
    status: 'active',
    synced_at: new Date().toISOString(),
    store_id: storeId,
    // NOTE: tags (collections) NOT set — preserves existing value on webhook updates
  };
  const { error } = await supabase.from('products').upsert(upsertData, { onConflict: 'shopify_id' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
  return { shopify_id: p.id, handle: p.handle };
}
```

**DŮLEŽITÉ:** Webhook payload NEOBSAHUJE collection memberships (tagy). NEPŘEPISUJ `tags` field na webhook update — jinak se tagy smažou. Plný sync (`sync_products` action) je obnoví.

### 2. Refactor `api/products/sync.js` → `lib/actions/sync.js` + system.js action

Přesunout sync logiku do `lib/actions/sync.js` export `sync_products`. Ve smyčce volat `upsertProductFromShopify(storeId, storeUrl, p)`. Zaregistrovat v `api/system.js` jako POST action.

Frontend `apps/dashboard/src/lib/api.js`:
```js
// PŘED:
export function syncProducts(storeId) {
  return fetchJSON('/api/products/sync', { method: 'POST', body: JSON.stringify({ store_id: storeId }) });
}
// PO:
export function syncProducts(storeId) {
  return fetchJSON('/api/system?action=sync_products', { method: 'POST', body: JSON.stringify({ store_id: storeId }) });
}
```

Smazat `api/products/sync.js`. Ověřit že Products tab Sync tlačítko stále funguje.

### 3. Přidat webhook metody do `lib/shopify-admin.js`

V `createShopifyClient` closure přidat:
```js
async function listWebhooks() {
  const data = await rest('webhooks.json');
  return data?.webhooks || [];
}
async function registerWebhook(topic, address) {
  return rest('webhooks.json', 'POST', { webhook: { topic, address, format: 'json' } });
}
async function deleteWebhook(id) {
  return rest(`webhooks/${id}.json`, 'DELETE');
}
```
Vrátit v objektu klienta na konci funkce.

### 4. Handlers `lib/shopify-webhook-handlers.js` (~40 ř.)

```js
import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from './product-upsert.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function handleProductCreate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  return { action: 'created', shopify_id: p.id };
}

export async function handleProductUpdate(store, p) {
  await upsertProductFromShopify(store.id, store.shopify_url, p);
  return { action: 'updated', shopify_id: p.id };
}

export async function handleProductDelete(store, p) {
  const { error } = await supabase.from('products')
    .update({ status: 'archived', synced_at: new Date().toISOString() })
    .eq('store_id', store.id).eq('shopify_id', String(p.id));
  if (error) throw new Error(`archive failed: ${error.message}`);
  return { action: 'archived', shopify_id: p.id };
}
```

### 5. Webhook endpoint `api/webhooks/shopify.js` (~130 ř.)

```js
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  handleProductCreate, handleProductUpdate, handleProductDelete,
} from '../../lib/shopify-webhook-handlers.js';

export const config = { api: { bodyParser: false } };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function verifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch (err) {
    console.error('[webhook] HMAC compare failed:', { error: err.message });
    return false;
  }
}

const HANDLERS = {
  'products/create': handleProductCreate,
  'products/update': handleProductUpdate,
  'products/delete': handleProductDelete,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const topic = req.headers['x-shopify-topic'];
  const shop  = req.headers['x-shopify-shop-domain'];
  const hmac  = req.headers['x-shopify-hmac-sha256'];
  const wId   = req.headers['x-shopify-webhook-id'];

  const rawBody = await readRawBody(req);

  const { data: store } = await supabase
    .from('stores')
    .select('id, shopify_url, admin_token, client_secret')
    .eq('shopify_url', shop)
    .single();

  if (!store?.client_secret) {
    console.error('[webhook] Unknown shop or missing secret:', { shop, topic });
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!verifyHmac(rawBody, hmac, store.client_secret)) {
    console.error('[webhook] HMAC invalid:', { shop, topic, webhook_id: wId });
    return res.status(401).json({ error: 'hmac_invalid' });
  }

  const fn = HANDLERS[topic];
  if (!fn) {
    console.warn('[webhook] Unsupported topic (acked):', { topic });
    return res.status(200).json({ ok: true, ignored: topic });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[webhook] Invalid JSON:', { error: err.message, shop, topic });
    return res.status(400).json({ error: 'invalid_json' });
  }

  try {
    const result = await fn(store, payload);
    await supabase.from('pipeline_log').insert({
      store_id: store.id, agent: 'SCRAPER', level: 'info',
      message: `Webhook ${topic} → ${result.action} (shopify_id=${result.shopify_id})`,
      metadata: { topic, webhook_id: wId, ...result },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] Handler error:', { topic, shop, error: err.message });
    return res.status(500).json({ error: 'handler_failed' });
  }
}
```

### 6. Admin actions `lib/actions/webhooks.js` (~80 ř.)

Tři akce pro registraci (all authenticated via withAuth):

- **`register_webhooks`** (POST, body: `{store_id}`) — idempotentně registruje 3 topics na `${process.env.APP_URL}/api/webhooks/shopify` pro daný store. Skipne už existující.
- **`list_webhooks`** (GET, query: `store_id`) — vrací `client.listWebhooks()`.
- **`unregister_webhooks`** (POST, body: `{store_id}`) — smaže všechny webhooky pro náš endpoint.

Zaregistrovat v `api/system.js` router mapě.

`APP_URL` env var → nastavit v Vercel na `https://titan-commerce.vercel.app` (nebo custom doménu).

### 7. Frontend API `apps/dashboard/src/lib/api.js`

```js
export function registerWebhooks(storeId) {
  return fetchJSON('/api/system?action=register_webhooks', {
    method: 'POST', body: JSON.stringify({ store_id: storeId }),
  });
}
export function listWebhooks(storeId) {
  return fetchJSON(`/api/system?action=list_webhooks&store_id=${storeId}`);
}
export function unregisterWebhooks(storeId) {
  return fetchJSON('/api/system?action=unregister_webhooks', {
    method: 'POST', body: JSON.stringify({ store_id: storeId }),
  });
}
```

### 8. UI — `ShopifyServices.jsx`

Přidat "Webhooks" status kartu vedle ostatních services:

```jsx
<div className="ss-card">
  <div className="ss-card-title">Webhooks</div>
  <div className="ss-card-status">
    {webhookCount}/3 registered
  </div>
  <div className="ss-card-meta">
    Last event: {lastEvent ? formatTimeAgo(lastEvent) : 'never'}
  </div>
  <button onClick={handleRegister} disabled={registering}>
    {registering ? '...' : (webhookCount === 3 ? 'Re-register' : 'Register')}
  </button>
</div>
```

`useEffect` — load `listWebhooks(storeId)` a last event z `pipeline_log` (query: `agent=SCRAPER` and message starts with `Webhook`).

Tlačítko "Unregister" dej do dropdown nebo hide za dev flag — rizikové.

### 9. Vercel ENV

Nastavit `APP_URL=https://<tvoje-doména>` v Vercel project settings (Production + Preview).

### 10. CLAUDE.md aktualizace

Přidat sekci "Webhooks" do Key Files + Important Patterns s odkazem na HMAC base64 vs hex rozdíl.

---

## Testování (po deployi)

1. **Deploy** — push na main, počkat na Vercel deploy
2. **Register** — v dashboardu (Shopify tab, aktivní Isola) klik "Register" → očekává `3/3 registered`
3. **List** — `GET /api/system?action=list_webhooks&store_id=<isola-uuid>` → vrací 3 webhooky s naším URL
4. **Shopify Admin test** — v Isola Shopify Admin: Settings → Notifications → Webhooks → "Send test notification" pro každý topic
5. **Live** — přejmenuj produkt v Isola Shopify Admin → do 5s v pipeline_log: `Webhook products/update → updated (shopify_id=X)`. Products tab ukazuje nový název bez klikání Sync.
6. **HMAC fail** — `curl -X POST <url>/api/webhooks/shopify -H 'x-shopify-hmac-sha256: bogus' -H 'x-shopify-topic: products/update' -H 'x-shopify-shop-domain: swimwear-brand.myshopify.com' -d '{}'` → 401
7. **Unit test** — `tests/webhook-hmac.test.js`:
   ```js
   const body = '{"test":1}';
   const secret = 'test-secret';
   const digest = crypto.createHmac('sha256', secret).update(body).digest('base64');
   expect(verifyHmac(Buffer.from(body), digest, secret)).toBe(true);
   expect(verifyHmac(Buffer.from(body), 'bogus', secret)).toBe(false);
   ```

---

## Definition of Done

- [ ] `api/products/sync.js` konsolidovaný do `system.js` jako `sync_products` action
- [ ] Products tab "Sync Shopify" tlačítko stále funguje
- [ ] Route count = 12 (webhook endpoint zabral uvolněný slot)
- [ ] `lib/product-upsert.js` extrahovaný, sdílený mezi sync a webhooks
- [ ] `api/webhooks/shopify.js` s raw body + base64 HMAC verify
- [ ] Klik "Register" v Shopify tab → 3/3 registered
- [ ] Live test: změna v Shopify → do 5s viditelná v Titan
- [ ] `tests/webhook-hmac.test.js` passes
- [ ] CLAUDE.md aktualizovaná
- [ ] `npm run build` + `npm test` passes

---

## Rollout pro další stores

Po Isola (1-2 dny testování):
1. Ověř že Elegance House a Eleganz Haus mají `admin_token` + `client_secret` v `stores` (OAuth dokončené)
2. V Shopify tabu přepni active store → klik "Register"
3. Hotovo. Jeden endpoint, N stores — routing přes `X-Shopify-Shop-Domain` header.

---

## Rizika & mitigace

- **Vercel 5s webhook timeout** — Shopify vyžaduje 200 do 5s. Současná logika (upsert nebo archive) je <1s. Pokud narazíme na timeout, refactor na fire-and-forget: odpověz 200 HNED, upsert v pozadí přes nějaký lightweight queue pattern.
- **Shopify Admin UI registrované webhooky** — použít PROGRAMATICKOU registraci. Admin UI webhook má vlastní unikátní secret — programatické API používá `client_secret` který už máme.
- **Webhook spam při bulk editu** — Shopify rate limit pro webhooky je 100/s. Naše rate limit není problém, Supabase upsert snese víc.
- **Archivovaný produkt se znovu aktivuje** — OK, `upsertProductFromShopify` nastaví `status: 'active'` automaticky.

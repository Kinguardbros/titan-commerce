import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from '../product-upsert.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DEFAULT_STORE_URL = process.env.SHOPIFY_STORE_URL || 'shop-elegancehouse.com';

async function fetchJSON(url) {
  const resp = await fetch(url);
  return resp.json();
}

export async function sync_products(req, res) {
  const { store_id } = req.body || {};

  // Determine store URL: use store from DB if store_id provided, else env vars
  let storeUrl = DEFAULT_STORE_URL;
  let storeId = null;
  if (store_id) {
    const { data: store } = await supabase.from('stores').select('*').eq('id', store_id).single();
    if (!store) return res.status(404).json({ error: 'Store not found' });
    storeUrl = store.shopify_url;
    storeId = store.id;
  }

  // 1. Fetch all collections and build handle→product mapping
  const collectionsData = await fetchJSON(`https://${storeUrl}/collections.json?limit=250`);
  const collections = (collectionsData.collections || []).map((c) => ({
    handle: c.handle,
    title: c.title,
  }));

  const productCollections = {}; // handle → [collection titles]
  for (const col of collections) {
    if (col.handle === 'all' || col.handle === 'frontpage') continue;
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await fetchJSON(
        `https://${storeUrl}/collections/${col.handle}/products.json?limit=250&page=${page}`
      );
      if (!data.products || data.products.length === 0) {
        hasMore = false;
      } else {
        for (const p of data.products) {
          if (!productCollections[p.handle]) productCollections[p.handle] = [];
          if (!productCollections[p.handle].includes(col.title)) {
            productCollections[p.handle].push(col.title);
          }
        }
        page++;
        if (data.products.length < 250) hasMore = false;
      }
    }
  }

  // 2. Fetch all products
  let allProducts = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const data = await fetchJSON(`https://${storeUrl}/products.json?limit=250&page=${page}`);
    if (!data.products || data.products.length === 0) {
      hasMore = false;
    } else {
      allProducts = allProducts.concat(data.products);
      page++;
      if (data.products.length < 250) hasMore = false;
    }
  }

  // 3. Upsert products — use shared helper, then set tags (collections) separately
  let synced = 0;
  for (const p of allProducts) {
    try {
      await upsertProductFromShopify(storeId, storeUrl, p);
      // Full sync also sets collection tags (webhook path preserves existing)
      const cols = productCollections[p.handle] || [];
      await supabase.from('products')
        .update({ tags: JSON.stringify(cols) })
        .eq('shopify_id', p.id);
      synced++;
    } catch (err) {
      console.error(`[sync] Failed to upsert ${p.handle}:`, err.message);
    }
  }

  // Archive products that no longer exist in Shopify
  let archived = 0;
  if (storeId) {
    const shopifyIds = allProducts.map((p) => String(p.id));
    const { data: dbProducts } = await supabase.from('products')
      .select('id, shopify_id').eq('store_id', storeId).eq('status', 'active');
    const toArchive = (dbProducts || []).filter((p) => p.shopify_id && !shopifyIds.includes(String(p.shopify_id)));
    for (const p of toArchive) {
      await supabase.from('products').update({ status: 'archived' }).eq('id', p.id);
      archived++;
    }
    if (archived > 0) {
      console.log(`[sync] Archived ${archived} products no longer in Shopify`);
    }
  }

  await supabase.from('pipeline_log').insert({
    agent: 'SCRAPER',
    message: `Shopify sync complete — ${synced} products, ${collections.length} collections${archived > 0 ? `, ${archived} archived` : ''}`,
    level: 'info',
    ...(storeId ? { store_id: storeId } : {}),
  });

  return res.status(200).json({
    synced,
    archived,
    total: allProducts.length,
    collections: collections.length,
  });
}

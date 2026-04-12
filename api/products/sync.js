import { createClient } from '@supabase/supabase-js';
import { withAuth } from '../../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEFAULT_STORE_URL = process.env.SHOPIFY_STORE_URL || 'shop-elegancehouse.com';

async function fetchJSON(url) {
  const resp = await fetch(url);
  return resp.json();
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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

    // For each collection, fetch its product handles
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

    // 3. Upsert products with collection data
    let synced = 0;
    for (const p of allProducts) {
      const images = (p.images || []).map((img) => img.src);
      const cols = productCollections[p.handle] || [];
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
          tags: JSON.stringify(cols),
          synced_at: new Date().toISOString(),
        };
      upsertData.status = 'active';
      if (storeId) {
        upsertData.store_id = storeId;
      }
      const { error } = await supabase.from('products').upsert(
        upsertData,
        { onConflict: 'shopify_id' }
      );

      if (error) {
        console.error(`[sync] Failed to upsert ${p.handle}:`, error.message);
      } else {
        synced++;
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
  } catch (err) {
    console.error('[api/products/sync] Error:', err);
    return res.status(500).json({ error: 'Sync failed', details: err.message });
  }
}

export default withAuth(handler);

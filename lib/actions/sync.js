import { createClient } from '@supabase/supabase-js';
import { upsertProductFromShopify } from '../product-upsert.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DEFAULT_STORE_URL = process.env.SHOPIFY_STORE_URL || 'shop-elegancehouse.com';

async function fetchJSON(url) {
  const resp = await fetch(url);
  return resp.json();
}

async function fetchAdminJSON(url, token) {
  const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  return resp.json();
}

export async function sync_products(req, res) {
  const { store_id } = req.body || {};

  // Determine store URL: use store from DB if store_id provided, else env vars
  let storeUrl = DEFAULT_STORE_URL;
  let storeId = null;
  let adminToken = null;
  if (store_id) {
    const { data: store } = await supabase.from('stores').select('*').eq('id', store_id).single();
    if (!store) return res.status(404).json({ error: 'Store not found' });
    storeUrl = store.shopify_url;
    storeId = store.id;
    adminToken = store.admin_token;
  }

  // 1. Fetch all collections via Admin API (reliable, includes smart collections)
  const productCollections = {}; // handle → [collection titles]
  if (adminToken) {
    const [customData, smartData] = await Promise.all([
      fetchAdminJSON(`https://${storeUrl}/admin/api/2024-01/custom_collections.json?limit=250`, adminToken),
      fetchAdminJSON(`https://${storeUrl}/admin/api/2024-01/smart_collections.json?limit=250`, adminToken),
    ]);
    const allCollections = [
      ...(customData.custom_collections || []),
      ...(smartData.smart_collections || []),
    ];

    console.log(`[sync] Found ${allCollections.length} collections (${customData.custom_collections?.length || 0} custom + ${smartData.smart_collections?.length || 0} smart)`);

    for (const col of allCollections) {
      if (col.handle === 'all' || col.handle === 'frontpage') continue;
      // Use GraphQL Admin API — most reliable for smart collection products
      let colProductCount = 0;
      let colHandles = [];
      let hasNextPage = true;
      let cursor = null;
      while (hasNextPage) {
        const query = `{
          collection(id: "gid://shopify/Collection/${col.id}") {
            products(first: 250${cursor ? `, after: "${cursor}"` : ''}) {
              edges { node { handle } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`;
        const gqlResp = await fetch(`https://${storeUrl}/admin/api/2024-01/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const gqlData = await gqlResp.json();
        if (gqlData.errors) {
          console.error(`[sync] GraphQL error for "${col.title}":`, JSON.stringify(gqlData.errors));
          hasNextPage = false;
          continue;
        }
        const products = gqlData?.data?.collection?.products;
        if (products?.edges?.length > 0) {
          colProductCount += products.edges.length;
          for (const edge of products.edges) {
            const handle = edge.node.handle;
            colHandles.push(handle);
            if (!productCollections[handle]) productCollections[handle] = [];
            if (!productCollections[handle].includes(col.title)) {
              productCollections[handle].push(col.title);
            }
          }
          hasNextPage = products.pageInfo.hasNextPage;
          cursor = products.pageInfo.endCursor;
        } else {
          hasNextPage = false;
        }
      }
      console.log(`[sync] Collection "${col.title}" (${col.handle}): ${colProductCount} products →`, colHandles);
    }
  } else {
    // Fallback: Storefront API (no admin token)
    const collectionsData = await fetchJSON(`https://${storeUrl}/collections.json?limit=250`);
    for (const col of (collectionsData.collections || [])) {
      if (col.handle === 'all' || col.handle === 'frontpage') continue;
      const data = await fetchJSON(`https://${storeUrl}/collections/${col.handle}/products.json?limit=250`);
      for (const p of (data.products || [])) {
        if (!productCollections[p.handle]) productCollections[p.handle] = [];
        if (!productCollections[p.handle].includes(col.title)) productCollections[p.handle].push(col.title);
      }
    }
  }

  // 2. Fetch all products (Admin API if available, Storefront fallback)
  let allProducts = [];
  if (adminToken) {
    let sinceId = 0;
    let hasMore = true;
    while (hasMore) {
      const data = await fetchAdminJSON(
        `https://${storeUrl}/admin/api/2024-01/products.json?limit=250${sinceId ? `&since_id=${sinceId}` : ''}`, adminToken
      );
      if (!data.products || data.products.length === 0) {
        hasMore = false;
      } else {
        allProducts = allProducts.concat(data.products);
        sinceId = data.products[data.products.length - 1].id;
        if (data.products.length < 250) hasMore = false;
      }
    }
  } else {
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
  }

  // Log collection mapping summary
  const collectionNames = [...new Set(Object.values(productCollections).flat())];
  const mappedHandles = Object.keys(productCollections);
  console.log(`[sync] ${mappedHandles.length} products mapped across ${collectionNames.length} collections. "Best Selling":`, mappedHandles.filter(h => productCollections[h].includes('Best Selling')));

  // 3. Upsert products — use shared helper, then set tags (collections) separately
  let synced = 0;
  for (const p of allProducts) {
    try {
      await upsertProductFromShopify(storeId, storeUrl, p);
      // Full sync sets collection tags. If product wasn't found in any collection,
      // preserve existing tags (don't overwrite with empty array).
      const cols = productCollections[p.handle] || [];
      if (cols.length > 0) {
        await supabase.from('products')
          .update({ tags: JSON.stringify(cols) })
          .eq('shopify_id', p.id);
      }
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
    message: `Shopify sync complete — ${synced} products, ${collectionNames.length} collections${archived > 0 ? `, ${archived} archived` : ''}`,
    level: 'info',
    ...(storeId ? { store_id: storeId } : {}),
  });

  return res.status(200).json({
    synced,
    archived,
    total: allProducts.length,
    collections: collectionNames.length,
  });
}

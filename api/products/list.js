import { createClient } from '@supabase/supabase-js';
import { withAuth } from '../../lib/auth.js';
import { hasPermission, hasStoreAccess } from '../../lib/permissions.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id, store_id: storeId } = req.query;

    // store_id is required for every path below (single-product fetch and list). Fail
    // closed before any permission/store-access check so we never leak whether a check
    // was skipped due to a missing param.
    if (!storeId) {
      return res.status(400).json({ error: id ? 'store_id is required for single-product fetch' : 'store_id is required' });
    }
    if (!hasPermission(req.user, 'products:read')) {
      return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
    }
    if (!hasStoreAccess(req.user, storeId)) {
      return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
    }

    if (id) {
      // Single-product fetch: require store_id so a product from another store can't be
      // retrieved by guessing the id. Validate that the product belongs to the requested store.
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .eq('store_id', storeId)
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    // List/pagination path: store_id required + verified above — a query without it would
    // return products across ALL stores (cross-store leak).

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const showArchived = req.query.show_archived === 'true';

    // Count total products
    let countQuery = supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId);
    if (!showArchived) countQuery = countQuery.or('status.eq.active,status.is.null');
    const { count: total } = await countQuery;

    // Fetch paginated products
    let productsQuery = supabase
      .from('products')
      .select('id, shopify_id, handle, title, price, image_url, product_type, tags, status, created_at, has_size_chart')
      .eq('store_id', storeId)
      .order('title')
      .range(offset, offset + limit - 1);

    if (!showArchived) {
      productsQuery = productsQuery.or('status.eq.active,status.is.null');
    }

    const { data: products, error } = await productsQuery;

    if (error) throw error;

    // Get creative counts + published counts + audiences per product in one query
    const countsQuery = supabase
      .from('creatives')
      .select('product_id, status, metadata')
      .eq('store_id', storeId)
      .not('product_id', 'is', null);

    const { data: counts } = await countsQuery;

    const countMap = {};
    const publishedMap = {};
    const audienceMap = {};
    if (counts) {
      for (const c of counts) {
        countMap[c.product_id] = (countMap[c.product_id] || 0) + 1;
        if (c.status === 'published') publishedMap[c.product_id] = (publishedMap[c.product_id] || 0) + 1;
        const meta = c.metadata ? (typeof c.metadata === 'string' ? (() => { try { return JSON.parse(c.metadata); } catch { return {}; } })() : c.metadata) : {};
        if (meta.audience) {
          if (!audienceMap[c.product_id]) audienceMap[c.product_id] = new Set();
          audienceMap[c.product_id].add(meta.audience);
        }
      }
    }

    const enriched = products.map((p) => ({
      ...p,
      creative_count: countMap[p.id] || 0,
      published_count: publishedMap[p.id] || 0,
      audiences: audienceMap[p.id] ? [...audienceMap[p.id]] : [],
    }));

    return res.status(200).json({
      products: enriched,
      total: total || 0,
      page,
      pages: Math.ceil((total || 0) / limit),
    });
  } catch (err) {
    console.error('[api/products/list] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
}

export default withAuth(handler);

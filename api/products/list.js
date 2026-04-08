import { createClient } from '@supabase/supabase-js';
import { withAuth } from '../../lib/auth.js';

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

    if (id) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    // Count total products
    let countQuery = supabase.from('products').select('id', { count: 'exact', head: true });
    if (storeId) countQuery = countQuery.eq('store_id', storeId);
    const { count: total } = await countQuery;

    // Fetch paginated products
    let productsQuery = supabase
      .from('products')
      .select('id, shopify_id, handle, title, price, image_url, product_type, tags')
      .order('title')
      .range(offset, offset + limit - 1);

    if (storeId) {
      productsQuery = productsQuery.eq('store_id', storeId);
    }

    const { data: products, error } = await productsQuery;

    if (error) throw error;

    // Get creative counts per product in one query
    let countsQuery = supabase
      .from('creatives')
      .select('product_id')
      .not('product_id', 'is', null);

    if (storeId) {
      countsQuery = countsQuery.eq('store_id', storeId);
    }

    const { data: counts } = await countsQuery;

    const countMap = {};
    if (counts) {
      for (const c of counts) {
        countMap[c.product_id] = (countMap[c.product_id] || 0) + 1;
      }
    }

    const enriched = products.map((p) => ({
      ...p,
      creative_count: countMap[p.id] || 0,
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

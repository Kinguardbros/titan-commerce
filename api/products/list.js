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

    // Fetch all products with creative count
    let productsQuery = supabase
      .from('products')
      .select('id, shopify_id, handle, title, price, image_url, product_type, tags')
      .order('title');

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

    return res.status(200).json(enriched);
  } catch (err) {
    console.error('[api/products/list] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch products' });
  }
}

export default withAuth(handler);

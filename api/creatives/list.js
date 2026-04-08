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
    const { status, product_id, store_id: storeId } = req.query;

    let query = supabase
      .from('creatives')
      .select(`
        *,
        brief:briefs(id, product_name, product_url, price)
      `)
      .order('created_at', { ascending: false });

    if (storeId) {
      query = query.eq('store_id', storeId);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (product_id) {
      query = query.eq('product_id', product_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json(data);
  } catch (err) {
    console.error('[api/creatives/list] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch creatives' });
  }
}

export default withAuth(handler);

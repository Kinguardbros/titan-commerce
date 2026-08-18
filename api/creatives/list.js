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
    const { status, product_id, store_id: storeId } = req.query;

    // store_id is REQUIRED — without it this query would return creatives across ALL
    // stores (cross-store leak). Fail closed before any permission/store-access check.
    if (!storeId) {
      return res.status(400).json({ error: 'store_id is required' });
    }
    if (!hasPermission(req.user, 'products:read')) {
      return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
    }
    if (!hasStoreAccess(req.user, storeId)) {
      return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
    }

    let query = supabase
      .from('creatives')
      .select(`
        *,
        brief:briefs(id, product_name, product_url, price),
        product:products(id, title, image_url, handle)
      `)
      .order('created_at', { ascending: false })
      .eq('store_id', storeId)
      .is('deleted_at', null);

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

import { createClient } from '@supabase/supabase-js';
import { hasPermission, hasStoreAccess } from '../permissions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function pipeline_log(req, res) {
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  const storeId = req.query.store_id;
  // Pipeline log entries can include store-internal activity — non-admins must scope
  // to a store they have access to, otherwise an unscoped call leaks logs across all stores.
  if (req.user?.role !== 'admin' && !storeId) {
    return res.status(403).json({ error: 'forbidden', hint: 'store_id required for non-admin users' });
  }
  if (storeId && !hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  let query = supabase.from('pipeline_log').select('*').order('created_at', { ascending: false }).limit(50);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json(data);
}

import { createClient } from '@supabase/supabase-js';
import { getAllStores } from '../store-context.js';
import { hasStoreAccess } from '../permissions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// No hasPermission gate here — any authenticated user may call stores_list (per brief:
// "none — but result MUST be filtered to user.store_access unless admin/master"). The
// response stays a bare array (not { stores: [...] }) — the frontend (useActiveStore.jsx
// StoreProvider) calls .find()/.map() directly on the fetch body; wrapping it would break
// the store switcher silently.
export async function stores_list(req, res) {
  const stores = await getAllStores();
  // brand_config stays server-side (brand voice, payment fees, …); the dashboard only needs the
  // feature switches, e.g. features.size_chart_text picks the product page's size chart editor.
  const safeStores = stores.map(({ admin_token, brand_config, ...rest }) => ({
    ...rest,
    has_admin: !!admin_token,
    features: brand_config?.features || {},
  }));
  const visibleStores = (req.user?.role === 'admin' || req.user?.master)
    ? safeStores
    : safeStores.filter((s) => hasStoreAccess(req.user, s.id));
  return res.status(200).json(visibleStores);
}

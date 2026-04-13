import { createClient } from '@supabase/supabase-js';
import { getAllStores } from '../store-context.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function stores_list(req, res) {
  const stores = await getAllStores();
  const safeStores = stores.map(({ admin_token, ...rest }) => ({
    ...rest,
    has_admin: !!admin_token,
  }));
  return res.status(200).json(safeStores);
}

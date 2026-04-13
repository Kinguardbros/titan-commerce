import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function pipeline_log(req, res) {
  let query = supabase.from('pipeline_log').select('*').order('created_at', { ascending: false }).limit(50);
  if (req.query.store_id) query = query.eq('store_id', req.query.store_id);
  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json(data);
}

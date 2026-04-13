import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function update_cogs(req, res) {
  const { product_id, cogs } = req.body;
  if (!product_id || cogs === undefined) return res.status(400).json({ error: 'product_id and cogs required' });
  const { data, error } = await supabase.from('products').update({ cogs: parseFloat(cogs) }).eq('id', product_id).select().single();
  if (error) throw error;
  return res.status(200).json(data);
}

export async function manual_adspend(req, res) {
  const { date, channel, amount } = req.body;
  if (!date || !channel || amount === undefined) return res.status(400).json({ error: 'date, channel, amount required' });
  const { data, error } = await supabase.from('manual_adspend').upsert({ date, channel, amount: parseFloat(amount) }, { onConflict: 'date,channel' }).select().single();
  if (error) throw error;
  return res.status(200).json(data);
}

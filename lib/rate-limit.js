import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function rateLimit(key, maxRequests = 10, windowMs = 60000) {
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  // Clean old entries and count current window
  await supabase.from('rate_limits').delete().eq('key', key).lt('created_at', windowStart);

  const { count, error } = await supabase
    .from('rate_limits')
    .select('id', { count: 'exact', head: true })
    .eq('key', key)
    .gte('created_at', windowStart);

  if (error) {
    console.error('[RateLimit] Query failed:', { key, error: error.message });
    return true; // fail open — don't block requests if DB is unreachable
  }

  if (count >= maxRequests) return false;

  await supabase.from('rate_limits').insert({ key });
  return true;
}

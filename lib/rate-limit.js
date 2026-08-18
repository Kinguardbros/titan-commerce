import { createClient } from '@supabase/supabase-js';
import { captureException } from './notify.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// C1b (Docs/AUDIT-2026-08-B.md): fail-open must not mask the rate_limits table's own
// absence — that exact combination let every limiter silently no-op in prod while the
// migration ledger said the table existed. A 42P01 (undefined_table) now logs loudly AND
// escalates to Telegram via captureException, but STILL fails open (never block traffic
// on infra breakage). Telegram send is once per module instance (per Vercel cold start)
// so a hot endpoint doesn't flood the channel; console.error fires every call.
let missingTableEscalated = false;

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
    if (error.code === '42P01') {
      console.error('[rate-limit] FATAL: rate_limits table missing — limits are NO-OP');
      if (!missingTableEscalated) {
        missingTableEscalated = true;
        await captureException(
          new Error('rate_limits table missing (42P01) — ALL rate limiting is a NO-OP'),
          { tags: { module: 'rate-limit', key } }
        );
      }
    } else {
      console.error('[RateLimit] Query failed:', { key, error: error.message });
    }
    return true; // fail open — don't block requests if DB is unreachable
  }

  if (count >= maxRequests) return false;

  await supabase.from('rate_limits').insert({ key });
  return true;
}

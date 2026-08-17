import { createClient } from '@supabase/supabase-js';
import { createShopifyClient } from '../../lib/shopify-admin.js';
import { detectEventsForStore } from '../../lib/event-detector.js';
import { poll_generations } from '../../lib/actions/creatives.js';
import { initSentry, captureException } from '../../lib/sentry.js';

// Backend error monitoring (P1-21, AUDIT-2026-08) — no-op unless SENTRY_DSN is set.
// Cron failures were previously console.error-only (per P1-20 finding) — invisible
// unless someone tails Vercel logs the day it runs.
initSentry();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Concurrency cap for per-store event detection (P1-13, AUDIT-2026-08). With the
// current 2-6 active stores, unbounded parallel (Promise.allSettled over all of
// them at once) is fine. This constant exists for when the store count grows past
// ~10 — Shopify Admin API and Claude API rate limits are per-credential-set, so a
// large simultaneous fan-out could start tripping 429s. Lower it (e.g. to 3-5) if
// that shows up in pipeline_log / Sentry for the cron run.
const MAX_PARALLEL_STORES = 10;

// Runs `fn` over `items` in batches of at most `batchSize` concurrent calls,
// batches sequential. Each item's outcome is independent (Promise.allSettled) —
// one item throwing never aborts the batch or later batches.
async function runInBatches(items, batchSize, fn) {
  const settled = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    settled.push(...(await Promise.allSettled(batch.map(fn))));
  }
  return settled;
}

// Per-store event detection: fetch top products from Shopify, then run shared
// detection logic. Throws on failure (getTopProductsWithCreatives or
// detectEventsForStore) — the caller wraps store processing in
// Promise.allSettled so one store's failure never blocks the others.
async function processStore(store) {
  if (!store.admin_token) {
    return { storeId: store.id, storeName: store.name, skipped: true, eventsCreated: 0, proposalsCreated: 0 };
  }

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  let topProducts;
  try {
    topProducts = await client.getTopProductsWithCreatives(7, 30);
  } catch (err) {
    throw new Error(`[${store.name}] getTopProductsWithCreatives failed: ${err.message}`);
  }

  const result = await detectEventsForStore(store.id, topProducts, supabase);
  return { storeId: store.id, storeName: store.name, skipped: false, eventsCreated: result.eventsCreated, proposalsCreated: result.proposalsCreated };
}

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  // Safety-net: finalize any fal.ai generations that were submitted but left unclaimed
  // (user closed the browser before polling finished, etc.). Ignore errors.
  //
  // poll_generations() is a permission-gated action (hasPermission/hasStoreAccess) —
  // it normally runs behind withAuth() with a real logged-in req.user. This internal
  // cron call has no session, so it synthesizes a SYSTEM admin user context (P1-20
  // follow-up, AUDIT-2026-08): without it, hasPermission(undefined, ...) is always
  // false and this call 403s silently every single day (swallowed by the catch below,
  // so `polled` in the response was always {checked:0, completed:0, failed:0}).
  // role:'admin' satisfies both the permission check and the store-scoping check
  // (admin trumps store_access) — same as the master-token / admin dashboard path.
  const SYSTEM_USER = { id: 'system-cron', role: 'admin', permissions: [], store_access: [] };
  let pollResult = { checked: 0, completed: 0, failed: 0 };
  try {
    const mockRes = { status: () => ({ json: (payload) => { pollResult = payload; } }) };
    await poll_generations({ query: {}, body: {}, user: SYSTEM_USER }, mockRes);
  } catch (pollErr) { console.error('[cron] poll_generations failed:', pollErr.message); }

  try {
    // Get all active stores
    const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true);

    // P1-13 (AUDIT-2026-08): previously a sequential `for` loop — wall-clock scaled
    // O(N) with store count and risked the Vercel cron timeout once past 4-6 stores.
    // Promise.allSettled (NOT Promise.all — that fail-fasts and aborts remaining
    // stores on the first rejection) caps wall-clock at roughly max(singleStoreTime)
    // instead of sum(singleStoreTime), and one store's throw never blocks the others.
    const settled = await runInBatches(stores || [], MAX_PARALLEL_STORES, processStore);

    let totalEvents = 0;
    let totalProposals = 0;
    const storeResults = [];
    const failedStores = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const v = outcome.value;
        storeResults.push(v);
        if (!v.skipped) {
          totalEvents += v.eventsCreated;
          totalProposals += v.proposalsCreated;
          console.log(`[cron] ${v.storeName}: ${v.eventsCreated} events, ${v.proposalsCreated} proposals`);
        }
      } else {
        const reason = outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
        console.error('[cron] Store event detection failed:', reason.message);
        captureException(reason, { tags: { action: 'cron_detect_events_store' } });
        failedStores.push(reason.message);
      }
    }

    // Check for unprocessed files in Inbox (all stores, no admin_token needed)
    for (const store of stores || []) {
      try {
        const { data: inboxFiles } = await supabase.storage.from('store-docs').list(`${store.name}/Inbox`);
        const realFiles = (inboxFiles || []).filter((f) => f.id !== null && f.name !== '.emptyFolderPlaceholder');
        if (realFiles.length > 0) {
          // Check if proposal already exists
          const { data: existingProp } = await supabase.from('proposals').select('id')
            .eq('store_id', store.id).eq('type', 'process_inbox').eq('status', 'pending').limit(1).single();
          if (!existingProp) {
            await supabase.from('proposals').insert({
              store_id: store.id, type: 'process_inbox',
              title: `Process ${realFiles.length} file(s) in ${store.name} Inbox`,
              description: `Unprocessed: ${realFiles.map((f) => f.name).slice(0, 5).join(', ')}${realFiles.length > 5 ? '...' : ''}`,
              suggested_action: JSON.stringify({ action: 'process_inbox', store_id: store.id, file_count: realFiles.length }),
              expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
            });
            totalProposals++;
          }
        }
      } catch (inboxErr) {
        console.error(`[cron] Inbox check failed for ${store.name}:`, inboxErr.message);
      }
    }

    // Auto-cleanup: delete pending creatives older than 7 days
    let cleanedUp = 0;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const { data: stale } = await supabase.from('creatives').select('id, storage_path')
        .eq('status', 'pending').lt('created_at', cutoff.toISOString());
      for (const c of stale || []) {
        if (c.storage_path) await supabase.storage.from('creatives').remove([c.storage_path]);
        await supabase.from('creatives').delete().eq('id', c.id);
        cleanedUp++;
      }
    } catch (cleanErr) { console.error('[cron] Cleanup failed:', cleanErr.message); }

    // Single aggregated pipeline_log entry (unchanged from pre-P1-13 behavior — this
    // was never split per-store even before parallelization, and this task doesn't
    // add per-store DB writes to avoid widening scope). Failure count appended so a
    // partial run (some stores failed) is visible in the Cockpit TerminalLog, not
    // just in Sentry/console.
    const failureSuffix = failedStores.length > 0 ? `, ${failedStores.length} store(s) failed` : '';
    await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: failedStores.length > 0 ? 'warn' : 'info', message: `Cron scan: ${totalEvents} events, ${totalProposals} proposals, ${cleanedUp} stale cleaned, ${pollResult.completed || 0} generations finalized${failureSuffix}`, user_id: null, initiator: 'cron' });
    // Top-level shape (events/proposals/cleaned/polled) is unchanged for backward
    // compat with anything watching this endpoint. `stores` + `failures` are new,
    // additive fields summarizing the per-store parallel run (P1-13, AUDIT-2026-08).
    return res.status(200).json({ events: totalEvents, proposals: totalProposals, cleaned: cleanedUp, polled: pollResult, stores: storeResults, failures: failedStores });
  } catch (err) {
    console.error('[cron/detect-events] Error:', err);
    captureException(err, { tags: { action: 'cron_detect_events' } });
    return res.status(500).json({ error: 'Cron failed', details: err.message });
  }
}

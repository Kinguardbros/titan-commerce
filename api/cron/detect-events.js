import { createClient } from '@supabase/supabase-js';
import { createShopifyClient } from '../../lib/shopify-admin.js';
import { detectEventsForStore } from '../../lib/event-detector.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this automatically for cron jobs)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }

  try {
    // Get all active stores
    const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true);
    let totalEvents = 0;
    let totalProposals = 0;

    for (const store of stores || []) {
      if (!store.admin_token) continue;

      const client = createShopifyClient(store.shopify_url, store.admin_token);
      let topProducts = [];
      try {
        topProducts = await client.getTopProductsWithCreatives(7, 30);
      } catch (err) {
        console.error(`[cron] Failed to get products for ${store.name}:`, err);
        continue;
      }

      const result = await detectEventsForStore(store.id, topProducts, supabase);
      totalEvents += result.eventsCreated;
      totalProposals += result.proposalsCreated;
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

    // Auto-cleanup: delete pending creatives older than 2 days
    let cleanedUp = 0;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 2);
      const { data: stale } = await supabase.from('creatives').select('id, storage_path')
        .eq('status', 'pending').lt('created_at', cutoff.toISOString());
      for (const c of stale || []) {
        if (c.storage_path) await supabase.storage.from('creatives').remove([c.storage_path]);
        await supabase.from('creatives').delete().eq('id', c.id);
        cleanedUp++;
      }
    } catch (cleanErr) { console.error('[cron] Cleanup failed:', cleanErr.message); }

    await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', message: `Cron scan: ${totalEvents} events, ${totalProposals} proposals, ${cleanedUp} stale cleaned` });
    return res.status(200).json({ events: totalEvents, proposals: totalProposals, cleaned: cleanedUp });
  } catch (err) {
    console.error('[cron/detect-events] Error:', err);
    return res.status(500).json({ error: 'Cron failed', details: err.message });
  }
}

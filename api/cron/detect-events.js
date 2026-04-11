import { createClient } from '@supabase/supabase-js';
import { createShopifyClient } from '../../lib/shopify-admin.js';

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
      if (!store.admin_token) continue; // Skip stores without admin access

      const client = createShopifyClient(store.shopify_url, store.admin_token);
      let topProducts = [];
      try {
        topProducts = await client.getTopProductsWithCreatives(7, 30);
      } catch (err) {
        console.error(`[cron] Failed to get products for ${store.name}:`, err);
        continue;
      }

      for (const p of topProducts) {
        if (!p.product_id) continue;

        // product_no_creatives
        if (p.units > 0 && p.creative_count === 0) {
          const { data: existing } = await supabase.from('events').select('id').eq('store_id', store.id).eq('product_id', p.product_id).eq('type', 'product_no_creatives').in('status', ['new', 'proposal_created']).limit(1).single();
          if (!existing) {
            const { data: evt } = await supabase.from('events').insert({ store_id: store.id, type: 'product_no_creatives', product_id: p.product_id, severity: 'high', title: `${p.title} has no creatives`, description: `Sold ${p.units} units but has 0 creatives`, metadata: JSON.stringify({ revenue: p.revenue, units: p.units }) }).select().single();
            if (evt) {
              await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
              await supabase.from('proposals').insert({ store_id: store.id, event_id: evt.id, type: 'generate_creatives', product_id: p.product_id, title: `Generate creatives for "${p.title}"`, description: `${p.units} units sold, 0 creatives`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative', 'lifestyle'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
              totalEvents++; totalProposals++;
            }
          }
        }

        // revenue_declining
        if (p.trend !== null && parseInt(p.trend) < -10 && p.creative_count > 0) {
          const { data: existing } = await supabase.from('events').select('id').eq('store_id', store.id).eq('product_id', p.product_id).eq('type', 'revenue_declining').in('status', ['new', 'proposal_created']).limit(1).single();
          if (!existing) {
            const { data: evt } = await supabase.from('events').insert({ store_id: store.id, type: 'revenue_declining', product_id: p.product_id, severity: 'medium', title: `${p.title} revenue declining (${p.trend}%)`, metadata: JSON.stringify({ revenue: p.revenue, trend: p.trend }) }).select().single();
            if (evt) {
              await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
              await supabase.from('proposals').insert({ store_id: store.id, event_id: evt.id, type: 'try_different_style', product_id: p.product_id, title: `Try new style for "${p.title}"`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 2, styles: ['lifestyle'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
              totalEvents++; totalProposals++;
            }
          }
        }

        // winner_detected
        if (p.trend !== null && parseInt(p.trend) > 15 && p.revenue > 100) {
          const { data: existing } = await supabase.from('events').select('id').eq('store_id', store.id).eq('product_id', p.product_id).eq('type', 'winner_detected').in('status', ['new', 'proposal_created']).limit(1).single();
          if (!existing) {
            const { data: evt } = await supabase.from('events').insert({ store_id: store.id, type: 'winner_detected', product_id: p.product_id, severity: 'low', title: `Winner: ${p.title} (+${p.trend}%)`, metadata: JSON.stringify({ revenue: p.revenue, trend: p.trend }) }).select().single();
            if (evt) {
              await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
              await supabase.from('proposals').insert({ store_id: store.id, event_id: evt.id, type: 'generate_variations', product_id: p.product_id, title: `Scale winner: "${p.title}"`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
              totalEvents++; totalProposals++;
            }
          }
        }
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

    await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', message: `Cron scan: ${totalEvents} events, ${totalProposals} proposals across ${stores?.length || 0} stores` });
    return res.status(200).json({ events: totalEvents, proposals: totalProposals });
  } catch (err) {
    console.error('[cron/detect-events] Error:', err);
    return res.status(500).json({ error: 'Cron failed', details: err.message });
  }
}

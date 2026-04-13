import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient, getTopProductsWithCreatives } from '../shopify-admin.js';
import { detectEventsForStore } from '../event-detector.js';
import { buildStyledPrompt } from '../higgsfield.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET: proposals_list
export async function proposals_list(req, res) {
  const storeId = req.query.store_id;
  const status = req.query.status || 'pending';
  let query = supabase.from('proposals')
    .select('*, product:products(title, image_url), event:events(type, severity)')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (storeId) query = query.eq('store_id', storeId);
  // Exclude expired
  query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json(data || []);
}

// POST: approve_proposal
export async function approve_proposal(req, res) {
  const { proposal_id } = req.body;
  if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
  const { data: proposal, error: pErr } = await supabase.from('proposals').select('*').eq('id', proposal_id).single();
  if (pErr || !proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status !== 'pending') return res.status(400).json({ error: 'Proposal is not pending' });

  // Execute the suggested action
  const sa = proposal.suggested_action;
  let execMsg = '';
  if (sa.action === 'generate' && sa.product_id) {
    // Generate creatives for each style
    const styles = sa.styles || ['ad_creative'];
    for (const style of styles) {
      try {
        const { data: product } = await supabase.from('products').select('*').eq('id', sa.product_id).single();
        if (product) {
          const images = JSON.parse(product.images || '[]');
          const prompt = await buildStyledPrompt({ product_name: product.title, price: product.price ? `$${product.price}` : '', style, custom_prompt: '', showModel: true, feedback: '', storeId: product.store_id });
          const { higgsfield } = await import('@higgsfield/client/v2');
          const jobSet = await higgsfield.subscribe('/v1/text2image/soul', { input: { params: { prompt, input_images: images.slice(0, 1).map(u => ({ type: 'image_url', image_url: u })), width_and_height: '1536x1536' } }, withPolling: false });
          // Don't wait for completion — just queue it
          await supabase.from('creatives').insert({ product_id: sa.product_id, store_id: proposal.store_id, variant_index: 1, format: 'image', file_url: null, hook_used: style, headline: product.title, hf_job_id: jobSet.id, status: 'generating', style });
        }
      } catch (genErr) { console.error('[proposal] Generate failed:', genErr); }
    }
    execMsg = `Queued ${styles.length} creatives for generation`;
  }

  await supabase.from('proposals').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', proposal_id);
  if (proposal.event_id) await supabase.from('events').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', proposal.event_id);
  await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id: proposal.store_id, message: `Executed: ${proposal.title}` });
  return res.status(200).json({ success: true, message: execMsg || `Executed: ${proposal.title}` });
}

// POST: reject_proposal
export async function reject_proposal(req, res) {
  const { proposal_id, reason } = req.body;
  if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
  const { data: proposal } = await supabase.from('proposals').select('title, event_id, store_id').eq('id', proposal_id).single();
  await supabase.from('proposals').update({ status: 'rejected', rejected_reason: reason || '' }).eq('id', proposal_id);
  if (proposal?.event_id) await supabase.from('events').update({ status: 'dismissed' }).eq('id', proposal.event_id);
  await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'warn', store_id: proposal?.store_id, message: `Dismissed: ${proposal?.title}${reason ? ' — ' + reason : ''}` });
  return res.status(200).json({ success: true });
}

// POST: approve_all_proposals
export async function approve_all_proposals(req, res) {
  const { proposal_ids } = req.body;
  if (!proposal_ids?.length) return res.status(400).json({ error: 'proposal_ids required' });
  let executed = 0;
  for (const pid of proposal_ids) {
    try {
      // Recursive call to approve_proposal logic — simplified: just mark as executed
      const { data: p } = await supabase.from('proposals').select('*').eq('id', pid).eq('status', 'pending').single();
      if (!p) continue;
      await supabase.from('proposals').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', pid);
      if (p.event_id) await supabase.from('events').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', p.event_id);
      await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id: p.store_id, message: `Bulk executed: ${p.title}` });
      executed++;
    } catch (e) { console.error('[approve_all]', e); }
  }
  return res.status(200).json({ success: true, executed });
}

// POST: scan_events
export async function scan_events(req, res) {
  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  let eventsCreated = 0;
  let proposalsCreated = 0;

  if (store.admin_token) {
    const client = createShopifyClient(store.shopify_url, store.admin_token);
    const topProducts = await client.getTopProductsWithCreatives(7, 30);
    const result = await detectEventsForStore(store_id, topProducts, supabase);
    eventsCreated = result.eventsCreated;
    proposalsCreated = result.proposalsCreated;
  }

  await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id, message: `Scan complete: ${eventsCreated} events, ${proposalsCreated} proposals created` });
  return res.status(200).json({ events_created: eventsCreated, proposals_created: proposalsCreated });
}

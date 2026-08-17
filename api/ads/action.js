import { createClient } from '@supabase/supabase-js';
import { withAuth } from '../../lib/auth.js';
import { hasPermission, hasStoreAccess } from '../../lib/permissions.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, creative_id, ad_id, approved_by, rejected_by, reason, comment } = req.body;

    if (action === 'approve') {
      if (!creative_id) return res.status(400).json({ error: 'creative_id required' });
      const { data: creative, error: fetchErr } = await supabase
        .from('creatives').select('*').eq('id', creative_id).single();
      if (fetchErr) throw fetchErr;

      if (!hasPermission(req.user, 'creatives:generate')) {
        return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
      }
      if (!hasStoreAccess(req.user, creative.store_id)) {
        return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
      }

      const { data, error } = await supabase
        .from('creatives')
        .update({ status: 'approved', approved_by: approved_by || 'Team', approved_at: new Date().toISOString() })
        .eq('id', creative_id).eq('status', 'pending').select().single();
      if (error) throw error;

      await supabase.from('pipeline_log').insert({
        agent: 'PUBLISHER',
        message: `Creative approved${comment ? ': ' + comment.slice(0, 200) : ''} — style: ${creative.style || 'ad_creative'}`,
        level: 'info',
        metadata: JSON.stringify({
          creative_id,
          product_id: creative.product_id,
          hook_used: creative.hook_used,
          style: creative.style,
          comment: comment || '',
          action: 'approved',
        }),
        user_id: req.user?.user_id || null, initiator: 'user',
      });
      return res.status(200).json(data);
    }

    if (action === 'reject') {
      if (!creative_id) return res.status(400).json({ error: 'creative_id required' });

      // Load creative before deleting (for feedback learning + storage cleanup)
      const { data: creative, error: fetchErr } = await supabase
        .from('creatives').select('*').eq('id', creative_id).single();
      if (fetchErr) throw fetchErr;

      if (!hasPermission(req.user, 'creatives:generate')) {
        return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
      }
      if (!hasStoreAccess(req.user, creative.store_id)) {
        return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
      }

      // Log rejection details + reason for learning (generate API reads these)
      await supabase.from('pipeline_log').insert({
        agent: 'PUBLISHER',
        message: `Creative rejected${reason ? ': ' + reason.slice(0, 200) : ''} — style: ${creative.style || 'ad_creative'}`,
        level: 'warn',
        metadata: JSON.stringify({
          creative_id,
          product_id: creative.product_id,
          hook_used: creative.hook_used,
          style: creative.style,
          show_model: creative.show_model,
          reason: reason || '',
          action: 'rejected',
        }),
        user_id: req.user?.user_id || null, initiator: 'user',
      });

      // Delete file from Supabase Storage
      if (creative.storage_path) {
        await supabase.storage.from('creatives').remove([creative.storage_path]);
      }

      // Delete the creative record
      const { error: delErr } = await supabase
        .from('creatives').delete().eq('id', creative_id);
      if (delErr) throw delErr;

      return res.status(200).json({ deleted: creative_id });
    }

    if (action === 'pause') {
      if (!ad_id) return res.status(400).json({ error: 'ad_id required' });

      // ads has no direct store_id column — resolve it via the linked creative.
      const { data: adRow, error: adFetchErr } = await supabase
        .from('ads').select('*, creative:creatives(store_id)').eq('id', ad_id).single();
      if (adFetchErr || !adRow) return res.status(404).json({ error: 'Ad not found' });

      if (!hasPermission(req.user, 'creatives:generate')) {
        return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
      }
      if (!hasStoreAccess(req.user, adRow.creative?.store_id)) {
        return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
      }

      const { data, error } = await supabase
        .from('ads').update({ status: 'paused' }).eq('id', ad_id).select().single();
      if (error) throw error;
      await supabase.from('pipeline_log').insert({ agent: 'PUBLISHER', message: `Ad ${ad_id} paused`, level: 'warn', user_id: req.user?.user_id || null, initiator: 'user' });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown action. Use: approve, reject, pause' });
  } catch (err) {
    console.error('[api/ads/action] Error:', err);
    return res.status(500).json({ error: 'Action failed' });
  }
}

export default withAuth(handler);

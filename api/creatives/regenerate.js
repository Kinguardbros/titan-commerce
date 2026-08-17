import { createClient } from '@supabase/supabase-js';
import { generateImage, generateVideo, buildPrompt, buildStyledPrompt } from '../../lib/higgsfield.js';
import { withAuth } from '../../lib/auth.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { hasPermission, hasStoreAccess } from '../../lib/permissions.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { creative_id } = req.body;
  if (!creative_id) {
    return res.status(400).json({ error: 'creative_id is required' });
  }

  try {
    const { data: creative, error: cErr } = await supabase
      .from('creatives')
      .select('*, brief:briefs(*)')
      .eq('id', creative_id)
      .single();

    if (cErr || !creative) {
      return res.status(404).json({ error: 'Creative not found' });
    }

    if (!hasPermission(req.user, 'creatives:generate')) {
      return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
    }
    if (!hasStoreAccess(req.user, creative.store_id)) {
      return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
    }

    // Per-store + per-user rate limit (P0-8 from AUDIT-2026-08)
    if (!await rateLimit(`regenerate:${creative.store_id}:${req.user.user_id || req.user.username || 'master'}`, 20, 3600000)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // --- VIDEO REGENERATION ---
    if (creative.format === 'video') {
      const metadata = typeof creative.metadata === 'string'
        ? JSON.parse(creative.metadata)
        : (creative.metadata || {});
      const sourceImageUrl = metadata.source_image_url;
      if (!sourceImageUrl) throw new Error('No source image URL for video regeneration');

      const prompt = creative.hook_used || creative.headline || 'Fashion ad video';

      await supabase.from('pipeline_log').insert({
        agent: 'FORGE', level: 'info',
        message: `Regenerating video creative`,
        user_id: req.user?.user_id || null, initiator: 'user',
      });

      const result = await generateVideo({ prompt, imageUrl: sourceImageUrl });
      if (!result.url) throw new Error('No URL returned from Higgsfield');

      const baseName = creative.product_id || creative.brief_id || 'unknown';
      const storagePath = `creatives/${baseName}_video_r${Date.now()}.mp4`;
      let fileUrl = result.url;
      try {
        const resp = await fetch(result.url);
        const buf = await resp.arrayBuffer();
        await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });
        const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
        fileUrl = pub.publicUrl;
      } catch (e) {
        console.error('[regenerate] Video storage upload failed:', e);
      }

      const { data: updated, error: uErr } = await supabase
        .from('creatives')
        .update({ file_url: fileUrl, storage_path: storagePath, hf_job_id: result.jobId })
        .eq('id', creative_id)
        .select()
        .single();

      if (uErr) throw uErr;

      await supabase.from('pipeline_log').insert({
        agent: 'FORGE', level: 'info',
        message: `Regenerated video — new video ready`,
        user_id: req.user?.user_id || null, initiator: 'user',
      });

      return res.status(200).json(updated);
    }

    // --- IMAGE REGENERATION ---
    let prompt, imageUrls;

    if (creative.brief) {
      // Brief-based creative (from SCRAPER → FORGE pipeline)
      const brief = creative.brief;
      const visual_refs = JSON.parse(brief.visual_refs || '[]');
      imageUrls = visual_refs.filter((u) => u.startsWith('http'));
      prompt = buildPrompt({
        product_name: brief.product_name,
        price: brief.price,
        headline: creative.headline,
        hook: creative.hook_used,
      });
    } else if (creative.product_id) {
      // Product-based creative (from generate page)
      const { data: product } = await supabase
        .from('products').select('*').eq('id', creative.product_id).single();
      if (!product) throw new Error('Product not found for regeneration');

      const images = JSON.parse(product.images || '[]');
      imageUrls = images.slice(0, 1);
      prompt = await buildStyledPrompt({
        product_name: product.title,
        price: product.price ? `$${product.price}` : '',
        style: creative.style || 'ad_creative',
        custom_prompt: creative.hook_used || '',
        showModel: true,
        storeId: creative.store_id,
      });
    } else {
      throw new Error('Creative has no brief or product reference');
    }

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info',
      message: `Regenerating image creative`,
      user_id: req.user?.user_id || null, initiator: 'user',
    });

    const result = await generateImage({ prompt, imageUrls: imageUrls.slice(0, 1) });
    if (!result.url) throw new Error('No URL returned from Higgsfield');

    const baseName = creative.brief_id || creative.product_id || 'unknown';
    const storagePath = `creatives/${baseName}_v${creative.variant_index}_r${Date.now()}.png`;
    let fileUrl = result.url;
    try {
      const imgResp = await fetch(result.url);
      const buf = await imgResp.arrayBuffer();
      await supabase.storage.from('creatives').upload(storagePath, buf, {
        contentType: 'image/png',
        upsert: true,
      });
      const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
      fileUrl = pub.publicUrl;
    } catch (e) {
      console.error('[regenerate] Storage upload failed, using direct URL:', e);
    }

    const { data: updated, error: uErr } = await supabase
      .from('creatives')
      .update({ file_url: fileUrl, storage_path: storagePath, hf_job_id: result.jobId })
      .eq('id', creative_id)
      .select()
      .single();

    if (uErr) throw uErr;

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info',
      message: `Regenerated image — new image ready`,
      user_id: req.user?.user_id || null, initiator: 'user',
    });

    return res.status(200).json(updated);
  } catch (err) {
    console.error('[api/creatives/regenerate] Error:', err);
    return res.status(500).json({ error: 'Failed to regenerate', details: err.message });
  }
}

export default withAuth(handler);

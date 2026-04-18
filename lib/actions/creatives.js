import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../rate-limit.js';
import { buildStyledPrompt } from '../higgsfield.js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { checkFalJob, submitFalJob } from '../fal.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// POST: update_creative
export async function update_creative(req, res) {
  const { creative_id, hook_used, headline } = req.body;
  if (!creative_id) return res.status(400).json({ error: 'creative_id required' });
  const updates = {};
  if (hook_used !== undefined) updates.hook_used = hook_used;
  if (headline !== undefined) updates.headline = headline;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields' });
  const { data, error } = await supabase.from('creatives').update(updates).eq('id', creative_id).select().single();
  if (error) throw error;
  return res.status(200).json(data);
}

// POST: generate_branded
export async function generate_branded(req, res) {
  if (!await rateLimit('generate_branded', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const { store_id, type = 'branded_lifestyle', prompt, style = 'lifestyle', show_model = true } = req.body;
  if (!store_id || !prompt) return res.status(400).json({ error: 'store_id and prompt required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const brandName = store.name || 'Brand';
  const brandConfig = typeof store.brand_config === 'string' ? JSON.parse(store.brand_config || '{}') : (store.brand_config || {});

  // Build store-specific brand context
  const BRAND_CONTEXTS = {
    'elegance-house': `BRAND: Elegance House — elegant women's fashion for women 35-60. Warm gold tones (#d4a853), cream backgrounds (#f5f0e8), professional studio or lifestyle settings. Sophisticated, timeless, confident. Model: woman 35-55, approachable, not model-perfect.`,
    'isola': `BRAND: Isola World — tummy-control swimwear for women 30-55. Ocean blues, warm sand tones, coral accents. Beach, poolside, resort settings, golden hour lighting. Natural curvy body (size 10-18), authentic and confident. Vacation vibes, not fashion shoot.`,
  };
  const brandContext = BRAND_CONTEXTS[store.slug] || brandConfig.brand_voice || `BRAND: ${brandName}`;
  const logoNote = brandConfig.logo_white ? `Brand logo available at: ${brandConfig.logo_white}` : '';

  const contextualPrompt = `[${brandContext}${logoNote ? `\n${logoNote}` : ''}]\n\nUser request: ${prompt}`;

  const fullPrompt = await buildStyledPrompt({
    product_name: brandName,
    price: '',
    style,
    custom_prompt: contextualPrompt,
    showModel: show_model,
    feedback: '',
    storeId: store_id,
  });

  // Use store logo as input_image for branded banners/social (adds brand identity)
  const inputImages = [];
  const logoUrl = brandConfig.logo_white || brandConfig.logo_black;
  if (logoUrl && (type === 'branded_banner' || type === 'branded_social')) {
    inputImages.push({ type: 'image_url', image_url: logoUrl });
  }

  const POLL_INTERVAL = 2000;
  const MAX_POLL = 55000;
  async function pollDone(rid) {
    const creds = process.env.HF_CREDENTIALS;
    const hdrs = { 'Authorization': `Key ${creds}`, 'User-Agent': 'higgsfield-server-js/2.0' };
    const start = Date.now();
    while (Date.now() - start < MAX_POLL) {
      const r = await fetch(`https://platform.higgsfield.ai/requests/${rid}/status`, { headers: hdrs });
      const d = await r.json();
      if (d.status === 'completed') return d.images?.[0]?.url || d.video?.url;
      if (d.status === 'failed' || d.status === 'nsfw') return null;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    return null;
  }

  const { higgsfield } = await import('@higgsfield/client/v2');
  const jobSet = await higgsfield.subscribe('/v1/text2image/soul', {
    input: { params: { prompt: fullPrompt, input_images: inputImages, width_and_height: '1536x1536' } },
    withPolling: false,
  });
  const imageUrl = await pollDone(jobSet.id);
  if (!imageUrl) throw new Error('Generation failed');

  const storagePath = `creatives/${store.slug}_branded_${Date.now()}.png`;
  let fileUrl = imageUrl;
  try {
    const imgResp = await fetch(imageUrl);
    const buf = await imgResp.arrayBuffer();
    await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'image/png', upsert: true });
    const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
    fileUrl = pub.publicUrl;
  } catch (storageErr) {
    console.error('[generate_branded] Storage upload failed:', storageErr);
  }

  const { data: creative, error: cErr } = await supabase.from('creatives').insert({
    store_id, product_id: null, variant_index: 1, format: 'image',
    file_url: fileUrl, storage_path: storagePath,
    hook_used: prompt, headline: `${brandName} — ${type.replace('branded_', '')}`,
    hf_job_id: jobSet.id, status: 'pending', style, type,
  }).select().single();
  if (cErr) throw cErr;

  await supabase.from('pipeline_log').insert({ agent: 'FORGE', level: 'info', store_id, message: `Generated branded ${type} for ${brandName}` });

  return res.status(200).json({ creative_id: creative.id, generated: 1 });
}

// POST: push_creative_to_shopify
export async function push_creative_to_shopify(req, res) {
  const { creative_id, store_id } = req.body;
  if (!creative_id || !store_id) return res.status(400).json({ error: 'creative_id and store_id required' });

  const { data: creative } = await supabase.from('creatives').select('file_url, storage_path, product_id, status').eq('id', creative_id).single();
  if (!creative?.file_url) return res.status(404).json({ error: 'Creative not found' });
  if (creative.status !== 'approved' && creative.status !== 'published') return res.status(400).json({ error: `Cannot push creative with status "${creative.status}" — approve it first` });

  const { data: product } = await supabase.from('products').select('shopify_id, title').eq('id', creative.product_id).single();
  if (!product?.shopify_id) return res.status(400).json({ error: 'Product missing Shopify ID — sync the product first' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  // Ensure we use a persistent URL (Supabase Storage), not an expiring fal.ai URL
  let pushUrl = creative.file_url;
  if (pushUrl.includes('fal.run') || pushUrl.includes('fal.ai')) {
    // Re-upload to Supabase Storage if file_url is still a fal.ai temporary URL
    try {
      console.log('[push_creative] Re-uploading from fal.ai to Supabase Storage');
      const imgResp = await fetch(pushUrl);
      if (!imgResp.ok) return res.status(400).json({ error: 'Creative image URL expired — regenerate the image' });
      const buf = await imgResp.arrayBuffer();
      const path = creative.storage_path || `creatives/push_${creative_id}_${Date.now()}.png`;
      await supabase.storage.from('creatives').upload(path, buf, { contentType: 'image/png', upsert: true });
      const { data: pub } = supabase.storage.from('creatives').getPublicUrl(path);
      pushUrl = pub.publicUrl;
      await supabase.from('creatives').update({ file_url: pushUrl, storage_path: path }).eq('id', creative_id);
    } catch (uploadErr) {
      console.error('[push_creative] Re-upload failed:', uploadErr.message);
      return res.status(400).json({ error: 'Creative image expired and re-upload failed — regenerate the image' });
    }
  }

  // Add image to Shopify product (append, not replace)
  const addResult = await fetch(`https://${store.shopify_url}/admin/api/2024-01/products/${product.shopify_id}/images.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': store.admin_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: { src: pushUrl } }),
  });

  if (!addResult.ok) {
    const errText = await addResult.text();
    console.error('[push_creative] Shopify error:', errText);
    const hint = errText.includes('could not be downloaded') ? 'Shopify could not download the image — try regenerating' : 'Shopify API error';
    return res.status(500).json({ error: 'Failed to add image to Shopify', hint });
  }

  // Mark creative as published
  await supabase.from('creatives').update({ status: 'published' }).eq('id', creative_id);

  // Sync the product images array so the new photo shows immediately in the UI
  try {
    const imgListRes = await fetch(`https://${store.shopify_url}/admin/api/2024-01/products/${product.shopify_id}/images.json`, {
      headers: { 'X-Shopify-Access-Token': store.admin_token },
    });
    if (imgListRes.ok) {
      const imgListData = await imgListRes.json();
      const allImages = (imgListData.images || []).map((img) => img.src);
      await supabase.from('products').update({
        images: JSON.stringify(allImages),
        image_url: allImages[0] || null,
      }).eq('shopify_id', String(product.shopify_id));
    }
  } catch (syncErr) {
    console.error('[push_creative] Image sync failed (non-blocking):', syncErr.message);
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'PUBLISHER',
    message: `Pushed creative to Shopify product images for "${product.title}"`,
    level: 'success', metadata: { creative_id, product_id: creative.product_id, shopify_id: product.shopify_id },
  });

  return res.status(200).json({ ok: true, message: 'Image added to product on Shopify' });
}

/**
 * GET: poll_generations — check status of `generating` creatives and finalize completed ones.
 * Safe to call concurrently; idempotent (filter by status='generating').
 */
export async function poll_generations(req, res) {
  const storeId = req.query.store_id || req.body?.store_id;
  let query = supabase.from('creatives')
    .select('id, hf_job_id, metadata, storage_path, created_at')
    .eq('status', 'generating')
    .not('hf_job_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(20);
  if (storeId) query = query.eq('store_id', storeId);

  const { data: pending, error } = await query;
  if (error) {
    console.error('[poll_generations] query failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
  if (!pending?.length) return res.status(200).json({ checked: 0, completed: 0, failed: 0 });

  const MAX_JOB_AGE_MS = 3 * 60 * 1000; // 3 minutes — fal.ai jobs that aren't done by now are effectively dead

  let checked = 0, completed = 0, failed = 0;
  for (const c of pending) {
    const meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {});
    const pollBase = meta.poll_base;
    if (!pollBase) continue;

    // Hard timeout: if job exceeded MAX_JOB_AGE_MS, auto-retry once or fail.
    const submittedAt = meta.submitted_at ? new Date(meta.submitted_at).getTime() : new Date(c.created_at).getTime();
    const retryCount = meta.retry_count || 0;

    if ((Date.now() - submittedAt) > MAX_JOB_AGE_MS) {
      if (retryCount < 1 && meta.model && meta.poll_base) {
        // Auto-retry: resubmit the same job to fal.ai
        try {
          const retryJob = await submitFalJob({ model: meta.model, prompt: meta.retry_prompt || c.hook_used || '', imageUrl: [], aspectRatio: '1:1' });
          await supabase.from('creatives').update({
            hf_job_id: retryJob.requestId,
            metadata: { ...meta, poll_base: retryJob.pollBase || meta.poll_base, submitted_at: new Date().toISOString(), retry_count: retryCount + 1 },
          }).eq('id', c.id);
          console.log('[poll_generations] auto-retry for', c.id, 'attempt:', retryCount + 1);
        } catch (retryErr) {
          console.error('[poll_generations] auto-retry failed for', c.id, retryErr.message);
          await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: `timeout + retry failed: ${retryErr.message}` } }).eq('id', c.id);
          failed++;
        }
      } else {
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: `timeout after ${Math.round((Date.now() - submittedAt) / 1000)}s (retries exhausted)` } }).eq('id', c.id);
        failed++;
        console.warn('[poll_generations] hard timeout for', c.id, 'retries exhausted');
      }
      continue;
    }

    try {
      checked++;
      const result = await checkFalJob(pollBase, c.hf_job_id);
      if (result.status === 'completed' && result.url) {
        // Flip status=pending with the fal.ai URL IMMEDIATELY so the UI shows
        // the finished image without waiting for Supabase Storage upload.
        const path = c.storage_path || `creatives/poll_${c.id}_${Date.now()}.png`;
        await supabase.from('creatives').update({ status: 'pending', file_url: result.url, storage_path: path }).eq('id', c.id);
        completed++;

        // Background: download from fal.ai (temporary URL, ~1h TTL) and promote to permanent Storage URL.
        // Fire-and-forget — don't block the poll response.
        (async () => {
          try {
            const imgResp = await fetch(result.url);
            if (!imgResp.ok) throw new Error(`download ${imgResp.status}`);
            const buf = Buffer.from(await imgResp.arrayBuffer());
            const { error: uploadErr } = await supabase.storage.from('creatives').upload(path, buf, { contentType: 'image/png', upsert: true });
            if (uploadErr) throw new Error(`storage upload: ${uploadErr.message}`);
            const { data: pub } = supabase.storage.from('creatives').getPublicUrl(path);
            if (pub?.publicUrl) {
              await supabase.from('creatives').update({ file_url: pub.publicUrl }).eq('id', c.id);
            }
          } catch (bgErr) {
            console.error('[poll_generations] background storage upload failed for', c.id, bgErr.message);
            // Don't flip to failed — creative still shows via fal.ai URL for ~1h. User can regenerate if it expires.
          }
        })();
      } else if (result.status === 'failed') {
        if (retryCount < 1 && meta.model && meta.poll_base) {
          try {
            const retryJob = await submitFalJob({ model: meta.model, prompt: meta.retry_prompt || c.hook_used || '', imageUrl: [], aspectRatio: '1:1' });
            await supabase.from('creatives').update({
              hf_job_id: retryJob.requestId,
              metadata: { ...meta, poll_base: retryJob.pollBase || meta.poll_base, submitted_at: new Date().toISOString(), retry_count: retryCount + 1, prev_error: result.error },
            }).eq('id', c.id);
            console.log('[poll_generations] auto-retry after fal failure for', c.id);
            continue;
          } catch (retryErr) {
            console.error('[poll_generations] retry after fal failure failed for', c.id, retryErr.message);
          }
        }
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: result.error } }).eq('id', c.id);
        failed++;
      }
      // pending → leave as generating, next poll catches it
    } catch (err) {
      console.error('[poll_generations] check failed for', c.id, err.message);
    }
  }

  console.log(`[poll_generations] checked=${checked} completed=${completed} failed=${failed}`);
  return res.status(200).json({ checked, completed, failed });
}

// POST: cleanup_stale
export async function cleanup_stale(req, res) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2);

  const { data: stale } = await supabase
    .from('creatives')
    .select('id, storage_path, format, file_url')
    .eq('status', 'pending')
    .lt('created_at', cutoff.toISOString());

  let deleted = 0;
  for (const creative of stale || []) {
    // Safety: don't delete image if a video depends on it
    if (creative.format === 'image') {
      const { count } = await supabase
        .from('creatives')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'pending')
        .filter('metadata->>source_creative_id', 'eq', creative.id);
      if (count > 0) continue;
    }

    if (creative.storage_path) {
      await supabase.storage.from('creatives').remove([creative.storage_path]);
    }
    await supabase.from('creatives').delete().eq('id', creative.id);
    deleted++;
  }

  await supabase.from('pipeline_log').insert({
    agent: 'CLEANUP', level: 'info',
    message: `Cleaned ${deleted} stale pending creatives (older than 2 days)`,
  });

  return res.status(200).json({ deleted, total_checked: stale?.length || 0 });
}

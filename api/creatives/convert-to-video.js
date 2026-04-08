import { createClient } from '@supabase/supabase-js';
import { withAuth } from '../../lib/auth.js';
import { rateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POLL_INTERVAL = 2000;
const MAX_POLL_TIME = 55000;

async function pollUntilDone(requestId) {
  const creds = process.env.HF_CREDENTIALS;
  const headers = { 'Authorization': `Key ${creds}`, 'User-Agent': 'higgsfield-server-js/2.0' };
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_TIME) {
    const res = await fetch(`https://platform.higgsfield.ai/requests/${requestId}/status`, { headers });
    const data = await res.json();
    if (data.status === 'completed') return data.video?.url || data.images?.[0]?.url;
    if (data.status === 'failed' || data.status === 'nsfw') return null;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  return null;
}

async function submitVideoJob(prompt, imageUrl) {
  const { higgsfield } = await import('@higgsfield/client/v2');
  const jobSet = await higgsfield.subscribe('/v1/image2video/dop', {
    input: {
      model: 'dop-turbo',
      prompt,
      input_images: [{ type: 'image_url', image_url: imageUrl }],
    },
    withPolling: false,
  });
  return jobSet.id;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit('convert-to-video', 10, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { creative_id } = req.body;
  if (!creative_id) {
    return res.status(400).json({ error: 'creative_id is required' });
  }

  try {
    const { data: source, error: sErr } = await supabase
      .from('creatives')
      .select('*')
      .eq('id', creative_id)
      .single();

    if (sErr || !source) {
      return res.status(404).json({ error: 'Source creative not found' });
    }
    if (source.format !== 'image') {
      return res.status(400).json({ error: 'Source creative must be an image' });
    }

    const { data: product } = await supabase
      .from('products')
      .select('handle, title')
      .eq('id', source.product_id)
      .single();

    const handle = product?.handle || 'unknown';
    const prompt = source.hook_used || source.headline || `Fashion ad video for ${product?.title || 'product'}`;

    const requestId = await submitVideoJob(prompt, source.file_url);
    if (!requestId) throw new Error('No request ID from Higgsfield');

    const videoUrl = await pollUntilDone(requestId);
    if (!videoUrl) throw new Error('Video generation timed out');

    const storagePath = `creatives/${handle}_${source.style || 'ad_creative'}_video_${Date.now()}.mp4`;
    let fileUrl = videoUrl;
    try {
      const resp = await fetch(videoUrl);
      const buf = await resp.arrayBuffer();
      await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });
      const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
      fileUrl = pub.publicUrl;
    } catch (storageErr) {
      console.error('[convert-to-video] Storage upload failed:', storageErr);
    }

    const creativeRecord = {
      product_id: source.product_id,
      variant_index: source.variant_index,
      format: 'video',
      file_url: fileUrl,
      storage_path: storagePath,
      hook_used: source.hook_used,
      headline: source.headline,
      hf_job_id: requestId,
      status: 'pending',
      style: source.style,
      store_id: source.store_id || null,
      metadata: JSON.stringify({
        source_creative_id: creative_id,
        source_image_url: source.file_url,
      }),
    };

    console.log('[convert-to-video] Inserting:', JSON.stringify({ product_id: source.product_id, store_id: source.store_id, format: 'video' }));

    const { data: creative, error: cErr } = await supabase.from('creatives').insert(creativeRecord).select().single();

    if (cErr) {
      console.error('[convert-to-video] DB insert error:', cErr);
      throw cErr;
    }

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info', store_id: source.store_id || null,
      message: `Generated video from image for ${product?.title || 'product'}`,
    });

    return res.status(200).json({ creative_id: creative.id, format: 'video', source_creative_id: creative_id });
  } catch (err) {
    console.error('[convert-to-video] Error:', err);
    const hint = err.message.includes('timeout') ? 'Video generation took too long. Try again.'
      : err.message.includes('credits') ? 'Not enough Higgsfield credits.'
      : err.message.includes('null value') ? 'Store context missing. Try refreshing.'
      : 'Video conversion failed. Try again.';
    return res.status(500).json({ error: 'Video conversion failed', details: err.message, hint });
  }
}

export default withAuth(handler);

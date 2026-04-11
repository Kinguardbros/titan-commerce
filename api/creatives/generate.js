import { createClient } from '@supabase/supabase-js';
import { buildStyledPrompt, generateFluxKontext } from '../../lib/higgsfield.js';
import { generateFal } from '../../lib/fal.js';
import { withAuth } from '../../lib/auth.js';
import { rateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POLL_INTERVAL = 2000;
const MAX_POLL_TIME = 55000; // Under Vercel 60s limit

async function pollUntilDone(requestId) {
  const creds = process.env.HF_CREDENTIALS;
  const headers = { 'Authorization': `Key ${creds}`, 'User-Agent': 'higgsfield-server-js/2.0' };
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_TIME) {
    const res = await fetch(`https://platform.higgsfield.ai/requests/${requestId}/status`, { headers });
    const data = await res.json();
    if (data.status === 'completed') return data.images?.[0]?.url || data.video?.url;
    if (data.status === 'failed' || data.status === 'nsfw') return null;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  return null;
}

async function submitJob(prompt, imageUrls) {
  const { higgsfield } = await import('@higgsfield/client/v2');
  const input_images = imageUrls.map((url) => ({ type: 'image_url', image_url: url }));
  const jobSet = await higgsfield.subscribe('/v1/text2image/soul', {
    input: { params: { prompt, input_images, width_and_height: '1536x1536' } },
    withPolling: false,
  });
  return jobSet.id;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rateLimit('generate', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { product_id, store_id, style = 'ad_creative', ai_model = 'fal_nano_banana', custom_prompt = '', show_model = true, text_overlay = 'none', overlay_text = '', audience } = req.body;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  try {
    const { data: product, error: pErr } = await supabase.from('products').select('*').eq('id', product_id).single();
    if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

    // If store_id provided, load store for store-specific shopify_url
    let storeShopifyUrl = null;
    if (store_id) {
      const { data: store } = await supabase.from('stores').select('shopify_url').eq('id', store_id).single();
      if (store) storeShopifyUrl = store.shopify_url;
    }

    let images = JSON.parse(product.images || '[]');
    // If store has a different shopify_url, re-map image URLs if needed
    if (storeShopifyUrl && product.product_url && !product.product_url.includes(storeShopifyUrl)) {
      // Images come from Shopify CDN, so they should still work — no remapping needed
    }

    // Load feedback from approve/reject logs
    const { data: approveLogs } = await supabase
      .from('pipeline_log').select('metadata')
      .eq('agent', 'PUBLISHER').ilike('message', '%approved%')
      .order('created_at', { ascending: false }).limit(5);

    const { data: rejLogs } = await supabase
      .from('pipeline_log').select('metadata')
      .eq('agent', 'PUBLISHER').ilike('message', '%rejected%')
      .order('created_at', { ascending: false }).limit(5);

    let feedback = '';
    const approvals = (approveLogs || [])
      .map((l) => { try { return JSON.parse(l.metadata); } catch { return null; } })
      .filter((m) => m?.product_id === product_id);
    if (approvals.length > 0) {
      const details = approvals.map((a) => {
        let s = `"${a.hook_used}" (${a.style})`;
        if (a.comment) s += ` — client said: "${a.comment}"`;
        return s;
      });
      feedback += `\nLEARNING — Client APPROVED these: ${details.join('; ')}. Generate more like these.`;
    }
    const rejections = (rejLogs || [])
      .map((l) => { try { return JSON.parse(l.metadata); } catch { return null; } })
      .filter((m) => m?.product_id === product_id);
    if (rejections.length > 0) {
      const reasons = rejections.map((r) => {
        let s = `"${r.hook_used}" (${r.style})`;
        if (r.reason) s += ` — reason: "${r.reason}"`;
        return s;
      });
      feedback += `\nLEARNING — Client REJECTED these and explained why: ${reasons.join('; ')}. AVOID making the same mistakes.`;
    }

    // Auto-generate product skill from photos if it doesn't exist yet
    if (store_id && images.length > 0) {
      const productSlug = (product.handle || product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '');
      const { data: existingSkill } = await supabase.from('store_skills').select('id')
        .eq('store_id', store_id).eq('skill_type', `product-${productSlug}`).limit(1).single();

      if (!existingSkill) {
        try {
          console.log(`[generate] Auto-creating product skill for ${productSlug}`);
          const imgRes = await fetch(images[0]);
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const base64 = imgBuf.toString('base64');
          const ext = images[0].includes('.png') ? 'image/png' : 'image/jpeg';

          const Anthropic = (await import('@anthropic-ai/sdk')).default;
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const skillRes = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 2000,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: ext, data: base64 } },
              { type: 'text', text: `Analyze this product photo and extract detailed product knowledge.\n\nProduct: ${product.title}\nPrice: ${product.price || 'N/A'}\n\nReturn:\n## PRODUCT IDENTITY\n- Exact colors, patterns, textures\n- Cut/style details\n- Key design elements (ties, straps, panels)\n- Material appearance\n\n## UNIQUE FEATURES\n- What makes this product visually distinct\n- Special construction details\n\n## VISUAL REPRODUCTION RULES\n- Exact description to recreate this product in AI generation\n- "The product MUST have [detail]"\n\n## DO NOT\n- What would make the generated product look WRONG\n- Common AI mistakes for this product type\n\nBe extremely specific — this ensures AI-generated photos show THIS EXACT product.` },
            ] }],
          });

          await supabase.from('store_skills').insert({
            store_id, skill_type: `product-${productSlug}`, product_name: product.title,
            title: product.title, content: skillRes.content[0].text, source_count: 1,
          });
          console.log(`[generate] Product skill created for ${productSlug}`);
        } catch (skillErr) {
          console.error('[generate] Auto-skill creation failed (non-blocking):', skillErr.message);
        }
      }
    }

    const prompt = await buildStyledPrompt({
      product_name: product.title,
      price: product.price ? `$${product.price}` : '',
      style, custom_prompt, showModel: show_model, feedback,
      textOverlay: text_overlay, overlayText: overlay_text, audience,
      storeId: store_id,
    });

    // Debug: log prompt to verify skills are loaded
    console.log('[generate] Prompt length:', prompt.length, 'Contains NO BRANDING:', prompt.includes('NO BRANDING'), 'Contains STRICT:', prompt.includes('STRICT'), 'Contains text-free:', prompt.includes('text-free'));

    // Route by selected AI model
    let imageUrl;
    let requestId = null;
    const productDesc = (product.description || '').replace(/<[^>]*>/g, '').slice(0, 300);

    // Map ai_model key → fal.ai model path
    const FAL_MODEL_MAP = {
      fal_flux2_edit:       'fal-ai/flux-2/edit',
      fal_flux2_pro_edit:   'fal-ai/flux-2-pro/edit',
      fal_ideogram_bg:      'fal-ai/ideogram/v3/replace-background',
      fal_ideogram_edit:    'fal-ai/ideogram/v3/edit',
      fal_flux_kontext:     'fal-ai/flux-pro/kontext',
      fal_nano_banana:      'fal-ai/nano-banana-2/edit',
    };

    const falModel = FAL_MODEL_MAP[ai_model];

    if (falModel) {
      // All fal.ai models
      const maxRef = falModel.includes('ideogram') ? 1 : falModel.includes('flux-2') ? 5 : 3;
      const refImages = images.slice(0, maxRef);
      console.log(`[generate] Using fal.ai ${falModel}, ref images: ${refImages.length}`);

      const falPrompt = refImages.length > 0
        ? `CRITICAL: KEEP THE EXACT SAME PRODUCT from the reference image(s). Same design, same pattern, same colors, same cut, same details. Do NOT create a different product. Place THIS EXACT product in the scene.\n\n${prompt}`
        : prompt;

      const result = await generateFal({
        model: falModel,
        prompt: falPrompt,
        imageUrl: refImages,
      });
      imageUrl = result.url;
      requestId = result.requestId;
    } else if (ai_model === 'flux_kontext') {
      // Legacy: Higgsfield Flux Kontext Max
      const fluxPrompt = `PRODUCT: ${product.title}${product.price ? ` ($${product.price})` : ''}${productDesc ? `\nProduct details: ${productDesc}` : ''}\n\n${prompt}`;
      console.log('[generate] Using Higgsfield Flux Kontext Max');
      try {
        const result = await generateFluxKontext({ prompt: fluxPrompt, aspectRatio: '1:1' });
        imageUrl = result.url;
        requestId = result.jobId;
      } catch (fluxErr) {
        console.error('[generate] Flux failed, falling back to fal.ai:', fluxErr.message);
        const result = await generateFal({ model: 'fal-ai/flux-2/edit', prompt, imageUrl: images.slice(0, 5) });
        imageUrl = result.url;
        requestId = result.requestId;
      }
    } else {
      // Legacy: Higgsfield Soul / Soul Reference
      const refImages = images.slice(0, ai_model === 'soul_ref' ? 5 : 3);
      console.log(`[generate] Using Higgsfield ${ai_model === 'soul_ref' ? 'Soul Reference' : 'Soul'}, ref images:`, refImages.length);
      try {
        requestId = await submitJob(prompt, refImages);
      } catch (submitErr) {
        console.error('[generate] Soul failed:', submitErr.message);
        throw new Error(`Higgsfield submit failed: ${submitErr.message}`);
      }
      if (!requestId) throw new Error('No request ID from Higgsfield');
      imageUrl = await pollUntilDone(requestId);
    }

    if (!imageUrl) throw new Error('Generation failed — no image URL');

    // Upload to storage
    const storagePath = `creatives/${product.handle}_${style}_${Date.now()}.png`;
    let fileUrl = imageUrl;
    try {
      const imgResp = await fetch(imageUrl);
      const buf = await imgResp.arrayBuffer();
      await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'image/png', upsert: true });
      const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
      fileUrl = pub.publicUrl;
    } catch (storageErr) {
      console.error('[generate] Storage upload failed:', storageErr);
    }

    // Use store_id from request, or fall back to product's store_id
    const effectiveStoreId = store_id || product.store_id || null;

    // Save creative
    const creativeRecord = {
      product_id, variant_index: 1, format: 'image',
      file_url: fileUrl, storage_path: storagePath,
      hook_used: custom_prompt || style, headline: product.title,
      hf_job_id: requestId, status: 'pending', style,
      store_id: effectiveStoreId,
    };

    console.log('[generate] Inserting creative:', JSON.stringify({ product_id, store_id: effectiveStoreId, style, file_url: fileUrl?.slice(0, 60) }));

    const { data: creative, error: cErr } = await supabase.from('creatives').insert(creativeRecord).select().single();

    if (cErr) {
      console.error('[generate] DB insert error:', cErr);
      throw cErr;
    }

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info', store_id: effectiveStoreId,
      message: `Generated ${style} creative for ${product.title}`,
    });

    return res.status(200).json({ creative_id: creative.id, file_url: fileUrl, generated: 1 });
  } catch (err) {
    console.error('[generate] Error:', err);
    const hint = err.message.includes('timeout') ? 'Image generation took too long. Try again.'
      : err.message.includes('credits') ? 'Not enough Higgsfield credits.'
      : err.message.includes('store_id') || err.message.includes('null value') ? 'Store context missing. Try refreshing the page.'
      : 'Something went wrong. Try again.';
    return res.status(500).json({ error: 'Generation failed', details: err.message, hint });
  }
}

export default withAuth(handler);

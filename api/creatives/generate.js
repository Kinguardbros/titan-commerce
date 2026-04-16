import { createClient } from '@supabase/supabase-js';
import { buildStyledPrompt, generateFluxKontext, generateImage } from '../../lib/higgsfield.js';
import { submitFalJob } from '../../lib/fal.js';
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

  if (!await rateLimit('generate', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  let { product_id, store_id, style, ai_model, custom_prompt, show_model, text_overlay, overlay_text, audience, aspect_ratio, story_id, story_shot, reference_url } = req.body;
  style = style || 'ad_creative'; ai_model = ai_model || 'fal_nano_banana'; custom_prompt = custom_prompt || ''; show_model = show_model !== false; text_overlay = text_overlay || 'none'; overlay_text = overlay_text || ''; aspect_ratio = aspect_ratio || '1:1';

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  // Auto-inject persona reference if audience selected and no explicit reference
  if (audience && !reference_url && store_id) {
    try {
      const { data: avatar } = await supabase.from('persona_avatars')
        .select('reference_url')
        .eq('store_id', store_id).eq('persona_name', audience)
        .not('reference_url', 'is', null)
        .single();
      if (avatar?.reference_url) {
        reference_url = avatar.reference_url;
        console.log(`[generate] Auto-injected persona avatar for "${audience}": ${reference_url.slice(0, 80)}`);
      } else {
        console.log(`[generate] No avatar reference found for persona "${audience}"`);
      }
    } catch (e) {
      console.log(`[generate] Avatar lookup failed for "${audience}":`, e.message);
    }
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
    if (reference_url) {
      images = [reference_url, ...images];
    }
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
      .map((l) => { try { return JSON.parse(l.metadata); } catch (e) { console.warn('[Generate] Metadata parse failed:', { error: e.message }); return null; } })
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
      .map((l) => { try { return JSON.parse(l.metadata); } catch (e) { console.warn('[Generate] Metadata parse failed:', { error: e.message }); return null; } })
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
    const hasAgeOverride = prompt.includes('CRITICAL AGE OVERRIDE');
    const hasTargetPersona = prompt.includes('TARGET PERSONA');
    const ageMatch = prompt.match(/Age:\s*(\d+)\s*years old/);
    console.log('[generate] Prompt length:', prompt.length, 'has AGE_OVERRIDE:', hasAgeOverride, 'has PERSONA:', hasTargetPersona, 'age found:', ageMatch?.[1] || 'none', 'audience:', audience || 'none');
    if (audience && !hasAgeOverride) {
      console.error('[generate] WARN: audience set but no AGE OVERRIDE in prompt — first 800 chars:', prompt.slice(0, 800));
    }

    // Amplify persona age: inject a short, aggressive reminder at the END of the prompt
    // (AI models weigh last instructions more due to recency bias). This survives even
    // when the full AGE OVERRIDE block is buried under 10k+ chars of brand knowledge.
    let ageReminder = '';
    if (ageMatch?.[1]) {
      const age = parseInt(ageMatch[1], 10);
      const visual = age >= 55 ? 'grey/silver hair, deep crow\'s feet, mature softening jawline, visibly older woman'
        : age >= 45 ? 'visible fine lines, some grey hair, mature skin with natural texture, clearly NOT a 20-something'
        : age >= 38 ? 'adult woman, fine lines around eyes, mature facial structure — clearly NOT a young 20s model'
        : `${age}-year-old natural features`;
      ageReminder = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nFINAL AGE ENFORCEMENT — READ THIS LAST:\nThe model MUST be ${age} years old. NOT younger. Visual requirements: ${visual}. If the generated woman looks under ${Math.max(age - 5, 30)}, the image is WRONG. Generate an older woman.\n━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    // Route by selected AI model
    let imageUrl = null;             // set only for synchronous paths (HF Soul / Flux Kontext)
    let requestId = null;            // fal.ai request_id or HF job_id
    let pollBase = null;             // fal.ai poll base (null for HF)
    let falModelUsed = null;         // full fal model path (for poll worker fallback)
    const productDesc = (product.description || '').replace(/<[^>]*>/g, '').slice(0, 300);

    // Map ai_model key → fal.ai model path (only for models NOT available on Higgsfield directly)
    const FAL_MODEL_MAP = {
      fal_flux2_edit:       'fal-ai/flux-2/edit',
      fal_flux2_pro_edit:   'fal-ai/flux-2-pro/edit',
      fal_ideogram_bg:      'fal-ai/ideogram/v3/replace-background',
      fal_ideogram_edit:    'fal-ai/ideogram/v3/edit',
      fal_flux_kontext:     'fal-ai/flux-pro/kontext',
    };

    const falModel = FAL_MODEL_MAP[ai_model];

    if (ai_model === 'fal_nano_banana' || ai_model === 'fal_nano_banana_pro') {
      const bananaModel = ai_model === 'fal_nano_banana_pro' ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-2/edit';
      // Smart routing: reference → fal.ai Nano Banana 2 (fire-and-forget)
      //                 no reference → HF Flux Kontext Max (synchronous, text-to-image)
      if (reference_url || images.length > 0) {
        // With persona avatar: 1 avatar + up to 2 product images.
        // AI now gets explicit role labels so it doesn't average faces.
        const refImages = reference_url ? [reference_url, ...images.slice(0, 2)] : images.slice(0, 3);
        console.log(`[generate] Submitting fal.ai Nano Banana (has reference), ref images: ${refImages.length}, has persona: ${!!reference_url}`);
        const colorMatch = (custom_prompt || '').match(/Product color:\s*([^.]+)\./i);
        const colorOverride = colorMatch
          ? `\n\nCRITICAL COLOR OVERRIDE: The final product MUST be rendered in ${colorMatch[1].trim()} color. The reference image shows a different color variant — IGNORE the reference color and recolor the entire product to ${colorMatch[1].trim()}. Keep the design, pattern, cut, and details identical to the reference, but the product color MUST be ${colorMatch[1].trim()}.`
          : '';
        // Identity-locked prompt when persona avatar is present
        const productRefRange = refImages.length > 2 ? '2-' + refImages.length : '2';
        const identityLock = reference_url
          ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nREFERENCE IMAGE ROLES — READ CAREFULLY:\n- Image 1 (FIRST reference): THE MODEL/PERSON — use this woman's EXACT face, hair, skin tone, body shape, and identity. The woman in the final image MUST be this exact person.\n- Image ${productRefRange} (remaining references): THE PRODUCT — these show the SAME product garment from different angles. Use these to learn the product's exact design, fabric, colors, cut, stitching, patterns, and every detail. Do NOT invent a new product. Do NOT copy the face, hair, or body of any model shown in product images — only the garment.\n\nTASK: Dress the woman from image 1 in the exact product shown across images ${productRefRange}. Same woman (image 1) + same product (images ${productRefRange}) = final photograph.\n\nIDENTITY LOCK: If the product reference images show a different-looking woman, IGNORE her face and body entirely. Keep ONLY image 1's identity.\nPRODUCT LOCK: The product must match images ${productRefRange} exactly — same pattern, same colors, same cut. Do NOT invent a new design.\n━━━━━━━━━━━━━━━━━━━━━━━━`
          : '';
        const productInstr = reference_url
          ? `Dress the woman from reference image 1 in the exact product shown in reference images ${productRefRange}.`
          : `CRITICAL: KEEP THE EXACT SAME PRODUCT from the reference image(s). Same design, same pattern, same cut, same details. Do NOT create a different product. Place THIS EXACT product in the scene.`;
        const falPrompt = `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}`;
        falModelUsed = bananaModel;
        const job = await submitFalJob({ model: falModelUsed, prompt: falPrompt, imageUrl: refImages, aspectRatio: aspect_ratio });
        requestId = job.requestId;
        pollBase = job.pollBase;
        if (job.completed && job.url) imageUrl = job.url;  // some models return sync
      } else {
        console.log(`[generate] Using Higgsfield Flux Kontext Max (no reference)`);
        try {
          const result = await generateFluxKontext({ prompt, aspectRatio: aspect_ratio });
          imageUrl = result.url;
          requestId = result.jobId;
        } catch (hfErr) {
          console.error('[generate] HF Flux Kontext failed, falling back to fal.ai:', hfErr.message);
          falModelUsed = 'fal-ai/flux-pro/kontext';
          const job = await submitFalJob({ model: falModelUsed, prompt, aspectRatio: aspect_ratio });
          requestId = job.requestId;
          pollBase = job.pollBase;
          if (job.completed && job.url) imageUrl = job.url;
        }
      }
    } else if (falModel) {
      // fal.ai models (Flux, Ideogram — not available on Higgsfield) → fire-and-forget
      const maxRef = falModel.includes('ideogram') ? 1 : falModel.includes('flux-2') ? 4 : 3;
      const refImages = images.slice(0, maxRef);
      console.log(`[generate] Submitting fal.ai ${falModel}, ref images: ${refImages.length}`);

      const colorMatch2 = (custom_prompt || '').match(/Product color:\s*([^.]+)\./i);
      const colorOverride2 = colorMatch2
        ? `\n\nCRITICAL COLOR OVERRIDE: The final product MUST be rendered in ${colorMatch2[1].trim()} color. The reference image shows a different color variant — IGNORE the reference color and recolor the entire product to ${colorMatch2[1].trim()}. Keep the design, pattern, cut, and details identical, but the product color MUST be ${colorMatch2[1].trim()}.`
        : '';
      const falPrompt = refImages.length > 0
        ? `CRITICAL: KEEP THE EXACT SAME PRODUCT from the reference image(s). Same design, same pattern, same cut, same details. Do NOT create a different product. Place THIS EXACT product in the scene.${colorOverride2}\n\n${prompt}${ageReminder}`
        : `${prompt}${ageReminder}`;

      falModelUsed = falModel;
      const job = await submitFalJob({ model: falModelUsed, prompt: falPrompt, imageUrl: refImages, aspectRatio: aspect_ratio });
      requestId = job.requestId;
      pollBase = job.pollBase;
      if (job.completed && job.url) imageUrl = job.url;
    } else if (ai_model === 'flux_kontext') {
      // Legacy: Higgsfield Flux Kontext Max (synchronous)
      const fluxPrompt = `PRODUCT: ${product.title}${product.price ? ` ($${product.price})` : ''}${productDesc ? `\nProduct details: ${productDesc}` : ''}\n\n${prompt}`;
      console.log('[generate] Using Higgsfield Flux Kontext Max');
      try {
        const result = await generateFluxKontext({ prompt: fluxPrompt, aspectRatio: '1:1' });
        imageUrl = result.url;
        requestId = result.jobId;
      } catch (fluxErr) {
        console.error('[generate] Flux failed, falling back to fal.ai:', fluxErr.message);
        falModelUsed = 'fal-ai/flux-2/edit';
        const job = await submitFalJob({ model: falModelUsed, prompt, imageUrl: images.slice(0, 5) });
        requestId = job.requestId;
        pollBase = job.pollBase;
        if (job.completed && job.url) imageUrl = job.url;
      }
    } else {
      // Legacy: Higgsfield Soul / Soul Reference (still synchronous — Higgsfield polls fast)
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

    // Use store_id from request, or fall back to product's store_id
    const effectiveStoreId = store_id || product.store_id || null;
    const storagePath = `creatives/${product.handle}_${style}_${Date.now()}.png`;

    // Decide: did we already get an image URL (synchronous path), or is it queued for polling?
    const isPending = !imageUrl && !!pollBase;

    const creativeRecord = {
      product_id, variant_index: 1, format: 'image',
      file_url: imageUrl || null, storage_path: storagePath,
      hook_used: custom_prompt || style, headline: product.title,
      hf_job_id: requestId,
      status: isPending ? 'generating' : 'pending',
      style,
      store_id: effectiveStoreId, aspect_ratio,
      metadata: isPending ? { poll_base: pollBase, model: falModelUsed, submitted_at: new Date().toISOString() } : null,
      ...(story_id && { story_id }),
      ...(story_shot && { story_shot }),
    };

    console.log('[generate] Inserting creative:', JSON.stringify({ product_id, store_id: effectiveStoreId, style, status: creativeRecord.status, file_url: imageUrl?.slice(0, 60) }));

    const { data: creative, error: cErr } = await supabase.from('creatives').insert(creativeRecord).select().single();

    if (cErr) {
      console.error('[generate] DB insert error:', cErr);
      throw cErr;
    }

    // For synchronous paths, upload to Supabase Storage in background (don't block response)
    if (imageUrl) {
      (async () => {
        try {
          const imgResp = await fetch(imageUrl);
          const buf = await imgResp.arrayBuffer();
          await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'image/png', upsert: true });
          const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
          await supabase.from('creatives').update({ file_url: pub.publicUrl }).eq('id', creative.id);
        } catch (storageErr) {
          console.error('[generate] Background storage upload failed:', storageErr.message);
        }
      })();
    }

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info', store_id: effectiveStoreId,
      message: isPending ? `Queued ${style} generation for ${product.title}` : `Generated ${style} creative for ${product.title}`,
    });

    return res.status(200).json({
      creative_id: creative.id,
      file_url: imageUrl || null,
      status: creativeRecord.status,
      generated: isPending ? 0 : 1,
    });
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

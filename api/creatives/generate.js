import { createClient } from '@supabase/supabase-js';
import { buildStyledPrompt, generateFluxKontext, generateImage } from '../../lib/higgsfield.js';
import { submitFalJob } from '../../lib/fal.js';
import { withAuth } from '../../lib/auth.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { cropAvatarForFraming } from '../../lib/avatar-crop.js';

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

  let { product_id, store_id, style, ai_model, custom_prompt, show_model, text_overlay, overlay_text, audience, aspect_ratio, resolution, story_id, story_shot, reference_url } = req.body;
  style = style || 'ad_creative'; ai_model = ai_model || 'fal_nano_banana'; custom_prompt = custom_prompt || ''; show_model = show_model !== false; text_overlay = text_overlay || 'none'; overlay_text = overlay_text || ''; aspect_ratio = aspect_ratio || '1:1';
  // Nano Banana output resolution — only the nano-banana models honor it
  resolution = ['1K', '2K', '4K'].includes(resolution) ? resolution : '2K';

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  // Auto-inject persona reference if audience selected and no explicit reference
  // Skip for realistic_beach — standalone style, no avatar injection
  if (audience && !reference_url && store_id && style !== 'realistic_beach') {
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

    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
    // Product Catalog framing → crop key for the avatar reference (full body → null = no crop)
    const catalogFramingLabel = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/)?.[1]?.trim();
    const catalogFramingKey = isProductCatalog
      ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || null)
      : null;
    if (isProductCatalog) {
      console.log('[generate][DIAG] productCatalog: style=%s, catalogFramingLabel=%j, catalogFramingKey=%j, custom_prompt(first 300)=%j',
        style, catalogFramingLabel, catalogFramingKey, (custom_prompt || '').slice(0, 300));
    }
    // Auto-detect tummy-control / high-waist swimwear from the product title (waist sits above the navel)
    const titleLower = (product.title || '').toLowerCase();
    const isHighWaistTummy = /tummy.control|high.waist|high.waisted|ruched.sculpting|tankini/i.test(titleLower);

    let images = JSON.parse(product.images || '[]');
    // For audience flows AND standalone styles (product_catalog, realistic_beach):
    // strip out previously-pushed AI creatives so we only feed the model ORIGINAL product
    // photos. Pushed creatives are uploaded with deterministic filenames containing the style
    // tag (_product_photo_beach_, _realistic_beach_, _product_catalog_, etc.) — when one
    // landed on position 0 in Shopify (e.g. it became the featured image), Nano Banana would
    // copy its lighting/composition into the new output, undoing any prompt instructions.
    // Fix at the source: filter them out before slicing.
    if (audience || isProductCatalog || isRealisticBeach) {
      const AI_FILENAME = /_(product_photo_beach|realistic_beach|product_catalog|ad_creative|lifestyle|review_ugc|product_shot|beach_photo|static_clean|static_split|static_urgency|cs_[a-z0-9_-]+)_\d/i;
      const originals = images.filter((u) => !AI_FILENAME.test(u));
      // Fall back to the original list if a product happens to have only AI images (shouldn't
      // happen for current data, but keep generation working rather than send empty refs).
      if (originals.length > 0) images = originals;
      if (images.length > 2) images = images.slice(0, 2);
    }
    // Prepend reference_url to product images ONLY for non-audience flows (color variant, etc.).
    // For audience/persona flows, the avatar reference is added separately in the Nano Banana
    // routing below — prepending here would duplicate it in refImages.
    if (reference_url && !audience) {
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
        // Fire-and-forget: don't block the generation response (Claude Vision takes 5-15s)
        const skillStoreId = store_id;
        const skillTitle = product.title;
        const skillImage = images[0];
        const skillPrice = product.price;
        (async () => {
          try {
            console.log(`[generate] Auto-creating product skill for ${productSlug} (background)`);
            const imgRes = await fetch(skillImage);
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const base64 = imgBuf.toString('base64');
            const ext = skillImage.includes('.png') ? 'image/png' : 'image/jpeg';

            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const skillRes = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514', max_tokens: 2000,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: ext, data: base64 } },
                { type: 'text', text: `Analyze this product photo and extract detailed product knowledge.\n\nProduct: ${skillTitle}\nPrice: ${skillPrice || 'N/A'}\n\nReturn:\n## PRODUCT IDENTITY\n- Exact colors, patterns, textures\n- Cut/style details\n- Key design elements (ties, straps, panels)\n- Material appearance\n\n## UNIQUE FEATURES\n- What makes this product visually distinct\n- Special construction details\n\n## VISUAL REPRODUCTION RULES\n- Exact description to recreate this product in AI generation\n- "The product MUST have [detail]"\n\n## DO NOT\n- What would make the generated product look WRONG\n- Common AI mistakes for this product type\n\nBe extremely specific — this ensures AI-generated photos show THIS EXACT product.` },
              ] }],
            });

            await supabase.from('store_skills').insert({
              store_id: skillStoreId, skill_type: `product-${productSlug}`, product_name: skillTitle,
              title: skillTitle, content: skillRes.content[0].text, source_count: 1,
            });
            console.log(`[generate] Product skill created for ${productSlug}`);
          } catch (skillErr) {
            console.error('[generate] Auto-skill creation failed:', skillErr.message);
          }
        })();
      }
    }

    // Realistic Beach — standalone style that bypasses all audience/age/tummy/skill systems.
    // Pure prompt from product reference images + hardcoded body/environment description.
    let prompt;
    if (isProductCatalog) {
      // Parse catalog config from custom_prompt (model desc, pose, framing)
      const catalogCustom = custom_prompt ? custom_prompt.replace(/\[catalog_[^\]]+\]/g, '').trim() : '';
      // Extract model description (everything before POSE:)
      const modelDescMatch = catalogCustom.match(/^([\s\S]*?)(?=POSE:|$)/);
      const modelDesc = modelDescMatch ? modelDescMatch[1].trim() : 'Mid-size woman, US size 12-14, natural soft body with visible curves, late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no tattoos.';
      // Extract pose + framing (everything from POSE: onwards)
      const poseAndFraming = catalogCustom.includes('POSE:') ? catalogCustom.slice(catalogCustom.indexOf('POSE:')) : 'POSE: Standing facing camera, weight on right hip, arms relaxed, warm genuine smile.';
      // Extract framing reminder for end of prompt (recency bias)
      // Extract full framing text (all sentences after FRAMING:)
      const framingSection = poseAndFraming.match(/FRAMING:\s*([\s\S]*?)$/);
      const framingText = framingSection ? framingSection[1].trim() : '';
      const isThreeQuarter = framingText.includes('mid-calf') || framingText.includes('Do NOT show feet');
      const isWaistUp = framingText.includes('waist/hip level') || framingText.includes('Upper body portrait');
      const isDetailCrop = framingText.includes('chest to upper thigh') || framingText.includes('No face visible');
      const isNonFullFraming = isThreeQuarter || isWaistUp || isDetailCrop;
      // Dedicated, bordered FRAMING block — the avatar reference may show the full body, so the
      // crop must be stated forcefully (the edit model otherwise reproduces the reference framing).
      const framingBlock = isNonFullFraming
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== FRAMING / CROP — THIS IS NOT OPTIONAL ===\nThe model reference image is already cropped to roughly this framing — keep that framing in the final image, do NOT zoom out, do NOT add her lower body back in. ${framingText} ${isThreeQuarter ? 'The BOTTOM EDGE of the final photo is at her mid-calf / just below the knee. Her feet are NOT in the photo. Her ankles are NOT in the photo. There is NO sand at her feet because her feet are below the frame. If you can see her feet or ankles, the crop is WRONG — crop tighter.' : isWaistUp ? 'The BOTTOM EDGE of the final photo is at her hip/waist. Her legs are NOT in the photo. If you can see her knees or feet, the crop is WRONG — crop tighter.' : 'This is a tight crop on the garment midsection ONLY — her head is NOT in the photo, her legs below the upper thigh are NOT in the photo. If you can see her face or her knees, the crop is WRONG — crop tighter.'}\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      const framingNegative = isThreeQuarter ? ', full body shot, visible feet, visible ankles, full legs below the calf'
        : isWaistUp ? ', full body, full legs, visible knees, visible feet, visible ankles'
        : isDetailCrop ? ', full body, head visible, face visible, full legs, visible feet'
        : '';

      // When a persona avatar is the reference, the model comes FROM that image (sandwich:
      // image 1 + last image). Otherwise the model is generated from the modelDesc text and
      // the reference is garment-only.
      const catalogReferenceRules = reference_url
        ? `Reference image roles: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).`
        : `The attached reference image shows the SWIMSUIT/GARMENT ONLY — use it solely to copy the garment (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage). If a person appears in the reference, COMPLETELY IGNORE that person — do not copy her face, hair, body, age, or skin tone. The woman in the final image is a NEW model described below, not the person in the reference.`;
      const catalogModelLine = reference_url
        ? `Professional e-commerce swimwear product photography. THE MODEL — use the woman shown in reference image 1 AND the last reference image (the SAME woman, twice): her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography. THE MODEL — generate exactly this woman: ${modelDesc}`;
      const catalogFinalCheck = reference_url
        ? `FINAL CHECK — READ LAST: The model in this image MUST be the exact woman from reference image 1 / the last reference image. If she looks like a different person, the result is WRONG.`
        : `FINAL CHECK — READ LAST: The model in this image MUST be the exact woman described above ("${modelDesc.slice(0, 80)}..."). If the generated woman looks like a person from the reference image instead of the described model, the result is WRONG — generate the described woman.`;
      const catalogNegativePrefix = reference_url ? '' : "copying the reference model's face, copying the reference person's identity, ";

      prompt = `${catalogReferenceRules}

Recreate the swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage.

${catalogModelLine}

She is barefoot on a real beach, standing on sand. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves, wet and dry sand, and a CLEAN bright LIGHT-BLUE sky with only a few small wispy high clouds — but NO visible sun, no sunbeam, no glare. A calm, clear, bright beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a beach: you can see the sea, the sand, the clean blue sky.

━━━━━━━━━━━━━━━━━━━━━━━━
=== LIGHTING — READ CAREFULLY, DO NOT SKIP THIS ===
SKY: a CLEAN bright light-blue sky with only a few small wispy high clouds. No visible sun disc, no sunbeam, no glare. NOT a heavy grey overcast, but also NOT a hard sunny day with a blazing sun casting shadows.

LIGHT ON THE MODEL: even though the sky is clear and blue, the SUN ITSELF is NOT in frame and is veiled by a high thin haze — so the light falling on the model is FLAT, SOFT, and comes EVENLY from a broad bright sky, like a giant softbox. There is NO single hard light source pointed at her. Therefore there are NO directional cast shadows — no shadow stretching off to one side, no dark side of the body, no hard shadow on the sand, no shadow under the bust, no shadow on either leg. Bright but soft, like a professional shoot done outdoors under a huge diffuser.

EXPOSURE: the MODEL and SWIMSUIT are BRIGHT — high-key, airy, well-lit, never dim, never dark, never moody. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette. The BACKGROUND is also properly exposed — visible sea, sand, and a clean light-blue sky — NOT blown out to pure white, NOT a foggy haze.

THE GARMENT: the SWIMSUIT is the hero of this photo and must be evenly, fully, brightly lit — every part clearly visible and crisply readable: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO shadows on the swimsuit. If any part of the garment sinks into shadow, OR a directional shadow appears on the body / sand, OR the background is a featureless white blur or a gloomy dark grey, the result is WRONG — clean light-blue sky (no visible sun), flat even soft light on the model, real beach visible behind.
━━━━━━━━━━━━━━━━━━━━━━━━

Product: ${product.title}

${poseAndFraming}

Garment: Fabric smooth, zero bunching. Match reference exactly.${isHighWaistTummy ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button (the navel is several centimetres BELOW the top edge of the fabric, fully buried under it). The belly button is COMPLETELY, ENTIRELY covered — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If ANY part of the belly button or navel area is visible, the garment is WRONG — raise the waistline higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

FACE QUALITY (critical):
- Sharp detailed facial features — visible skin pores, natural skin texture on face, individual eyebrow hairs
- Eyes must have realistic catchlight reflections, visible iris detail, individual eyelashes
- Natural lip texture, not glossy or plastic
- Face must be the sharpest, most detailed element in the image — tack sharp focus on the eyes
- Realistic facial proportions, no uncanny valley, no doll-like smoothing
- If the face looks AI-generated, blurry, or plastic — the image is WRONG

Hyperrealistic, photographic, editorial swimwear catalog quality, shot on 85mm lens at f/2.8, Canon R5 look, true-to-life skin and fabric texture. 8K resolution, ultra-sharp. ${aspect_ratio || '4:5'} format.

LIGHTING — READ THIS: a clean bright light-blue sky with just a few wispy high clouds — but NO visible sun disc, NO sunbeam. The sun stays behind a high thin haze, so the light on the model is flat, soft and even — like a giant softbox. NO directional cast shadows anywhere (not on the body, not on the sand, not on the garment). Bright high-key exposure. NOT a hard cloudless sunny day with a blazing sun, NOT golden hour, NOT moody, NOT a heavy grey overcast. The swimsuit is evenly and brightly lit, every detail readable, black fabric shows texture (not crushed black).
${framingBlock}

${catalogFinalCheck}

NEGATIVE: ${catalogNegativePrefix}${isHighWaistTummy ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, gap above the waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : ''}blown-out white background, featureless white background, empty white background, foggy haze, missing background, studio backdrop, no beach visible, overexposed background, white void behind the model, heavy grey overcast, gloomy dark sky, direct hard sunlight, blazing visible sun, harsh sunbeam, cloudless hard sunny day, directional shadow, hard cast shadow, side lighting, side-angle sun, golden hour, sunset, sunrise, low-angle sun, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, dark areas on the garment, swimsuit lost in shadow, underlit swimsuit, crushed blacks, garment crushed to pure black, dramatic lighting, moody lighting, dim, dark photo, underexposed, heavy orange filter, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, text, watermarks${framingNegative}.`.trim();
    } else if (isRealisticBeach) {
      prompt = `Use the attached image as the style and quality reference. Generate a new image matching this exact level of realism, lighting, and photographic quality.

Full body portrait of a naturally beautiful woman, early-to-mid 40s, warm approachable face with visible smile lines around the eyes, soft defined cheekbones, natural brows, sun-kissed skin with visible freckles and real skin texture. Shoulder-length wavy hair with natural highlights, slightly tousled, effortlessly undone.

Body type: real, curvy, feminine, US size 14-16. Visibly soft rounded belly that is naturally prominent, wider hips with natural fullness, full bust, thick thighs that touch. Arms with natural softness, not toned. This is NOT a slim woman, NOT an athletic body, NOT a model body. Think: a real 42-year-old mother of two who enjoys life and doesn't work out daily. Her body carries weight in the midsection, hips, and thighs naturally. Visible skin texture on arms, subtle stretch marks on hips and lower belly, natural cellulite on upper thighs and backs of arms. Soft fleshy upper arms. Zero airbrushing, zero slimming, zero body manipulation.

Expression is warm, self-assured, quietly confident. Soft genuine smile, relaxed eye contact with camera. Energy: the woman your customer wants to see herself as.

Wearing the EXACT swimsuit shown in the attached image. Recreate the swimsuit precisely as it appears: same colors, same pattern, same construction details, same trim, same fit. Swimsuit sitting smoothly on the body, waistband flat with zero rolling, fabric hugging without squeezing, shaping the midsection naturally. The swimsuit should look like it's doing its job: smoothing and supporting the belly area while the model's natural curves are still clearly visible underneath.

Product: ${product.title}

Recreate a beach environment. Sandy beach, ocean in background, bright afternoon daylight. LIGHTING: Sun high in the sky, bright natural daylight. Sun is BEHIND the camera, illuminating the model FROM THE FRONT. The product and model's face are fully lit, bright, high-key, and clearly visible — NOT backlit, NOT silhouetted, NOT dark. No golden hour, no warm orange tones, no sunset — clean bright daylight.

Full body shot, head to just above the knees visible, model standing centered with slight natural weight shift to right hip creating a soft S-curve. One hand relaxed at side, the other lightly touching hair or resting on hip.

Match photographic quality: Ultra high resolution, 8K detail. FACE: tack sharp focus on eyes, visible skin pores on face, realistic catchlight in eyes, individual eyelashes, natural lip texture — face must be the sharpest most detailed element. Skin texture: visible pores, natural sun freckles, real skin. Fabric texture: individual thread weave visible. Hair: individual strands visible, natural beach wave texture. Depth of field: model tack sharp, background in gentle soft bokeh. Lighting: bright natural afternoon daylight from front — product fully illuminated, high-key, zero backlighting, no golden hour warmth.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}

NEGATIVE: No plastic skin, no porcelain smoothing, no fitness model body, no slim body, no flat stomach, no toned arms, no thigh gap, no exaggerated curves, no sexual posing, no duck face, no visible logos or text, no watermarks, no oversaturated colors, no glossy wet-look skin, no extra fingers, no distorted hands, no skinny model, no athletic build.`.trim();
    } else {
      prompt = await buildStyledPrompt({
        product_name: product.title,
        price: product.price ? `$${product.price}` : '',
        style, custom_prompt, showModel: show_model, feedback,
        textOverlay: text_overlay, overlayText: overlay_text, audience,
        storeId: store_id,
      });
    }

    // Tummy-control coverage for the non-standalone styles. Product Catalog handles it inside
    // its own prompt block above (isHighWaistTummy); realistic_beach handles everything internally.
    const isTummyControl = !isRealisticBeach && !isProductCatalog && isHighWaistTummy;
    let coverageReminder = '';
    if (isTummyControl && show_model) {
      const coverageInstr = `\n\nCRITICAL PRODUCT COVERAGE RULES — THIS SWIMSUIT IS TUMMY CONTROL:\n` +
        `- The swimsuit MUST cover the ENTIRE midsection from hip bones to under the bust\n` +
        `- The belly button MUST NOT be visible — it is fully covered by the fabric\n` +
        `- High-waist cut sits ABOVE the navel, hugging and smoothing the tummy area\n` +
        `- The model has a CURVY lower body (wider hips, fuller thighs) with a SOFT midsection — the swimsuit flatters and smooths, NOT reveals\n` +
        `- The ruched/gathered fabric creates a slimming effect on the stomach\n` +
        `- Do NOT show any bare midriff or exposed belly — the product's selling point is full tummy coverage\n` +
        `- The model should look comfortable and confident — the swimsuit makes her feel secure, not exposed`;
      prompt += coverageInstr;
      coverageReminder = `\n\nFINAL CHECK: The belly button is NOT visible. The swimsuit covers the entire midsection.`;
    }

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
        // With persona avatar: sandwich pattern — avatar FIRST + product images + avatar LAST
        // This doubles the identity signal so AI doesn't lose the face among headless crop product shots.
        const productImages = images.slice(0, 2);
        // Product Catalog with a non-full framing: crop the (full-body) avatar reference to that
        // framing before sending — the edit model copies the reference composition, so a
        // 3/4-cropped reference produces a 3/4-cropped output (prompt alone can't override it).
        let avatarRef = reference_url;
        console.log('[generate][DIAG] avatar crop check: isProductCatalog=%s, reference_url=%j, catalogFramingKey=%j', isProductCatalog, reference_url ? reference_url.slice(0, 80) : null, catalogFramingKey);
        if (isProductCatalog && reference_url && catalogFramingKey) {
          const cropped = await cropAvatarForFraming(reference_url, catalogFramingKey);
          if (cropped) avatarRef = cropped;
          console.log(`[generate][DIAG] Cropped avatar to "${catalogFramingKey}": ${!!cropped}${cropped ? ' → ' + cropped.slice(0, 90) : ''}`);
        }
        // Product Catalog: with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                  without an avatar     → 1 product image only (packshot/flat-lay,
        //                                          not a model shot), model comes from the prompt's modelDesc
        const refImages = isProductCatalog
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
        console.log(`[generate] Submitting fal.ai Nano Banana (has reference), ref images: ${refImages.length}, has persona: ${!!reference_url}, productCatalog: ${isProductCatalog}`);
        const colorMatch = (custom_prompt || '').match(/Product color:\s*([^.]+)\./i);
        const colorOverride = colorMatch
          ? `\n\nCRITICAL COLOR OVERRIDE: The final product MUST be rendered in ${colorMatch[1].trim()} color. The reference image shows a different color variant — IGNORE the reference color and recolor the entire product to ${colorMatch[1].trim()}. Keep the design, pattern, cut, and details identical to the reference, but the product color MUST be ${colorMatch[1].trim()}.`
          : '';
        // Identity-locked prompt when persona avatar is present
        const productRefRange = refImages.length > 2 ? '2-' + refImages.length : '2';
        const identityLock = reference_url
          ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nREFERENCE IMAGE ROLES — READ CAREFULLY:\n- Image 1 AND the LAST image: THE MODEL/PERSON — this is the SAME woman shown twice. Use her EXACT face, hair, skin tone, body shape, and identity. The woman in the final image MUST be this exact person. Her face is the ONLY face to use.\n- Middle images (${productRefRange}): THE PRODUCT — these are cropped product shots (may not show a face or full body). Use ONLY the garment/swimsuit from these images. Study the product details: exact color ratios, exact stripe widths, exact trim sizes, exact waistband height, exact neckline shape.\n\nTASK: Put the woman from image 1 into the exact product from the middle images. Her face + their garment = final photograph.\n\nIDENTITY LOCK: The generated woman's face MUST match image 1 exactly. Product images may show cropped bodies without heads — do NOT let them influence the face. The face comes ONLY from image 1.\nPRODUCT LOCK — PROPORTION-ACCURATE:\n- The garment color ratio must EXACTLY match the reference\n- Every stripe, band, and trim must be the EXACT same width\n- Waistband height, neckline depth, and strap width must match precisely\n- Do NOT enlarge, shrink, simplify, or reinterpret ANY design element\n━━━━━━━━━━━━━━━━━━━━━━━━`
          : '';
        const productInstr = reference_url
          ? `Dress the woman from reference image 1 in the exact product shown in reference images ${productRefRange}.`
          : `PRODUCT REPRODUCTION — PIXEL-ACCURATE:\nThe garment in the final image must be an EXACT visual copy of the reference image(s). Match PRECISELY: exact color ratio and placement, exact width of every stripe/trim/band/border, exact neckline shape and depth, exact waistband height and style, exact stitching pattern, exact strap width. Do NOT "improve", simplify, or reinterpret the design. Copy it exactly as shown in the reference.`;
        const productCheck = isProductCatalog ? '' : `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nFINAL PRODUCT CHECK: The garment proportions (color ratios, stripe widths, trim sizes, waistband height) must EXACTLY match the product reference images. If any detail looks different from the reference — it is WRONG. The product must be a faithful reproduction, not an interpretation.\n━━━━━━━━━━━━━━━━━━━━━━━━`;
        const falPrompt = isProductCatalog
          ? prompt  // Product Catalog prompt is self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
        if (isProductCatalog) {
          console.log('[generate][DIAG] falPrompt has FRAMING block: %s | refImages count: %d | aspect_ratio: %s | resolution: %s',
            falPrompt.includes('FRAMING / CROP'), refImages.length, aspect_ratio, resolution);
        }
        // Product Catalog: 1 product reference image (packshot/flat-lay, not a model shot).
        // The model is generated from the prompt's description, not copied from the reference.
        falModelUsed = bananaModel;
        const job = await submitFalJob({ model: falModelUsed, prompt: falPrompt, imageUrl: refImages, aspectRatio: aspect_ratio, resolution });
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
        ? `CRITICAL: KEEP THE EXACT SAME PRODUCT from the reference image(s). Same design, same pattern, same cut, same details. Do NOT create a different product. Place THIS EXACT product in the scene.${colorOverride2}\n\n${prompt}${ageReminder}${coverageReminder}`
        : `${prompt}${ageReminder}${coverageReminder}`;

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

    // Parse UI settings from custom_prompt for display in Generation Config
    const poseMatch = (custom_prompt || '').match(/Model pose:\s*([^.]+)\./);
    const bodyMatch = (custom_prompt || '').match(/Model body type:\s*([^.]+)\./);
    const framingMatch = (custom_prompt || '').match(/Framing:\s*([^.]+)\./);
    const sceneMatch = (custom_prompt || '').match(/Scene:\s*([^.]+)\./);
    const colorVariant = (custom_prompt || '').match(/Product color:\s*([^.]+)\./);
    const negMatch = (custom_prompt || '').match(/Negative:\s*(.+)/);
    // Catalog-specific tags
    const catalogModelMatch = (custom_prompt || '').match(/\[catalog_model:([^\]]+)\]/);
    const catalogPoseMatch = (custom_prompt || '').match(/\[catalog_pose:([^\]]+)\]/);
    const catalogFramingMatch = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/);


    const MODEL_LABELS = {
      fal_nano_banana: 'Nano Banana 2', fal_nano_banana_pro: 'Nano Banana Pro',
      fal_flux2_edit: 'FLUX.2 Edit', fal_flux2_pro_edit: 'FLUX.2 Pro Edit',
      fal_ideogram_bg: 'Ideogram BG', fal_ideogram_edit: 'Ideogram Edit',
      fal_flux_kontext: 'FLUX Kontext Pro', flux_kontext: 'Flux Kontext Max',
    };

    const configMeta = {
      model: falModelUsed || MODEL_LABELS[ai_model] || ai_model,
      provider: falModelUsed ? 'fal.ai' : 'Higgsfield',
      ...(falModelUsed && falModelUsed.includes('nano-banana') && { resolution }),
      ...(catalogModelMatch && { catalog_model: catalogModelMatch[1].trim() }),
      ...(catalogPoseMatch && { pose: catalogPoseMatch[1].trim() }),
      ...(catalogFramingMatch && { framing: catalogFramingMatch[1].trim() }),
      ...(!catalogPoseMatch && poseMatch && { pose: poseMatch[1].trim() }),
      ...(bodyMatch && { body_type: bodyMatch[1].trim() }),
      ...(!catalogFramingMatch && framingMatch && { framing: framingMatch[1].trim() }),
      ...(sceneMatch && { scene: sceneMatch[1].trim() }),
      ...(colorVariant && { color: colorVariant[1].trim() }),
      ...(negMatch && { negative_prompt: negMatch[1].trim() }),
      ...(audience && { audience }),
      subject: show_model ? 'On model' : 'Product only',
      submitted_at: new Date().toISOString(),
      ...(isPending && { poll_base: pollBase }),
    };

    const creativeRecord = {
      product_id, variant_index: 1, format: 'image',
      file_url: imageUrl || null, storage_path: storagePath,
      hook_used: custom_prompt || style, headline: product.title,
      hf_job_id: requestId,
      status: isPending ? 'generating' : 'pending',
      style, show_model,
      store_id: effectiveStoreId, aspect_ratio,
      metadata: configMeta,
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

    // Auto-resolve matching proposals when a creative is generated
    // e.g. beach photo proposal gets resolved when a beach photo is generated for the same product
    const STYLE_TO_PROPOSAL_TYPE = {
      'product_photo_beach': 'generate_beach_photo',
    };
    const matchingProposalType = STYLE_TO_PROPOSAL_TYPE[style];
    if (matchingProposalType && product_id) {
      const { error: resolveErr, count: resolveCount } = await supabase.from('proposals')
        .update({ status: 'executed' })
        .eq('product_id', product_id).eq('type', matchingProposalType).eq('status', 'pending');
      if (resolveErr) console.error(`[generate] Failed to resolve ${matchingProposalType} proposal:`, resolveErr.message);
      else console.log(`[generate] Auto-resolved ${matchingProposalType} proposal for ${product.title} (matched: ${resolveCount ?? '?'})`);
    }

    await supabase.from('pipeline_log').insert({
      agent: 'FORGE', level: 'info', store_id: effectiveStoreId,
      message: isPending ? `Queued ${style} generation for ${product.title}` : `Generated ${style} creative for ${product.title}`,
      metadata: { product_id, creative_id: creative.id, style },
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

import { createClient } from '@supabase/supabase-js';
import { buildStyledPrompt, generateFluxKontext, generateImage } from '../../lib/higgsfield.js';
import { submitFalJob } from '../../lib/fal.js';
import { V4_PROMPT_BODY } from '../../lib/v4-prompt.js';
import { V5_PROMPT_BODY } from '../../lib/v5-prompt.js';
import { V6_PROMPT_BODY } from '../../lib/v6-prompt.js';
import { V7_PROMPT_BODY } from '../../lib/v7-prompt.js';
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

  let { product_id, store_id, style, ai_model, custom_prompt, show_model, text_overlay, overlay_text, audience, aspect_ratio, resolution, story_id, story_shot, reference_url, product_color } = req.body;
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

    // If store_id provided, load store for store-specific shopify_url + name (Isola = all tummy-control)
    let storeShopifyUrl = null;
    let isIsola = false;
    if (store_id) {
      const { data: store } = await supabase.from('stores').select('shopify_url, name').eq('id', store_id).single();
      if (store) {
        storeShopifyUrl = store.shopify_url;
        isIsola = (store.name || '').toLowerCase().includes('isola');
      }
    }

    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
    const isProductCatalogV2 = style === 'product_catalog_v2';
    const isProductCatalogV3 = style === 'product_catalog_v3';
    const isProductCatalogV4 = style === 'product_catalog_v4';
    const isProductCatalogV5 = style === 'product_catalog_v5';
    const isProductCatalogV6 = style === 'product_catalog_v6';
    const isProductCatalogV7 = style === 'product_catalog_v7';
    // Beach scene key — used by v3 (selects the master beach prompt for step 2 Ideogram bg replace).
    // 'sunny' is the default. v1 doesn't read this — its scene is hardcoded.
    const v3BeachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
    // Product Catalog framing → crop key for the avatar reference (full body → null = no crop)
    const catalogFramingLabel = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/)?.[1]?.trim();
    const catalogFramingKey = isProductCatalog
      ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || 'three-quarter')
      : null;
    // Auto-detect tummy-control / high-waist swimwear from the product title (waist sits above the navel)
    const titleLower = (product.title || '').toLowerCase();
    const isHighWaistTummy = /tummy.?control|high.?wais?t|high.?rise|high.?cut|ruched|shirr|sculpt|shaping|control.?brief|retro.?(high|wais?t)|vintage.?(high|wais?t)|tankini/i.test(titleLower);

    // Auto-detect product type from title — drives swimwear-specific instructions vs garment-neutral.
    // Product catalog v4-v7 prompts contain "swimsuit/bikini/waistband" language by default.
    // For NON-swim products (dresses, skirts, cover-ups, tops), inject a GARMENT TYPE OVERRIDE
    // that tells the model "this is a [dress/skirt/top/etc] — render exactly as in reference,
    // ignore swimwear-specific instructions in the prompt."
    const productTypeLower = (product.product_type || '').toLowerCase();
    const productTagsLower = Array.isArray(product.tags) ? product.tags.join(' ').toLowerCase() : (typeof product.tags === 'string' ? product.tags.toLowerCase() : '');
    const productSearchText = `${titleLower} ${productTypeLower} ${productTagsLower}`;
    const isSwimwearProduct = /swim|bikini|one.?piece|tankini|swimsuit|monokini|bandeau|swim.?wear|trikini/i.test(productSearchText);
    const isDressProduct = /\bdress\b|\bgown\b|kaftan|kimono(?!.bikini)|sundress|maxi.?dress|midi.?dress|mini.?dress/i.test(productSearchText);
    const isSkirtProduct = !isDressProduct && /\bskirt\b|\bsarong\b|wrap.?skirt|swim.?skirt|skort/i.test(productSearchText);
    const isCoverUpProduct = /cover.?up|beach.?wrap|beach.?shirt|beach.?dress|kaftan|tunic|robe|kimono/i.test(productSearchText);
    const isTopProduct = !isSwimwearProduct && !isDressProduct && /\btop\b|\bblouse\b|\bshirt\b|\btee\b|tank.?top|crop.?top/i.test(productSearchText);
    const isPantsProduct = /\bpants\b|\bshorts\b|\bjeans\b|trousers|leggings/i.test(productSearchText);
    const isBraProduct = /\bbra\b|bralette|bandeau(?!.swim)/i.test(productSearchText);
    // Determine descriptor for prompt injection. Default = "swimsuit" (legacy behavior).
    const garmentDescriptor = isDressProduct ? 'dress'
      : isCoverUpProduct ? 'beach cover-up'
      : isSkirtProduct ? 'skirt'
      : isTopProduct ? 'top'
      : isPantsProduct ? 'pants'
      : isBraProduct ? 'bra'
      : 'swimsuit';
    const isNonSwimGarment = !isSwimwearProduct && garmentDescriptor !== 'swimsuit';

    // HIGH-WAIST navel-hide block applies ONLY to swimwear (one-pieces, high-waist bikinis, tummy-control).
    // Previously: any Isola product → always inject. NEW: must also be swimwear product (avoid injecting
    // "high-waist tummy-control" instructions on dresses, cover-ups, etc).
    const catalogHighWaist = (((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) && isIsola) || isHighWaistTummy) && !isNonSwimGarment;

    let images = JSON.parse(product.images || '[]');
    // For audience flows AND standalone styles (product_catalog, realistic_beach):
    // strip out previously-pushed AI creatives so we only feed the model ORIGINAL product
    // photos. Pushed creatives are uploaded with deterministic filenames containing the style
    // tag (_product_photo_beach_, _realistic_beach_, _product_catalog_, etc.) — when one
    // landed on position 0 in Shopify (e.g. it became the featured image), Nano Banana would
    // copy its lighting/composition into the new output, undoing any prompt instructions.
    // Fix at the source: filter them out before slicing.
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) {
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
      // v1 always uses 3/4 framing (post-process crops the finished image). When the frontend stops
      // sending [catalog_framing:...] and there's no FRAMING: text, force isThreeQuarter so the
      // framingBlock reminder still gets included in the prompt.
      const isThreeQuarter = framingText.includes('mid-calf') || framingText.includes('Do NOT show feet') || !framingText;
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

She is barefoot on a real beach, standing on sand on a bright sunny day. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves on one side, soft dry sand with a few dune grasses / beach grass, a low dune line, and a bright BLUE sky with a few scattered soft white clouds and light haze near the horizon. A clear, warm, sunny beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real beach: you can see the sea, the waves, the sand, the dune grass, the blue sky with clouds.

━━━━━━━━━━━━━━━━━━━━━━━━
=== LIGHTING — READ CAREFULLY, DO NOT SKIP THIS ===
SKY: a bright clear BLUE sky with a few real, soft, white clouds and light haze near the horizon. NOT a flat cloudless sky, NOT a heavy grey overcast.

LIGHT ON THE MODEL: natural daylight coming FROM THE FRONT (the sun is behind the camera, not in frame). The model and the swimsuit are well-exposed and clearly readable — NOT dim, but also NOT overexposed, NOT blown out, NOT washed out: a natural, balanced, true-to-life exposure where you can see every detail. The light has a subtle warm quality (real midday-to-late-morning sun, slightly hazy). Only SOFT NATURAL shadows from that frontal direction — a gentle shadow under the chin, a soft shadow tucked behind an arm. There is NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow streaking across the sand. Frontal light — never side-lit, never harsh, never blown out.

EXPOSURE: the MODEL and SWIMSUIT are well-exposed — clearly readable, never dim, never dark, never moody, but ALSO never overexposed, never blown out, never washed out — a natural, balanced, true-to-life exposure. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette. The BACKGROUND is also properly exposed — visible sea, waves, sand, dune grass, and a blue sky with clouds, all holding full detail — NOT blown out to pure white, NOT vaporised, NOT a foggy haze.

THE GARMENT: the SWIMSUIT is the hero of this photo. It is lit by frontal daylight and is well-exposed and clearly readable — never dim, never grey-flat, but also never blown out: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband all crisply visible. Black fabric reads as a rich dark grey-black with all the ribbed / pleated texture catching the light — NOT crushed to a flat black silhouette, NOT a washed-out grey. Exposed neutrally — natural and true to life, the shadows on the fabric just gently filled so the deepest folds and the underside of the bust stay readable. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO hard shadows on the swimsuit. (This applies to the GARMENT and model — it does NOT change the scene: the sky stays a bright blue with soft clouds, the sun stays behind the camera, the background stays a properly-exposed real beach with full visible detail, not blown out to white.) If any part of the garment sinks into shadow, OR a hard directional / side-lit shadow appears on the body / garment / sand, OR the background / model / sand / sky is overexposed and washed out to white, OR the background is a gloomy dark grey, the result is WRONG.

GRADE: warm, clean, natural — sun-kissed skin and hair, true-to-life colors with full saturation and full tonal range. NOT a cool / grey / blue grade, NOT a heavy orange filter, NOT washed-out, NOT overexposed, NOT a bright hazy wash, NOT flat lifeless lighting.
━━━━━━━━━━━━━━━━━━━━━━━━

Product: ${product.title}

${poseAndFraming}

Garment: Fabric smooth, zero bunching. Match reference exactly.${catalogHighWaist ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

FACE QUALITY (critical):
- Sharp detailed facial features — visible skin pores, natural skin texture on face, individual eyebrow hairs
- Eyes must have realistic catchlight reflections, visible iris detail, individual eyelashes
- Natural lip texture, not glossy or plastic
- Face must be the sharpest, most detailed element in the image — tack sharp focus on the eyes
- Realistic facial proportions, no uncanny valley, no doll-like smoothing
- If the face looks AI-generated, blurry, or plastic — the image is WRONG

CAMERA: shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below looking up, NOT a worm's-eye view. The horizon line sits roughly at the model's chest. Her proportions are natural and undistorted — head, torso, and legs in correct proportion, no foreshortening.

Hyperrealistic, photographic, editorial swimwear catalog quality, shot on 85mm lens at f/2.8, Canon R5 look, true-to-life skin and fabric texture. 8K resolution, ultra-sharp. ${aspect_ratio || '4:5'} format.

LIGHTING — READ THIS: natural frontal daylight on the model and product (the sun is behind the camera) — well-exposed and clearly readable, a natural balanced true-to-life exposure, NOT dim and NOT overexposed / blown out / washed out. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon, background holds full visible detail (NOT blown out to white, sand and sky NOT vaporised). Warm, clean grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black.
${framingBlock}

${catalogFinalCheck}

NEGATIVE: ${catalogNegativePrefix}${catalogHighWaist ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, navel showing above the waistband, gap above the waistband, low-set waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : ''}blown-out white background, featureless white background, empty white background, foggy haze, missing background, studio backdrop, no beach visible, overexposed background, white void behind the model, heavy grey overcast, gloomy dark sky, directional shadow, hard cast shadow, side lighting, side-angle sun, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, dark areas on the garment, swimsuit lost in shadow, underlit swimsuit, crushed blacks, garment crushed to pure black, dramatic lighting, moody lighting, dim, dark photo, underexposed, heavy orange filter, washed-out colors, flat lifeless lighting, cool blue grade, overexposed, overexposed model, blown-out highlights, blown-out skin, blown-out sky, blown-out sand, washed-out face, washed-out background, bright hazy wash, vaporised background, white-washed scene, milky overexposure, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, low-angle shot, shot from below, worm's-eye view, upward camera angle, distorted perspective, foreshortened legs, text, watermarks${framingNegative}.`.trim();
    } else if (isProductCatalogV2) {
      // Golden-hour Product Catalog v2 — verbatim prompt. The MODEL comes from the persona avatar
      // when one is selected (reference_url set via the audience lookup above) → reference-roles
      // block + sandwich [avatar, product, avatar]. Otherwise (defensive — the UI requires an
      // avatar) fall back to the hardcoded mid-size model description. ${v2PoseText} from the Pose preset.
      const v2HasAvatar = !!reference_url;
      const v2Custom = (custom_prompt || '').replace(/\[catalog_[^\]]+\]/g, '').trim();
      const v2ModelDesc = (v2Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1] || '').trim()
        || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';
      const v2PoseText = v2Custom.includes('POSE:')
        ? v2Custom.slice(v2Custom.indexOf('POSE:')).trim()
        : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';
      const v2GarmentLine = v2HasAvatar
        ? `REFERENCE IMAGES — READ CAREFULLY: image 1 AND the last image = THE MODEL (the SAME woman, shown twice) — use her EXACT face, hair, skin tone, body shape, and age; she is the ONLY person, do not invent a different face. Any image in between = THE GARMENT — recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do NOT redesign, restyle, or reinterpret the swimsuit, and do NOT let the garment images influence the model's face.`
        : `Use the swimsuit shown in the attached image as the exact reference garment. Recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign, restyle, or reinterpret the swimsuit. The garment in the attached image is the product, replicate it exactly.`;
      const v2ModelLine = v2HasAvatar
        ? `Professional e-commerce swimwear product photography. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography. ${v2ModelDesc}`;
      prompt = `${v2GarmentLine}

${v2ModelLine}

She is barefoot on a quiet beach at golden hour, ocean and sky softly out of focus in the background.

LIGHTING (critical, do not alter):
- Warm directional golden-hour sunlight hitting the model from the front or front-three-quarter angle, illuminating her face, décolletage, and the front of the garment directly
- The model's skin and the garment must be the brightest, most exposed elements in the frame
- Background (ocean, sky, sand) is exposed approximately one stop darker than the model, slightly desaturated, slightly cooler in tone, so the subject pops forward
- No flat side-lighting, no overcast diffusion, no backlit silhouette
- Subtle warm rim light along her hair and shoulder for separation from background

COMPOSITION:
- Vertical 4:5 framing
- Full body or three-quarter body crop, model centered, framing emphasizes the torso and the garment construction
- Shallow depth of field, background softly out of focus
- Sharp focus on the garment fabric, fit, seaming, and texture
- Dry sand under her feet, clean uncluttered foreground

GARMENT RULES (non-negotiable):
- For one-piece swimsuits: full coverage from bust to upper hip, moderate leg opening (not high-cut), the suit covers the body as designed in the reference image
- For two-piece swimsuits: bikini bottoms must be high-waisted, sit well above the belly button, and fully cover the navel
- Bikini bottoms must have moderate leg opening, not high-cut, with full coverage across the hips and upper thighs
- Repeat: high-waisted bottoms, navel fully covered, moderate leg cut
- Garment fabric texture, color, and structural details must match the attached reference exactly

${v2PoseText}

Hyperrealistic, photographic, editorial swimwear catalog quality, shot on 85mm lens at f/2.8, Canon R5 look, true-to-life skin texture and fabric texture.`;
    } else if (isProductCatalogV3) {
      // Product Catalog v3 — STEP 1 of the double pipeline: a clean white-studio shot of the
      // model in the swimsuit with FLAT EVEN ALL-SIDES studio lighting (the controlled
      // environment is the whole point). poll_generations then fires step 2 (Ideogram BG) to
      // swap the studio background for a beach. Model comes from the persona avatar (sandwich).
      const v3HasAvatar = !!reference_url;
      const v3Custom = (custom_prompt || '').replace(/\[catalog_[^\]]+\]/g, '').trim();
      const v3PoseText = v3Custom.includes('POSE:')
        ? v3Custom.slice(v3Custom.indexOf('POSE:')).trim()
        : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';
      const v3ModelDesc = (v3Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1] || '').trim()
        || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';
      const v3ModelLine = v3HasAvatar
        ? `Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — generate exactly this woman: ${v3ModelDesc}`;
      const v3GarmentLine = v3HasAvatar
        ? `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, twice). Any image in between = THE GARMENT — recreate this swimsuit faithfully: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage; do NOT redesign or reinterpret it, and do NOT let the garment images influence the model's face.`
        : `Use the swimsuit shown in the attached image as the exact reference garment — recreate it faithfully: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign or reinterpret it.`;
      prompt = `${v3GarmentLine}

${v3ModelLine}

BACKGROUND: a CLEAN, SEAMLESS white-to-light-grey studio backdrop — NOTHING else: no props, no furniture, no floor line, no horizon, no shadows on the wall, no gradient, no colored background. Just a clean studio sweep behind her.

LIGHTING (this is the whole point — get it perfect): FLAT, EVEN, SOFT studio lighting — a big softbox on the model from the front plus fill light on BOTH sides, so the swimsuit is lit FULLY AND EVENLY FROM ALL SIDES. ZERO harsh shadows, ZERO side-lit shadow, ZERO directional shadow. Every part of the swimsuit is crisp and bright — fabric texture, color, pattern, ribbing/pleating, trims, stitching, seams, waistband all clearly readable. Black fabric reads as a clean dark grey-black with ALL the texture visible — NOT crushed to a flat black silhouette. Bright, clean, true-to-life exposure — NOT dim, NOT overexposed, NOT washed out. The model's skin is evenly lit, natural, true to life.

Product: ${product.title}

${v3PoseText}

GARMENT RULES (non-negotiable): for two-piece swimsuits the bikini bottoms must be high-waisted, sit well above the belly button, and fully cover the navel; moderate leg opening, not high-cut, full coverage across the hips and upper thighs. For one-piece swimsuits: full coverage from bust to upper hip, moderate leg opening.

FACE QUALITY (critical): sharp detailed features, visible skin pores, individual eyebrow hairs, realistic catchlight in the eyes, visible iris detail, individual eyelashes, natural lip texture. Face tack sharp, no AI smoothing, no uncanny valley, no doll-like skin. If the face looks AI-generated, blurry, or plastic — the image is WRONG.

CAMERA: shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below. Her proportions are natural and undistorted. Hyperrealistic, photographic, editorial swimwear catalog quality, 85mm lens at f/2.8, Canon R5 look, 8K, ultra-sharp. ${aspect_ratio || '4:5'} format.${catalogHighWaist ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

NEGATIVE: beach, ocean, sand, water, sky, outdoor, nature, sunset, golden hour, props, furniture, floor line, horizon line, gradient backdrop, colored background, dark background, shadow on the wall, harsh shadow, hard cast shadow, side lighting, directional shadow, dark side of the body, dim, dark photo, underexposed, overexposed, blown-out highlights, washed out, hazy bright wash, crushed blacks, garment crushed to pure black, deep shadows on the swimsuit, dark areas on the garment, ${catalogHighWaist ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, navel showing above the waistband, gap above the waistband, low-set waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : 'visible belly button, exposed navel, low-rise bottoms, mid-rise bottoms, '}plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, low-angle shot, shot from below, distorted perspective, text, watermarks.`.trim();
    } else if (isProductCatalogV4) {
      // Product Catalog v4 — verbatim user prompt (editorial strobe + on-location beach).
      // Backend only injects: (a) reference-roles prefix, (b) Product: <title>, and (c) a
      // conditional HIGH-WAIST navel-hide block when catalogHighWaist. The user's prompt body
      // (V4_PROMPT_BODY) is sent unchanged.
      const v4Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
      const v4HighWaistBlock = catalogHighWaist
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      prompt = `${v4Prefix}${V4_PROMPT_BODY}${v4HighWaistBlock}`;
    } else if (isProductCatalogV5) {
      // Product Catalog v5 — variant of v4 with warm post-sunset afterglow background.
      // Same wrapping pattern as v4: reference-roles prefix + Product: <title> + verbatim
      // V5_PROMPT_BODY + conditional HIGH-WAIST navel-hide block. Difference is only the
      // V5_PROMPT_BODY content (warm afterglow setting, neutral subject for product pop).
      const v5Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
      // FUTURE: backdrop color override (Backdrop color pill picker). Zakomentováno —
      // user místo toho chce PRODUCT color selector. Viz commit 25111a6.
      // const V5_BACKDROP_COLOR_LABELS = { peach: 'soft pale peach', rose: 'soft dusty rose', cream: 'warm cream', beige: 'soft beige', sage: 'light dusty sage green', lavender: 'soft pale lavender', taupe: 'warm taupe' };
      // const backdropColorLabel = V5_BACKDROP_COLOR_LABELS[v5_backdrop_color] || V5_BACKDROP_COLOR_LABELS.peach;
      // const v5BackdropOverride = `\n\nBACKDROP COLOR OVERRIDE (high priority): The post-sunset afterglow sky and ambient light read as ${backdropColorLabel} (a soft, gently desaturated, muted version of this color — NOT vibrant, NOT saturated). The sand reads as a muted neutral that complements the ${backdropColorLabel} sky. The product fabric color and the model's skin tone read TRUE TO LIFE — they are NOT cast or tinted by the ${backdropColorLabel} ambient light.\n`;
      const v5HighWaistBlock = catalogHighWaist
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      prompt = `${v5Prefix}${V5_PROMPT_BODY}${v5HighWaistBlock}`;
    } else if (isProductCatalogV6) {
      // Product Catalog v6 — variant of v5 with bright midday daylight + vivid background.
      // Same wrapping pattern as v4/v5: reference-roles prefix + Product: <title> + verbatim
      // V6_PROMPT_BODY + conditional HIGH-WAIST navel-hide block. Difference is only the
      // V6_PROMPT_BODY content (bright midday setting, vivid turquoise ocean, bright blue sky).
      const v6Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
      const v6HighWaistBlock = catalogHighWaist
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      prompt = `${v6Prefix}${V6_PROMPT_BODY}${v6HighWaistBlock}`;
    } else if (isProductCatalogV7) {
      // Product Catalog v7 — soft warm afterglow with balanced exposure (between v5 and v6).
      // Same wrapping pattern as v4/v5/v6: reference-roles prefix + Product: <title> + verbatim
      // V7_PROMPT_BODY + conditional HIGH-WAIST navel-hide block. Difference is V7_PROMPT_BODY
      // content (visible warm afterglow background, balanced exposure, natural soft lighting).
      const v7Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
      const v7HighWaistBlock = catalogHighWaist
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      prompt = `${v7Prefix}${V7_PROMPT_BODY}${v7HighWaistBlock}`;
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

    // Garment fidelity override — injected for ALL catalog styles (v1-v7). Two modes:
    // (1) NON-SWIM detected (dress/skirt/cover-up/top/etc): explicitly tell model to ignore
    //     swimwear language in the prompt and render the actual garment type from reference
    // (2) SWIM detected (default): reinforce that the EXACT garment from reference must be
    //     reproduced — covers cases where title says "Swim Set" but reference shows e.g. a maxi
    //     dress, OR where reference is a different cut than what default prompt assumes
    if ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7)) {
      // Garment-type-only hint, appended to the END of the prompt (recency bias keeps it
      // active without pulling framing/composition along with it). Deliberately SHORT and
      // narrowly scoped: do NOT say "render exactly", "same length", "same silhouette" —
      // those phrases pull the model into widening the frame to fit the whole garment.
      // The FRAMING and COMPOSITION rules from the main prompt body must remain authoritative.
      const garmentOverride = isNonSwimGarment
        ? `\n\nGARMENT TYPE NOTE: The product is a ${garmentDescriptor}. The neckline, sleeves/straps, and construction details come from the reference image. The FRAMING, CROP, COMPOSITION, model pose, and BACKGROUND remain exactly as specified above (do NOT widen the frame to fit the whole garment — the garment can extend beyond the crop). If the reference shows a long ${garmentDescriptor}, only the in-frame portion is rendered. Disregard generic "swimsuit" or "bikini" wording above when it conflicts with the actual garment type from the reference.`
        : `\n\nGARMENT NOTE: The garment construction details (neckline, straps, trim, fabric, pattern) come from the reference image. The FRAMING, CROP, COMPOSITION, model pose, and BACKGROUND remain exactly as specified above (do NOT widen the frame to fit the whole garment — the garment can extend beyond the crop).`;
      prompt = `${prompt}${garmentOverride}`;
    }

    // Product color override — injected for ALL catalog styles (v1-v5) when frontend sends
    // a specific color (Shopify variant). Sent verbatim to fal.ai. Realistic Beach and other
    // styles handle color through their own mechanisms (colorRef, customInstr colorPrefix).
    if ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) && product_color) {
      const colorGarmentLabel = garmentDescriptor === 'swimsuit' ? 'swimsuit / garment' : garmentDescriptor;
      const productColorOverride = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nPRODUCT COLOR OVERRIDE (high priority): The ${colorGarmentLabel} in this image is in ${product_color} color. This is the color of the FABRIC. Render the fabric in this exact ${product_color} color across the entire surface — uniform, true-to-life, instantly recognizable as ${product_color}. NOT muddy, NOT washed-out, NOT color-shifted by ambient lighting, NOT a different shade. If the product reference image shows a different color, IGNORE that color and use ${product_color} as specified here.\n━━━━━━━━━━━━━━━━━━━━━━━━`;
      prompt = `${prompt}${productColorOverride}`;
    }

    // Modesty guard — injected for ALL catalog styles when a model is shown. Nano Banana
    // occasionally renders visible nipple shapes through thin/lycra/jersey fabric, especially
    // on bust area in cold-shoulder / unlined / soft-cup styles. This block adds explicit
    // anti-nipple-visibility instruction. Positioned at END of prompt (after color override)
    // for maximum recency-bias weight.
    if ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) && show_model !== false) {
      const modestyGuard = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\nMODESTY GUARD (CRITICAL): The garment fabric across the bust area is COMPLETELY OPAQUE. The bust shape under the fabric is smooth and undefined — NO visible nipple shapes, NO visible nipple outlines, NO visible nipple protrusion, NO bumps or pointed shapes showing through the fabric. The bra cups / top fabric provide full coverage and full smoothing — the bust looks rounded and supported, with NO anatomical detail showing through. Fabric appears to have invisible internal padding or built-in lining. NO see-through fabric, NO sheer effect on the bust area, NO cold-effect, NO wet-look that reveals body contours underneath. The bust is shaped by the garment but anatomical features under the fabric are NOT visible.\n━━━━━━━━━━━━━━━━━━━━━━━━`;
      prompt = `${prompt}${modestyGuard}`;
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
    let retryPrompt = null;          // catalog flows: prompt to resubmit on poll-time failure
    let retryImageUrls = null;       // catalog flows: image refs to resubmit on poll-time failure
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
        // Note: for Product Catalog non-full framing we used to crop the avatar reference + match
        // the output aspect ratio, but Nano Banana edit ignores aspect_ratio when given reference
        // images and re-adds the lower body anyway. The reliable fix is to crop the FINISHED
        // output server-side (done in poll_generations using meta.framing_crop) — see below.
        const avatarRef = reference_url;
        // Product Catalog v2/v3 are self-contained; v3 is step 1 of the double pipeline.
        const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) ? '4:5' : aspect_ratio;
        // Product Catalog (v1, v2, v3): with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                               without an avatar     → 1 product image only (packshot/flat-lay,
        //                                                       not a model shot), model comes from the prompt
        const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7)
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
        const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7)
          ? prompt  // Product Catalog prompts are self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
        falModelUsed = bananaModel;
        // Capture retry context for poll_generations — catalog flows need to resubmit with sandwich + same prompt
        // when fal.ai returns "result fetch 422" (typically NSFW classifier on the result, retry on cheaper/looser model often passes)
        if (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7) {
          retryPrompt = falPrompt;
          retryImageUrls = refImages;
        }
        const job = await submitFalJob({ model: falModelUsed, prompt: falPrompt, imageUrl: refImages, aspectRatio: outAspectRatio, resolution });
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
      ...(catalogFramingKey && { framing_crop: catalogFramingKey }), // poll_generations crops the finished image to this
      ...(isProductCatalogV3 && { stage: 'studio', v3_beach_scene: v3BeachKey, v3_aspect: '4:5' }), // poll_generations fires step 2 (Ideogram bg replace)
      subject: show_model ? 'On model' : 'Product only',
      submitted_at: new Date().toISOString(),
      ...(isPending && { poll_base: pollBase }),
      ...(retryPrompt && { retry_prompt: retryPrompt }),
      ...(retryImageUrls && { retry_image_urls: retryImageUrls }),
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

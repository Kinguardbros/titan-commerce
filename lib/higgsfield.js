import { higgsfield } from '@higgsfield/client/v2';
import { createClient } from '@supabase/supabase-js';

const supabaseHF = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// HF_CREDENTIALS env is read automatically by the SDK (format: "key_id:key_secret")

const POLL_INTERVAL = 3000; // 3s between polls
const MAX_POLL_TIME = 300000; // 5 min timeout

/**
 * Poll a Higgsfield request until completed/failed.
 */
async function pollUntilDone(requestId) {
  const creds = process.env.HF_CREDENTIALS;
  const headers = {
    'Authorization': `Key ${creds}`,
    'User-Agent': 'higgsfield-server-js/2.0',
  };
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_TIME) {
    const res = await fetch(
      `https://platform.higgsfield.ai/requests/${requestId}/status`,
      { headers }
    );
    const data = await res.json();

    if (data.status === 'completed') {
      const imageUrl = data.images?.[0]?.url || data.video?.url;
      return { url: imageUrl, status: 'completed' };
    }
    if (data.status === 'failed') throw new Error('Higgsfield generation failed');
    if (data.status === 'nsfw') throw new Error('Content flagged as NSFW — credits refunded');

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error('Higgsfield polling timed out after 5 minutes');
}

/**
 * Generate an image using Nano Banana.
 * If imageUrls are provided, uses them as input_images (image-to-image).
 * Otherwise falls back to text-only generation.
 */
export async function generateImage({ prompt, imageUrls = [], aspectRatio = '1:1' }) {
  const input_images = imageUrls.map((url) => ({
    type: 'image_url',
    image_url: url,
  }));

  const jobSet = await higgsfield.subscribe('/v1/text2image/nano-banana', {
    input: {
      params: {
        prompt,
        input_images,
        aspect_ratio: aspectRatio,
      },
    },
    withPolling: false,
  });

  const requestId = jobSet.id;
  if (!requestId) throw new Error('No request ID returned from Higgsfield');

  const result = await pollUntilDone(requestId);
  return { url: result.url, jobId: requestId };
}

/**
 * Generate a video from an image using DOP Turbo (image-to-video).
 */
export async function generateVideo({ prompt, imageUrl }) {
  const jobSet = await higgsfield.subscribe('/v1/image2video/dop', {
    input: {
      model: 'dop-turbo',
      prompt,
      input_images: [{ type: 'image_url', image_url: imageUrl }],
    },
    withPolling: false,
  });

  const requestId = jobSet.id;
  if (!requestId) throw new Error('No request ID returned from Higgsfield');

  const result = await pollUntilDone(requestId);
  return { url: result.url, jobId: requestId };
}

/**
 * Build an ad creative prompt from brief data.
 * Detects Mathilda products and uses specialized prompt from skill.
 */
export function buildPrompt({ product_name, price, headline, hook }) {
  const isMathilda = product_name.toLowerCase().includes('mathilda');

  if (isMathilda) {
    return `Campaign-ready Meta ad creative for Elegance House — Mathilda pants.

Show: Woman age 40-55, normal/curvy body type (not model-thin), wearing
Mathilda figure-flattering straight-leg pants with subtle vertical pinstripes.
She looks like a real customer — confident, comfortable, elegant.

Product: ${product_name}
${price ? `Price: ${price}` : ''}
Headline: ${headline}
Hook: ${hook}

Use the provided product photo as the base reference. Keep the actual product
recognizable — the pants must match the real Mathilda pants (straight-leg,
high waist, pinstripe pattern, elegant drape).

Style: Warm, inviting studio lighting with gold (#d4a853) and cream (#f5f0e8)
tones. Professional but approachable. Natural pose — standing relaxed or walking.
Clean, bright background. No harsh shadows.

The model should represent the target customer: a woman "in the middle of life"
who is self-assured, stylish in an understated way, and radiates quiet confidence.
Not a fashion model — a real woman who looks great in these pants.

Output: 1080x1080 feed ad, photorealistic, no text overlay.`.trim();
  }

  // Default prompt for non-Mathilda products
  return `Campaign-ready Meta ad creative for elegant women's fashion e-commerce.

Product: ${product_name}
${price ? `Price: ${price}` : ''}
Headline: ${headline}
Hook: ${hook}

Use the provided product photo as reference. Keep the product recognizable.
Style: Cinematic lighting, warm gold tones (#d4a853), clean white/cream background.
Professional studio photography. Brand: Elegance House — sophisticated, timeless.
Output: 1080x1080 feed ad, no text overlay, photorealistic quality.`.trim();
}

/**
 * Build a style-specific prompt for the generation page.
 */
const STYLE_PROMPTS = {
  ad_creative: ({ product_name, price, custom_prompt }) =>
    `Campaign-ready Meta ad creative for Elegance House.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Keep the product recognizable.
Woman age 35-55, confident, elegant. Warm gold (#d4a853) and cream (#f5f0e8) tones.
Professional studio lighting, clean background. Natural relaxed pose.
1080x1080 feed ad, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  product_shot: ({ product_name, price, custom_prompt }) =>
    `Clean e-commerce product photography for Elegance House.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Show ONLY the product.
Pure white or very light cream background. No model, no props.
Professional studio lighting, soft shadows. Show fabric texture and details.
Multiple angles welcome. Sharp focus on product details (stitching, fabric, cut).
1080x1080, photorealistic, catalog-quality.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  lifestyle: ({ product_name, price, custom_prompt }) =>
    `Lifestyle fashion photography for Elegance House social media.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Keep the product recognizable.
Woman age 35-55 wearing the product in a real-life setting:
café, city street, office, garden, restaurant, or home interior.
Natural daylight, candid pose, warm and inviting mood.
She looks confident and relaxed — like a real moment, not a posed ad.
Warm tones, slight golden hour feeling. Elegant but approachable.
1080x1080, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  review_ugc: ({ product_name, price, custom_prompt }) =>
    `Casual smartphone photo of a real customer wearing this product at home.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. The product must be recognizable.

Woman age 35-60, looks like an everyday person — not a model.
She took this mirror selfie to show a friend what she's wearing today.
Natural, relaxed expression. Minimal or no makeup.

Setting: her bedroom or bathroom. The background is lived-in — not staged.
Smartphone camera quality. Natural indoor lighting.
The photo feels spontaneous and unplanned.

1080x1080, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  // === STATIC CREATIVE TEMPLATES (consistent across all products) ===

  static_clean: ({ product_name, price, custom_prompt }) =>
    `Minimalist e-commerce ad — clean and modern.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Keep the product recognizable.
Centered product on pure white background. Lots of negative space.
Woman age 35-55 wearing the product, standing straight, facing camera.
Simple, elegant, no distractions. Think Apple-style minimalism.
Soft even studio lighting, zero shadows. Muted warm tones.
This is a standardized template — every product should look identical in style.
1080x1080, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  static_split: ({ product_name, price, custom_prompt }) =>
    `Split-screen fashion ad — model on one side, product detail on the other.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Keep the product recognizable.
LEFT HALF: Woman age 35-55 wearing the product, full body, warm cream background.
RIGHT HALF: Close-up detail of the product — fabric texture, stitching, waistband.
Clean dividing line between the two halves. Consistent warm lighting across both.
Professional, editorial quality. Standardized layout for A/B testing.
1080x1080, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),

  static_urgency: ({ product_name, price, custom_prompt }) =>
    `High-converting sales ad with urgency feel.

Product: ${product_name}${price ? ` — ${price}` : ''}

Use the provided product photo as reference. Keep the product recognizable.
Woman age 35-55 wearing the product, confident pose, looking at camera.
Background: bold, warm gradient (deep gold to cream). Slightly dramatic lighting.
The composition should feel dynamic and attention-grabbing — like a flash sale ad.
Strong contrast, vivid but not garish. Energy and confidence.
This is a standardized template — same visual style for every product.
1080x1080, photorealistic, no text overlay.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}`.trim(),
};

export async function buildStyledPrompt({ product_name, price, style, custom_prompt = '', showModel = true, feedback = '', textOverlay = 'none', overlayText = '', storeId = null }) {
  // Load compiled skills, fall back to raw knowledge
  if (storeId) {
    try {
      const { data: skills } = await supabaseHF.from('store_skills').select('skill_type, content')
        .eq('store_id', storeId).in('skill_type', ['creative-direction', 'brand-voice', 'product-knowledge']);
      if (skills?.length) {
        const ctx = skills.map((s) => s.content).join('\n\n').slice(0, 2000);
        custom_prompt = (custom_prompt ? custom_prompt + '\n\n' : '') + 'BRAND KNOWLEDGE:\n' + ctx;
      } else {
        const { data } = await supabaseHF.from('store_knowledge').select('insights, category')
          .eq('store_id', storeId).order('processed_at', { ascending: false }).limit(10);
        if (data?.length) {
          const ctx = data.filter((k) => ['Audience', 'Brand', 'Creative'].includes(k.category))
            .map((k) => k.insights).join('\n').slice(0, 1500);
          if (ctx) custom_prompt = (custom_prompt ? custom_prompt + '\n\n' : '') + 'BRAND KNOWLEDGE:\n' + ctx;
        }
      }
    } catch (err) {
      console.error('[higgsfield] Failed to load store knowledge:', err.message);
    }
  }
  const isMathilda = product_name.toLowerCase().includes('mathilda');
  const isElara = product_name.toLowerCase().includes('elara');

  // Mathilda specialized prompt
  if (isMathilda && style === 'ad_creative' && showModel && textOverlay === 'none') {
    let prompt = buildPrompt({ product_name, price, headline: product_name, hook: custom_prompt || 'Elegance, delivered.' });
    if (feedback) prompt += `\n${feedback}`;
    return prompt;
  }

  // Elara specialized prompt
  if (isElara && style === 'ad_creative' && showModel && textOverlay === 'none') {
    let prompt = `Campaign-ready Meta ad creative for Elegance House — Elara Tummy-Control Bikini.

Show: Woman age 35-50, natural curvy body with soft midsection (NOT a fitness
model), wearing a high-waist tummy-control bikini. She looks confident and happy.

Product: ${product_name}
${price ? `Price: ${price}` : ''}

Setting: Beach, poolside, or tropical vacation. Warm golden sunlight, blue water
visible. She's enjoying herself — walking on sand, sitting by the pool edge,
playing with kids, or laughing naturally.

The bikini should be clearly visible: high-waist cut, ruched waistband that
smooths the tummy area. She looks comfortable and feminine — not hiding.

Style: Warm vacation tones, golden hour lighting. Authentic and aspirational
but achievable — she looks like a real customer on holiday, not a fashion shoot.
${custom_prompt ? `\nAdditional instructions: ${custom_prompt}` : ''}

Output: 1080x1080, photorealistic, no text overlay.`.trim();
    if (feedback) prompt += `\n${feedback}`;
    return prompt;
  }

  const builder = STYLE_PROMPTS[style] || STYLE_PROMPTS.ad_creative;
  let prompt = builder({ product_name, price, custom_prompt });

  // Product only — no model
  if (!showModel) {
    prompt += '\n\nIMPORTANT: Show ONLY the product itself. No person, no model, no mannequin. Clean product-only shot — the garment laid flat, on a hanger, or styled without a body.';
  }

  // Text overlay
  if (textOverlay === 'custom' && overlayText) {
    prompt = prompt.replace('no text overlay', '');
    prompt += `\n\nADD TEXT OVERLAY on the image: "${overlayText}". Use clean, modern sans-serif font (like Montserrat or Helvetica). White or gold text with subtle drop shadow for readability. Place the text in a visually balanced position — bottom third or top area, not covering the product or face. The text should look professionally designed, not pasted on.`;
  } else if (textOverlay === 'auto') {
    prompt = prompt.replace('no text overlay', '');
    prompt += `\n\nADD a short, punchy advertising headline text overlay on the image. Generate a compelling 2-5 word headline relevant to this product (e.g. "Elegance Redefined", "Your New Favorite", "Feel The Difference"). Use clean, modern sans-serif font, white or gold color with subtle drop shadow. Place in bottom third or top area, not covering the product or face. Should look like a professional ad design.`;
  }

  // Append feedback learning
  if (feedback) {
    prompt += `\n${feedback}`;
  }

  return prompt;
}

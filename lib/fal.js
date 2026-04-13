const FAL_KEY = process.env.FAL_KEY;
const FAL_BASE = 'https://queue.fal.run';

// Map UI aspect ratios → fal.ai image_size presets
const RATIO_MAP = {
  '1:1': 'square_hd',
  '4:5': 'portrait_4_3',     // closest fal preset to 4:5
  '9:16': 'portrait_16_9',
  '16:9': 'landscape_16_9',
};

/**
 * Build model-specific request body for fal.ai
 */
function buildFalBody(model, prompt, imageUrl, numImages, aspectRatio) {
  const imageSize = RATIO_MAP[aspectRatio] || 'square_hd';
  const images = imageUrl ? (Array.isArray(imageUrl) ? imageUrl : [imageUrl]) : [];

  // Ideogram v3 replace-background
  if (model.includes('ideogram') && model.includes('replace-background')) {
    if (!images[0]) throw new Error('ideogram replace-background requires an image');
    return { image_url: images[0], prompt, num_images: numImages, image_size: imageSize };
  }

  // Ideogram v3 edit
  if (model.includes('ideogram') && model.includes('edit')) {
    if (!images[0]) throw new Error('ideogram edit requires an image');
    return { image_url: images[0], prompt, num_images: numImages, image_size: imageSize };
  }

  // FLUX.2 edit models (flux-2/edit, flux-2-pro/edit, flux-2-flex/edit)
  if (model.includes('flux-2') && model.includes('edit')) {
    return {
      prompt,
      num_images: numImages,
      image_size: imageSize,
      ...(images.length > 0 ? { image_urls: images } : {}),
    };
  }

  // FLUX Kontext pro (requires image_url)
  if (model.includes('flux-pro/kontext') || model.includes('flux-kontext')) {
    if (!images.length) {
      // Kontext requires image — fall back to text-to-image body
      return { prompt, num_images: numImages, image_size: imageSize };
    }
    return {
      prompt,
      num_images: numImages,
      image_size: imageSize,
      image_url: images[0],
    };
  }

  // Pure text-to-image models (flux/schnell, flux-pro, etc.)
  if (model.includes('flux/schnell') || model.includes('flux-pro/v1') || (model.includes('flux') && !model.includes('edit') && !model.includes('kontext'))) {
    return { prompt, num_images: numImages, image_size: imageSize };
  }

  // Default: nano-banana-2/edit style (image_urls list)
  return {
    prompt,
    num_images: numImages,
    image_size: imageSize,
    ...(images.length > 0 ? { image_urls: images } : {}),
  };
}

/**
 * Generate image via fal.ai
 */
export async function generateFal({ model = 'fal-ai/nano-banana-2/edit', prompt, imageUrl, numImages = 1, aspectRatio = '1:1' }) {
  if (!FAL_KEY) throw new Error('FAL_KEY not configured');

  const body = buildFalBody(model, prompt, imageUrl, numImages, aspectRatio);
  console.log('[fal] Submit to:', model, 'images:', Array.isArray(imageUrl) ? imageUrl.length : (imageUrl ? 1 : 0));

  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${FAL_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${await res.text()}`);

  const { request_id } = await res.json();
  if (!request_id) throw new Error('No request_id from fal.ai');

  // Strip trailing path segments for polling (edit, kontext, replace-background, etc.)
  const pollBase = model.replace(/\/(edit|kontext|replace-background)$/, '');
  return pollFalResult(pollBase, request_id);
}

async function pollFalResult(pollBase, requestId, maxTime = 55000) {
  const start = Date.now();

  while (Date.now() - start < maxTime) {
    const statusRes = await fetch(`${FAL_BASE}/${pollBase}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${FAL_KEY}` },
    });
    const statusData = await statusRes.json();

    if (statusData.status === 'COMPLETED') {
      const resultUrl = `${FAL_BASE}/${pollBase}/requests/${requestId}`;
      console.log('[fal] Fetching result from:', resultUrl);
      const resultRes = await fetch(resultUrl, {
        headers: { 'Authorization': `Key ${FAL_KEY}` },
      });
      const resultText = await resultRes.text();
      console.log('[fal] Result status:', resultRes.status, 'length:', resultText.length);
      if (!resultRes.ok) {
        console.error('[fal] Result error:', resultText.slice(0, 500));
        throw new Error(`fal.ai result fetch failed: ${resultRes.status}`);
      }
      if (!resultText) throw new Error('fal.ai returned empty response');
      const result = JSON.parse(resultText);
      const url = result.images?.[0]?.url;
      if (!url) {
        console.error('[fal] Unexpected result shape:', JSON.stringify(result).slice(0, 500));
        throw new Error('fal.ai returned no image URL');
      }
      return { url, requestId };
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${statusData.error || 'unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('fal.ai generation timed out');
}

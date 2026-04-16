const FAL_KEY = process.env.FAL_KEY;
const FAL_BASE = 'https://queue.fal.run';

/**
 * Build model-specific request body for fal.ai.
 * All supported models use `aspect_ratio` (e.g. "1:1", "4:5", "9:16", "16:9").
 */
function buildFalBody(model, prompt, imageUrl, numImages, aspectRatio) {
  const ratio = aspectRatio || '1:1';
  const images = imageUrl ? (Array.isArray(imageUrl) ? imageUrl : [imageUrl]) : [];

  // Ideogram v3 (replace-background + edit) — both require an image
  if (model.includes('ideogram')) {
    if (!images[0]) throw new Error(`${model} requires an image`);
    return { image_url: images[0], prompt, num_images: numImages, aspect_ratio: ratio };
  }

  // FLUX.2 edit models (flux-2/edit, flux-2-pro/edit, flux-2-flex/edit)
  if (model.includes('flux-2') && model.includes('edit')) {
    return {
      prompt,
      num_images: numImages,
      aspect_ratio: ratio,
      ...(images.length > 0 ? { image_urls: images } : {}),
    };
  }

  // FLUX Kontext pro (requires image_url, falls back to text-to-image)
  if (model.includes('flux-pro/kontext') || model.includes('flux-kontext')) {
    if (!images.length) {
      return { prompt, num_images: numImages, aspect_ratio: ratio };
    }
    return { prompt, num_images: numImages, aspect_ratio: ratio, image_url: images[0] };
  }

  // Pure text-to-image flux (schnell, flux-pro)
  if (model.includes('flux/schnell') || model.includes('flux-pro/v1') || (model.includes('flux') && !model.includes('edit') && !model.includes('kontext'))) {
    return { prompt, num_images: numImages, aspect_ratio: ratio };
  }

  // Default: nano-banana-2/edit style (image_urls list)
  return {
    prompt,
    num_images: numImages,
    aspect_ratio: ratio,
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

  const resText = await res.text();
  console.log('[fal] Response status:', res.status, 'length:', resText.length, 'preview:', resText.slice(0, 200));
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${resText.slice(0, 500)}`);
  if (!resText) throw new Error('fal.ai returned empty response');

  const responseData = JSON.parse(resText);

  // Some models (flux/schnell) return results synchronously — no polling needed
  if (responseData.images?.[0]?.url) {
    const url = responseData.images[0].url;
    console.log('[fal] Sync result, image URL:', url?.slice(0, 80));
    return { url, requestId: responseData.request_id || 'sync' };
  }

  const { request_id } = responseData;
  if (!request_id) throw new Error('No request_id from fal.ai');

  // Strip trailing path segments for polling
  // fal-ai/flux/schnell → fal-ai/flux, fal-ai/nano-banana-2/edit → fal-ai/nano-banana-2
  const pollBase = model.replace(/\/(edit|kontext|replace-background|schnell|v1|v2)$/, '');
  return pollFalResult(pollBase, request_id);
}

/**
 * Submit a fal.ai job without waiting for the result.
 * Use with checkFalJob for fire-and-forget polling handled outside the request.
 */
export async function submitFalJob({ model = 'fal-ai/nano-banana-2/edit', prompt, imageUrl, numImages = 1, aspectRatio = '1:1' }) {
  if (!FAL_KEY) throw new Error('FAL_KEY not configured');

  const body = buildFalBody(model, prompt, imageUrl, numImages, aspectRatio);
  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${FAL_KEY}` },
    body: JSON.stringify(body),
  });

  const resText = await res.text();
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${resText.slice(0, 500)}`);
  if (!resText) throw new Error('fal.ai returned empty response');
  const data = JSON.parse(resText);

  // Some models return synchronously (flux/schnell) — surface that as already-completed
  if (data.images?.[0]?.url) {
    return { requestId: data.request_id || 'sync', pollBase: null, completed: true, url: data.images[0].url };
  }

  if (!data.request_id) throw new Error('No request_id from fal.ai');
  const pollBase = model.replace(/\/(edit|kontext|replace-background|schnell|v1|v2)$/, '');
  return { requestId: data.request_id, pollBase, completed: false };
}

/**
 * One-shot status check for a submitted fal.ai job.
 * Returns { status: 'pending'|'completed'|'failed', url?, error? }.
 */
export async function checkFalJob(pollBase, requestId) {
  if (!FAL_KEY) throw new Error('FAL_KEY not configured');

  const statusRes = await fetch(`${FAL_BASE}/${pollBase}/requests/${requestId}/status`, {
    headers: { 'Authorization': `Key ${FAL_KEY}` },
  });
  if (!statusRes.ok) throw new Error(`fal.ai status ${statusRes.status}`);
  const statusData = await statusRes.json();

  if (statusData.status === 'COMPLETED') {
    const resultRes = await fetch(`${FAL_BASE}/${pollBase}/requests/${requestId}`, {
      headers: { 'Authorization': `Key ${FAL_KEY}` },
    });
    if (!resultRes.ok) return { status: 'failed', error: `result fetch ${resultRes.status}` };
    const result = await resultRes.json();
    const url = result.images?.[0]?.url;
    if (!url) return { status: 'failed', error: 'no image URL in result' };
    return { status: 'completed', url };
  }

  if (statusData.status === 'FAILED') {
    return { status: 'failed', error: statusData.error || 'unknown error' };
  }

  return { status: 'pending' };
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

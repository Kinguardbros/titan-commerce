const FAL_KEY = process.env.FAL_KEY;
const FAL_BASE = 'https://queue.fal.run';

/**
 * Generate image via fal.ai
 */
export async function generateFal({ model = 'fal-ai/nano-banana-2/edit', prompt, imageUrl, numImages = 1 }) {
  if (!FAL_KEY) throw new Error('FAL_KEY not configured');

  const body = { prompt, num_images: numImages };
  if (imageUrl) {
    body.image_urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
  }

  const res = await fetch(`${FAL_BASE}/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${FAL_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${await res.text()}`);

  const { request_id } = await res.json();
  if (!request_id) throw new Error('No request_id from fal.ai');

  // Strip /edit, /kontext etc. from model path for polling
  const pollBase = model.replace(/\/(edit|kontext)$/, '');
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
      const resultRes = await fetch(`${FAL_BASE}/${pollBase}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${FAL_KEY}` },
      });
      const result = await resultRes.json();
      const url = result.images?.[0]?.url;
      if (!url) throw new Error('fal.ai returned no image URL');
      return { url, requestId };
    }

    if (statusData.status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${statusData.error || 'unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('fal.ai generation timed out');
}

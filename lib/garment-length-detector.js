// Vision-based garment-length classifier for Product Catalog v1 framing.
//
// Calls Claude Sonnet with the first product image and asks where the garment ends
// on the body. The answer drives the v1 framing decision in api/creatives/generate.js:
//   'short' | 'mid' → use the default above-knee post-process crop (0.65 height)
//   'long'          → disable the post-process crop and prompt for full-body framing
//
// Cached on `products.garment_length` to avoid repeating the Vision call.

const VALID_LENGTHS = new Set(['short', 'mid', 'long']);

/**
 * Detect garment length from a product image URL. Returns one of 'short' | 'mid' | 'long'.
 * Returns null on any failure (network, parse, unexpected response) — caller should treat
 * null as "unknown, fall back to default behavior".
 */
export async function detectGarmentLength(imageUrl) {
  if (!imageUrl) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[garment-length] ANTHROPIC_API_KEY missing, skipping detection');
    return null;
  }

  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) {
      console.warn('[garment-length] image fetch failed:', resp.status, imageUrl.slice(0, 80));
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const base64 = buf.toString('base64');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
          {
            type: 'text',
            text: `Look at this swimwear / clothing product image. Where does the LOWEST point of the garment end on the body?

Reply with EXACTLY ONE WORD, no punctuation, no explanation:
- "short" — the garment ends at the hip, upper thigh, or higher (bikini, briefs, swim shorts, crop top, short skirt above mid-thigh, one-piece swimsuit that ends at the crotch / upper thigh)
- "mid"   — the garment ends between mid-thigh and just above the knee (mini dress, mini skirt, mid-thigh cover-up, romper)
- "long"  — the garment ends at or below the knee (knee-length skirt, midi skirt, maxi skirt, maxi dress, long cover-up, ankle-length garment, full-length kaftan)

Your reply MUST be exactly one of: short / mid / long`,
          },
        ],
      }],
    });

    const raw = (response.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (VALID_LENGTHS.has(raw)) return raw;
    console.warn('[garment-length] unexpected Vision reply:', raw.slice(0, 50));
    return null;
  } catch (e) {
    console.warn('[garment-length] detection failed:', e.message);
    return null;
  }
}

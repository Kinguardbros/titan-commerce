import sharp from 'sharp';

// Vertical crop fractions (top, height) as a share of the source image height. Applied to a
// FINISHED generated Product Catalog image to enforce the chosen framing — cropping the output
// is deterministic and reliable, unlike trying to make Nano Banana edit honour a crop instruction.
// Keys match the Product Catalog framing options.
const CROP_FRACTIONS = {
  'three-quarter': { top: 0.0,  height: 0.90 }, // head → mid-calf (thighs + some calf visible)
  'waist-up':      { top: 0.0,  height: 0.68 }, // head → waist/hip
  'detail':        { top: 0.20, height: 0.50 }, // chest → mid-thigh (skip head)
};

// Gentle exposure lift applied to every finished Product Catalog image. 1.18/13 and even
// 1.12/8 were overexposing (sand/sky/skin blown out to white) — backed all the way down to
// a barely-there nudge that just keeps black garments from going muddy without touching the
// highlights. If product comes out too dark again, nudge up to ~1.10/6; do NOT go past that.
const BRIGHTNESS_MULT = 1.06;  // ~+6% overall exposure
const SHADOW_LIFT = 4;          // raise the black point by ~4/255

/**
 * Process a finished Product Catalog image buffer: optionally crop to a framing, then apply a
 * gentle brightness lift. Returns a new JPEG buffer, or the original buffer on any failure
 * (so generation never breaks just because post-processing failed). `framingKey` may be null /
 * 'full' — in that case no crop is applied but the brightness lift still is.
 */
export async function processCatalogImage(buf, framingKey) {
  if (!buf) return buf;
  try {
    let img = sharp(buf);
    const frac = framingKey ? CROP_FRACTIONS[framingKey] : null;
    if (frac) {
      const meta = await img.metadata();
      if (!meta.width || !meta.height) return buf;
      const top = Math.round(meta.height * frac.top);
      const height = Math.min(Math.round(meta.height * frac.height), meta.height - top);
      if (height < 50) return buf;
      img = img.extract({ left: 0, top, width: meta.width, height });
    }
    return await img
      .modulate({ brightness: BRIGHTNESS_MULT })
      .linear(1.0, SHADOW_LIFT)
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (e) {
    console.error('[avatar-crop] processCatalogImage failed:', e.message);
    return buf;
  }
}

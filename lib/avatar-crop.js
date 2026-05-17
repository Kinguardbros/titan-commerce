import sharp from 'sharp';

// Post-processing for finished Product Catalog images: crop to a deterministic 4:5 portrait
// at the requested framing, then apply a gentle brightness lift.
//
// The catalog flows ask Nano Banana for 9:16 (extra vertical headroom), so the rendered
// output is always TALLER than 4:5. This module crops that tall output down to exact 4:5
// (target_height = width * 5/4) centred vertically per the framing key.
//
// `topBias` decides where to bias the 4:5 window inside the tall input:
//   0.0  = pin to top (more headroom + face, less legs)
//   0.5  = perfect centre
//   1.0  = pin to bottom (less headroom, more legs)
// We bias slightly toward the top so the head has breathing room and the lower cut lands
// somewhere around the knee for a normal standing model.
const FRAMINGS = {
  'three-quarter': { topBias: 0.30 }, // head → above-knee feel on a standing model
  'waist-up':      { topBias: 0.10 }, // tighter on the upper body
  'detail':        { topBias: 0.20 }, // mid-torso crop
};

const TARGET_ASPECT = 4 / 5; // width / height for a 4:5 portrait

// Gentle exposure lift applied to every finished Product Catalog image. 1.18/13 and even
// 1.12/8 were overexposing (sand/sky/skin blown out to white) — backed all the way down to
// a barely-there nudge that just keeps black garments from going muddy without touching the
// highlights. If product comes out too dark again, nudge up to ~1.10/6; do NOT go past that.
const BRIGHTNESS_MULT = 1.06;  // ~+6% overall exposure
const SHADOW_LIFT = 4;          // raise the black point by ~4/255

/**
 * Process a finished Product Catalog image buffer: crop to a 4:5 portrait at the requested
 * framing, then apply a gentle brightness lift. Returns a new JPEG buffer, or the original
 * buffer on any failure (so generation never breaks just because post-processing failed).
 * `framingKey` may be null — in that case no crop is applied but the brightness lift still is.
 */
export async function processCatalogImage(buf, framingKey) {
  if (!buf) return buf;
  try {
    let img = sharp(buf);
    const framing = framingKey ? FRAMINGS[framingKey] : null;
    if (framing) {
      const meta = await img.metadata();
      if (!meta.width || !meta.height) return buf;
      const targetHeight = Math.round(meta.width / TARGET_ASPECT); // for 4:5 portrait
      if (targetHeight < meta.height) {
        // Input is taller than 4:5 — crop vertical to the 4:5 window biased per framingKey
        const slack = meta.height - targetHeight;
        const top = Math.max(0, Math.min(slack, Math.round(slack * framing.topBias)));
        if (targetHeight >= 50) {
          img = img.extract({ left: 0, top, width: meta.width, height: targetHeight });
        }
      } else if (targetHeight > meta.height) {
        // Input is wider than 4:5 — crop horizontal to the 4:5 window centred
        const targetWidth = Math.round(meta.height * TARGET_ASPECT);
        const slack = meta.width - targetWidth;
        const left = Math.max(0, Math.round(slack / 2));
        if (targetWidth >= 50) {
          img = img.extract({ left, top: 0, width: targetWidth, height: meta.height });
        }
      }
      // Already 4:5 — no crop needed
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

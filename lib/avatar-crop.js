import sharp from 'sharp';

// Post-processing for finished Product Catalog v1 images.
//
// Goal: deterministic 3/4-body 4:5 portrait (head to mid-calf, feet cropped off) even
// though Nano Banana keeps returning full-body shots — it mirrors the avatar reference
// image which is full-body, so prompt instructions alone are not enough.
//
// Approach:
//   1) Trim the bottom of the input to remove feet/lower legs (keep top 82% of height
//      = head to mid-calf on a typical standing model).
//   2) Crop the SIDES symmetrically so the final aspect is exactly 4:5 (otherwise the
//      pure vertical trim leaves a ~5:6 frame).
//
// Result is always exactly 4:5. Pixel dimensions depend on what fal.ai returned, but
// the aspect is consistent.

const TARGET_ASPECT = 4 / 5; // width / height for a 4:5 portrait

// Fraction of the input height to KEEP from the top. 0.82 lands roughly at mid-calf
// on a standing model that fills ~90% of a 4:5 fal.ai render.
const HEIGHT_KEEP = {
  'three-quarter': 0.82, // head → mid-calf
  'waist-up':      0.62, // head → waist/hip (legacy, currently unused)
  'detail':        0.50, // chest → mid-thigh, with `top` offset (legacy, currently unused)
};
// Optional top offset for framings that skip the head (detail crop).
const TOP_OFFSET = {
  'detail': 0.20,
};

// Gentle exposure lift applied to every finished Product Catalog image. 1.18/13 and even
// 1.12/8 were overexposing (sand/sky/skin blown out to white) — backed all the way down to
// a barely-there nudge that just keeps black garments from going muddy without touching the
// highlights. If product comes out too dark again, nudge up to ~1.10/6; do NOT go past that.
const BRIGHTNESS_MULT = 1.06;  // ~+6% overall exposure
const SHADOW_LIFT = 4;          // raise the black point by ~4/255

/**
 * Process a finished Product Catalog image buffer: crop to 4:5 at the requested framing
 * (head-to-mid-calf for 'three-quarter'), then apply a gentle brightness lift. Returns a
 * JPEG buffer, or the original buffer on any failure. `framingKey` may be null — then no
 * crop is applied (brightness lift still runs).
 */
export async function processCatalogImage(buf, framingKey) {
  if (!buf) return buf;
  try {
    let img = sharp(buf);
    const keep = framingKey ? HEIGHT_KEEP[framingKey] : null;
    if (keep) {
      const meta = await img.metadata();
      if (!meta.width || !meta.height) return buf;
      // Step 1: vertical trim
      const topOffset = TOP_OFFSET[framingKey] || 0;
      const top = Math.round(meta.height * topOffset);
      const trimmedH = Math.min(Math.round(meta.height * keep), meta.height - top);
      if (trimmedH < 50) return buf;
      // Step 2: horizontal trim so the final aspect is exactly 4:5
      const targetW = Math.round(trimmedH * TARGET_ASPECT);
      const finalW = Math.min(targetW, meta.width);
      const left = Math.max(0, Math.round((meta.width - finalW) / 2));
      if (finalW >= 50) {
        img = img.extract({ left, top, width: finalW, height: trimmedH });
      }
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

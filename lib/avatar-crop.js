import sharp from 'sharp';

// Vertical crop fractions (top, height) as a share of the source image height. Applied to a
// FINISHED generated Product Catalog image to enforce the chosen framing — cropping the output
// is deterministic and reliable, unlike trying to make Nano Banana edit honour a crop instruction.
// Keys match the Product Catalog framing options.
const CROP_FRACTIONS = {
  'three-quarter': { top: 0.0,  height: 0.78 }, // head → ~mid-calf
  'waist-up':      { top: 0.0,  height: 0.58 }, // head → waist/hip
  'detail':        { top: 0.20, height: 0.42 }, // chest → upper thigh (skip head)
};

/**
 * Crop a finished image buffer to a given framing. Returns a new JPEG buffer, or the original
 * buffer on any failure (so generation never breaks just because the crop failed).
 */
export async function cropImageBuffer(buf, framingKey) {
  const frac = CROP_FRACTIONS[framingKey];
  if (!frac || !buf) return buf;
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return buf;
    const top = Math.round(meta.height * frac.top);
    const height = Math.min(Math.round(meta.height * frac.height), meta.height - top);
    if (height < 50) return buf;
    return await img.extract({ left: 0, top, width: meta.width, height }).jpeg({ quality: 92 }).toBuffer();
  } catch (e) {
    console.error('[avatar-crop] cropImageBuffer failed:', e.message);
    return buf;
  }
}

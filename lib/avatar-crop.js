import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Vertical crop fractions (top, height) as a share of the source image height — the avatar
// reference photo is always full body, so we crop it to the framing we want for the catalog
// shot. Width is kept full. Keys match the Product Catalog framing options.
const CROP_FRACTIONS = {
  'three-quarter': { top: 0.0,  height: 0.62 }, // head → just below the knee (no feet/ankles)
  'waist-up':      { top: 0.0,  height: 0.45 }, // head → waist/hip
  'detail':        { top: 0.22, height: 0.36 }, // chest → upper thigh (skip head)
};

// fal.ai aspect_ratio presets we can request. We pick whichever is closest to the cropped
// avatar's actual w/h so the output canvas has the same shape — leaving the model no empty
// space to "fill in" with the rest of the body.
const FAL_RATIO_PRESETS = [
  { label: '1:1',  value: 1 / 1 },
  { label: '4:5',  value: 4 / 5 },   // 0.80 — slightly tall
  { label: '3:4',  value: 3 / 4 },   // 0.75
  { label: '2:3',  value: 2 / 3 },   // 0.667
  { label: '9:16', value: 9 / 16 },  // 0.5625 — very tall
  { label: '16:9', value: 16 / 9 },  // wide
];
function closestFalRatio(width, height) {
  if (!width || !height) return null;
  const r = width / height;
  let best = FAL_RATIO_PRESETS[0];
  let bestDiff = Infinity;
  for (const p of FAL_RATIO_PRESETS) {
    const d = Math.abs(p.value - r);
    if (d < bestDiff) { bestDiff = d; best = p; }
  }
  return best.label;
}

/**
 * Crop a full-body avatar reference photo to a given framing and upload the result.
 * Returns { url, ratio } where `url` is a public URL to the cropped copy and `ratio` is the
 * closest fal.ai aspect-ratio preset for the cropped image's shape — or null on any failure
 * (caller falls back to the original full-body URL + the user's aspect ratio). Only crops for
 * 'three-quarter' | 'waist-up' | 'detail'; any other framingKey returns null.
 */
export async function cropAvatarForFraming(avatarUrl, framingKey) {
  const frac = CROP_FRACTIONS[framingKey];
  if (!frac || !avatarUrl) return null;
  try {
    const resp = await fetch(avatarUrl);
    if (!resp.ok) { console.warn('[avatar-crop] fetch failed:', resp.status); return null; }
    const buf = Buffer.from(await resp.arrayBuffer());
    const img = sharp(buf);
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    const top = Math.round(meta.height * frac.top);
    const height = Math.min(Math.round(meta.height * frac.height), meta.height - top);
    if (height < 50) return null;
    const out = await img.extract({ left: 0, top, width: meta.width, height }).jpeg({ quality: 90 }).toBuffer();
    const path = `_tmp/avatar_crop_${framingKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from('creatives').upload(path, out, { contentType: 'image/jpeg', upsert: true });
    if (error) { console.error('[avatar-crop] upload failed:', error.message); return null; }
    const { data: pub } = supabase.storage.from('creatives').getPublicUrl(path);
    if (!pub?.publicUrl) return null;
    return { url: pub.publicUrl, ratio: closestFalRatio(meta.width, height) };
  } catch (e) {
    console.error('[avatar-crop] failed:', e.message);
    return null;
  }
}

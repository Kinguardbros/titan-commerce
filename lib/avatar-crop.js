import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Vertical crop fractions (top, height) as a share of the source image height — the avatar
// reference photo is always full body, so we crop it to the framing we want for the catalog
// shot. Width is kept full. Keys match the Product Catalog framing options.
const CROP_FRACTIONS = {
  'three-quarter': { top: 0.0,  height: 0.78 }, // head → ~mid-calf
  'waist-up':      { top: 0.0,  height: 0.55 }, // head → waist/hip
  'detail':        { top: 0.18, height: 0.42 }, // chest → upper thigh (skip head)
};

/**
 * Crop a full-body avatar reference photo to a given framing and upload the result.
 * Returns a public URL to the cropped copy, or null on any failure (caller falls back to
 * the original full-body URL). Only crops for 'three-quarter' | 'waist-up' | 'detail';
 * any other framingKey (e.g. full body) returns null and the caller keeps the original.
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
    return pub?.publicUrl || null;
  } catch (e) {
    console.error('[avatar-crop] failed:', e.message);
    return null;
  }
}

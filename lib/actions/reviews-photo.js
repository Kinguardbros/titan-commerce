import { getStore } from '../store-context.js';
import { supabase } from './reviews-shared.js';

// Phase 4 — review photo upload. Pattern: upload_avatar (lib/actions/avatars.js).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

// POST: upload_review_photo — store a base64 image in Supabase Storage, return its public URL.
// Frontend then persists the URL via add_review_manual / update_review.
export async function upload_review_photo(req, res) {
  const { store_id, product_id, base64 } = req.body; // media_type ignored — we sniff magic bytes
  if (!store_id || !product_id || !base64) {
    return res.status(400).json({ error: 'store_id, product_id, and base64 required' });
  }
  // Validate product_id is a real UUID — it goes into the storage path (no traversal).
  if (!UUID_RE.test(product_id)) return res.status(400).json({ error: 'invalid product_id' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  // Product must belong to this store.
  const { data: product } = await supabase.from('products')
    .select('id').eq('id', product_id).eq('store_id', store_id).single();
  if (!product) return res.status(404).json({ error: 'Product not found in this store' });

  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) return res.status(400).json({ error: 'empty image' });
  if (buf.length > MAX_PHOTO_BYTES) return res.status(400).json({ error: 'image too large (max 8 MB)' });
  // Only accept real images (magic bytes): JPEG, PNG, WebP.
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return res.status(400).json({ error: 'file is not a JPEG/PNG/WebP image' });

  const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
  const contentType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
  const storeName = store.slug || store.name;
  const path = `${storeName}/Reviews/${product_id}/photo_${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('store-docs').upload(path, buf, { contentType, upsert: true });
  if (upErr) throw upErr;
  const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
  const photo_url = urlData?.publicUrl;

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Uploaded review photo for product ${product_id}`,
  });

  return res.status(200).json({ photo_url });
}

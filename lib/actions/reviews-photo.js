import { getStore } from '../store-context.js';
import { supabase } from './reviews-shared.js';

// Phase 4 — review photo upload. Pattern: upload_avatar (lib/actions/avatars.js).

// POST: upload_review_photo — store a base64 image in Supabase Storage, return its public URL.
// Frontend then persists the URL via add_review_manual / update_review.
export async function upload_review_photo(req, res) {
  const { store_id, product_id, base64, media_type } = req.body;
  if (!store_id || !product_id || !base64) {
    return res.status(400).json({ error: 'store_id, product_id, and base64 required' });
  }

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const storeName = store.slug || store.name;
  const ext = (media_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const path = `${storeName}/Reviews/${product_id}/photo_${Date.now()}.${ext}`;
  const buf = Buffer.from(base64, 'base64');

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

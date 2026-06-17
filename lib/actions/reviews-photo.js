import { getStore } from '../store-context.js';
import { supabase, decodeAndValidateImage, uploadReviewImage } from './reviews-shared.js';

// Phase 4 — review photo upload. Pattern: upload_avatar (lib/actions/avatars.js).
// Magic-byte validation + Storage upload are shared with the public submit path
// (reviews-public.js) via decodeAndValidateImage / uploadReviewImage in reviews-shared.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB (internal/admin upload)

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

  const img = decodeAndValidateImage(base64, MAX_PHOTO_BYTES);
  if (img.error) return res.status(400).json({ error: img.error });

  const storeName = store.slug || store.name;
  const photo_url = await uploadReviewImage(storeName, product_id, img.buf, img.ext, img.contentType);

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Uploaded review photo for product ${product_id}`,
  });

  return res.status(200).json({ photo_url });
}

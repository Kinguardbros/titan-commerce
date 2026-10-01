import { getStore } from '../store-context.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';
import { supabase, safePhotoUrl, reviewPhotoPath, dropExistingDuplicates, insertReviewsBatch } from './reviews-shared.js';

// "Copy to collection…" in the Reviews panel: copy a product's live (approved +
// published) reviews onto another product of the same store. The dashboard calls this
// once per selected product, so one request stays small no matter how many products or
// photos are involved.
//
// Copies land as pending (same moderation path as an import) with verified=false and
// helpful_count=0: a verified purchase and storefront votes belong to the original
// product, not to the one receiving the copy. The original `source` is kept.

const PHOTO_COPY_PARALLEL = 8;

// Give the copy its own Storage file. Sharing the original URL would let a delete or
// reject on ONE product remove the photo from every product (deleteReviewPhoto and the
// reject cleanup both remove the Storage object). External URLs are not ours to delete,
// so they are kept as they are. Returns the new URL, or null when the copy failed.
async function copyPhoto(url, storeFolder, targetId, n) {
  const from = reviewPhotoPath(String(url).split('?')[0]);
  if (!from) return safePhotoUrl(url);
  const ext = (from.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg';
  const to = `${storeFolder}/Reviews/${targetId}/copy_${Date.now()}_${n}.${ext}`;
  const { error } = await supabase.storage.from('store-docs').copy(from, to);
  if (error) {
    console.error('[reviews-copy] photo copy failed:', { from, to, error: error.message });
    return null;
  }
  return supabase.storage.from('store-docs').getPublicUrl(to).data?.publicUrl || null;
}

// POST: copy_reviews_to_products — { store_id, source_product_id, target_product_id }
// → { copied, duplicates, photos_copied, photos_failed }.
export async function copy_reviews_to_products(req, res) {
  const { store_id, source_product_id, target_product_id } = req.body || {};
  if (!store_id || !source_product_id || !target_product_id) {
    return res.status(400).json({ error: 'store_id, source_product_id and target_product_id required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  if (source_product_id === target_product_id) {
    return res.status(400).json({ error: 'Source and target are the same product' });
  }

  const { data: owned, error: ownErr } = await supabase.from('products')
    .select('id, title').in('id', [source_product_id, target_product_id]).eq('store_id', store_id);
  if (ownErr) throw ownErr;
  const source = (owned || []).find((p) => p.id === source_product_id);
  const target = (owned || []).find((p) => p.id === target_product_id);
  if (!source || !target) return res.status(404).json({ error: 'Product not found in this store' });

  const { data: live, error: liveErr } = await supabase.from('product_reviews')
    .select('author, rating, title, body, review_date, photo_url, photo_urls, source')
    .eq('store_id', store_id).eq('product_id', source_product_id)
    .in('status', ['approved', 'published'])
    .order('review_date', { ascending: false });
  if (liveErr) throw liveErr;

  const rows = (live || []).map((r) => ({
    store_id, product_id: target_product_id,
    author: r.author, rating: r.rating, title: r.title, body: r.body, review_date: r.review_date,
    photo_url: r.photo_url, photo_urls: r.photo_urls, source: r.source,
    verified: false, helpful_count: 0, status: 'pending',
  }));
  // Dedup BEFORE copying photos, so a skipped review leaves no orphan file behind.
  const fresh = await dropExistingDuplicates(supabase, store_id, target_product_id, rows);

  const store = await getStore(store_id);
  const storeFolder = store?.slug || store?.name || 'store';
  let photos_copied = 0;
  let photos_failed = 0;
  let n = 0; // file-name counter; incremented before each await, so unique across the parallel batch
  const copyRowPhotos = async (row) => {
    const urls = Array.isArray(row.photo_urls) && row.photo_urls.length ? row.photo_urls : (row.photo_url ? [row.photo_url] : []);
    const copied = [];
    for (const url of urls) {
      const out = await copyPhoto(url, storeFolder, target_product_id, n++);
      if (!out) { photos_failed++; continue; }
      if (reviewPhotoPath(url)) photos_copied++;
      copied.push(out);
    }
    row.photo_urls = copied.length ? copied : null;
    row.photo_url = copied[0] || null;
  };
  // Storage copies run 8 reviews at a time: a product with hundreds of photo reviews
  // copied one file after another could run past the 55 s Vercel limit.
  for (let i = 0; i < fresh.length; i += PHOTO_COPY_PARALLEL) {
    await Promise.all(fresh.slice(i, i + PHOTO_COPY_PARALLEL).map(copyRowPhotos));
  }

  const { inserted, skipped_duplicates } = await insertReviewsBatch(supabase, fresh);
  const duplicates = rows.length - fresh.length + skipped_duplicates;

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: photos_failed ? 'warn' : 'info',
    message: `Copied ${inserted} review(s) from "${source.title}" to "${target.title}" (${duplicates} duplicate${photos_failed ? `, ${photos_failed} photo(s) failed to copy` : ''})`,
    metadata: { source_product_id, target_product_id },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ copied: inserted, duplicates, photos_copied, photos_failed });
}

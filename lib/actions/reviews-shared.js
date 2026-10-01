import { createClient } from '@supabase/supabase-js';

// Shared service-role client + helpers for the product reviews modules
// (reviews.js core + reviews-import / reviews-ai / reviews-photo).
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Summary (★ average + count) is computed from approved + published reviews only.
export function computeSummary(reviews) {
  const counted = (reviews || []).filter((r) => r.status === 'approved' || r.status === 'published');
  if (!counted.length) return { count: 0, average: 0 };
  const sum = counted.reduce((s, r) => s + r.rating, 0);
  return { count: counted.length, average: Math.round((sum / counted.length) * 10) / 10 };
}

// Sanitize a stored photo_url: allow only http(s) URLs (blocks javascript:/data: that
// would become a clickable XSS vector when rendered into href/src on the storefront).
// Returns the URL if safe, else null.
export function safePhotoUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

// Storefront thumbnail for a review photo.
//
// Why this exists: the storefront renders these photos into a ~82px slot but we were
// serving the originals at 1200-1600px, ~1.28 MB per product page view. That burned
// through the Supabase cached-egress quota on 2026-08-24 and Storage started returning
// HTTP 402 for every file, so every review photo on the site broke at once.
//
// Supabase Storage can resize on the fly via the render/image endpoint, which is the
// same object path with `object` swapped for `render/image`. Anything that is not a
// Supabase Storage public URL (or is already a render URL) is returned untouched, so
// this is safe to run over mixed/legacy data.
export function reviewPhotoThumb(url, width = REVIEW_THUMB_WIDTH, quality = REVIEW_THUMB_QUALITY) {
  const safe = safePhotoUrl(url);
  if (!safe) return null;
  if (safe.includes('/storage/v1/render/image/')) return safe;
  if (!safe.includes('/storage/v1/object/public/')) return safe;
  const base = safe.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}width=${width}&quality=${quality}`;
}

export const REVIEW_THUMB_WIDTH = 320;
export const REVIEW_THUMB_QUALITY = 70;

// Map a review's photo fields through reviewPhotoThumb. Returns a new object; the stored
// row is never modified, so the originals stay available for the admin and for re-export.
export function withThumbnailPhotos(review, width = REVIEW_THUMB_WIDTH) {
  const out = { ...review };
  if (Array.isArray(out.photo_urls)) {
    out.photo_urls = out.photo_urls.map((u) => reviewPhotoThumb(u, width)).filter(Boolean);
  }
  if (out.photo_url) {
    out.photo_url = reviewPhotoThumb(out.photo_url, width);
  }
  return out;
}

// Drop unpaired UTF-16 surrogates from scraped text.
// Why: scrapers cap review text with .slice(0, 2000) / .slice(0, 200), which counts UTF-16
// code units, not characters. When the cut lands inside an emoji the string keeps a lone
// high surrogate (e.g. "\ud83d"). PostgREST serializes the whole insert batch into one JSON
// document, so Postgres rejects it with 22P02 "Unicode low surrogate must follow a high
// surrogate" and the ENTIRE batch fails — not just the offending row.
export function stripLoneSurrogates(text) {
  return String(text ?? '').replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    ''
  );
}

// Validate an already-decoded image buffer by magic bytes (JPEG/PNG/WebP) + size.
// Returns { buf, ext, contentType } on success, or { error } with a safe message.
// Used directly by callers that already have a Buffer (e.g. Amazon photo download
// via fetch()), and indirectly by decodeAndValidateImage (base64 → Buffer callers).
export function validateImageBuffer(buf, maxBytes) {
  if (!buf || !buf.length) return { error: 'empty image' };
  if (buf.length > maxBytes) return { error: `image too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` };
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return { error: 'file is not a JPEG/PNG/WebP image' };
  const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
  const contentType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
  return { buf, ext, contentType };
}

// Decode a base64 image and validate it by magic bytes (JPEG/PNG/WebP) + size.
// Returns { buf, ext, contentType } on success, or { error } with a safe message.
export function decodeAndValidateImage(base64, maxBytes) {
  const buf = Buffer.from(base64 || '', 'base64');
  return validateImageBuffer(buf, maxBytes);
}

// Upload a validated review image to Storage and return its public URL.
// productId must be trusted (a real TC UUID) — it forms the storage path.
export async function uploadReviewImage(storeName, productId, buf, ext, contentType) {
  const path = `${storeName}/Reviews/${productId}/photo_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('store-docs').upload(path, buf, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('store-docs').getPublicUrl(path);
  return data?.publicUrl;
}

// Parse a stored review-photo public URL into its Storage object path (store-docs
// bucket). Returns null if it's falsy or not one of ours.
// Public URL form: .../storage/v1/object/public/store-docs/<path>
export function reviewPhotoPath(photoUrl) {
  if (!photoUrl) return null;
  const marker = '/store-docs/';
  const i = String(photoUrl).indexOf(marker);
  if (i === -1) return null; // not one of ours — leave it alone
  return decodeURIComponent(String(photoUrl).slice(i + marker.length));
}

// Delete a review photo from Storage given its public URL. Best-effort: logs and
// swallows failures (a missing object shouldn't block deleting the DB row).
export async function deleteReviewPhoto(photoUrl) {
  const path = reviewPhotoPath(photoUrl);
  if (!path) return;
  const { error } = await supabase.storage.from('store-docs').remove([path]);
  if (error) console.error('[reviews] deleteReviewPhoto failed:', { path, error: error.message });
}

// Delete a batch of review photo URLs from Storage, tolerating per-file failures
// (Promise.allSettled — one bad/already-gone object must not abort the rest) and
// reporting aggregate counts instead of swallowing everything like deleteReviewPhoto
// above. Used by set_review_status's reject hook and the admin orphan-sweep action
// (reviews-cleanup.js) — both need to know how many actually got removed so they can
// log it and surface it in the API response.
export async function deleteReviewPhotosSettled(urls) {
  const paths = Array.from(new Set((urls || []).map(reviewPhotoPath).filter(Boolean)));
  if (!paths.length) return { removed: 0, failed: 0, failures: [] };

  const results = await Promise.allSettled(
    paths.map((path) => supabase.storage.from('store-docs').remove([path]))
  );

  let removed = 0;
  const failures = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled' && !r.value?.error) { removed++; return; }
    const error = r.status === 'fulfilled' ? r.value?.error?.message : (r.reason?.message || String(r.reason));
    failures.push({ path: paths[idx], error });
  });

  return { removed, failed: failures.length, failures };
}

// Mark a product's remaining approved/published reviews dirty so the "needs re-push"
// badge surfaces that the Shopify metafield is now stale (after a published review was
// deleted/rejected). No-op when nothing remains (handled by caller's log).
export async function flagProductNeedsRepush(storeId, productId) {
  await supabase.from('product_reviews')
    .update({ dirty: true })
    .eq('store_id', storeId).eq('product_id', productId)
    .in('status', ['approved', 'published']);
}

// Filter out rows that already exist for this product (same author + body), so bulk
// import / AI re-generation doesn't trip the dedup unique index on the whole batch.
export async function dropExistingDuplicates(db, storeId, productId, rows) {
  if (!rows.length) return rows;
  const { data: existing } = await db.from('product_reviews')
    .select('author, body').eq('store_id', storeId).eq('product_id', productId);
  const seen = new Set((existing || []).map((r) => `${r.author} ${r.body}`));
  const out = [];
  for (const r of rows) {
    const key = `${r.author} ${r.body}`;
    if (seen.has(key)) continue;
    seen.add(key); // also dedups within the same incoming batch
    out.push(r);
  }
  return out;
}

// Insert rows into product_reviews ONE AT A TIME, tolerating a Postgres 23505
// (unique_violation) on the dedup index (store_id, product_id, author, md5(body)) as
// "someone else already inserted this — skip it, keep going" instead of failing the
// whole batch. Defends against the TOCTOU race between dropExistingDuplicates()'s
// pre-check SELECT and these INSERTs — a concurrent import/generate/submit can land in
// that window and win the insert first. A single bulk .insert() would abort every row
// in the batch on the first collision; this mirrors reviews-public.js's per-submission
// 23505 handling (there: one row, "duplicate: true"; here: N rows, aggregated counts).
// Any non-23505 error still throws (real DB errors must not be swallowed).
export async function insertReviewsTolerant(db, rows) {
  let inserted = 0;
  let skipped_duplicates = 0;
  for (const row of rows) {
    const { error } = await db.from('product_reviews').insert(row);
    if (error) {
      if (error.code === '23505') {
        skipped_duplicates++;
        continue;
      }
      throw error;
    }
    inserted++;
  }
  return { inserted, skipped_duplicates };
}

// Insert rows as ONE statement — the fast path for a multi-product import, where
// N products × M rows inserted one at a time would outlast the 55 s Vercel limit.
// Postgres rolls a failed statement back whole, so on a 23505 nothing from the batch
// landed and it is safe to redo it row by row through insertReviewsTolerant (which
// skips just the colliding rows). Any other error throws.
export async function insertReviewsBatch(db, rows) {
  if (!rows.length) return { inserted: 0, skipped_duplicates: 0 };
  const { error } = await db.from('product_reviews').insert(rows);
  if (!error) return { inserted: rows.length, skipped_duplicates: 0 };
  if (error.code !== '23505') throw error;
  return insertReviewsTolerant(db, rows);
}

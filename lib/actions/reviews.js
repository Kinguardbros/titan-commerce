import { supabase, computeSummary, safePhotoUrl, deleteReviewPhoto, flagProductNeedsRepush } from './reviews-shared.js';

// Phase 1 — manual product reviews (list / add / update / delete / status).
// Bulk import (reviews-import.js), AI generation (reviews-ai.js) and photo upload
// (reviews-photo.js) live in sibling modules; all share reviews-shared.js.
// Still no outbound communication: push to Shopify stays a later phase.

// GET: product_reviews_list — { product_id, store_id } → reviews (newest first) + computed summary.
// Filters by BOTH store_id and product_id → each product gets only its own reviews, isolated per store.
export async function product_reviews_list(req, res) {
  const storeId = req.query.store_id;
  const productId = req.query.product_id;
  if (!storeId || !productId) return res.status(400).json({ error: 'store_id and product_id required' });

  const { data, error } = await supabase.from('product_reviews')
    .select('*')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const reviews = data || [];
  return res.status(200).json({ reviews, summary: computeSummary(reviews) });
}

// POST: add_review_manual — insert a pending, source='manual' review.
export async function add_review_manual(req, res) {
  const { store_id, product_id, author, rating, title, body, review_date, photo_url, verified } = req.body;
  if (!store_id || !product_id || !author || !body) {
    return res.status(400).json({ error: 'store_id, product_id, author, and body required' });
  }
  const ratingInt = parseInt(rating, 10);
  if (!(ratingInt >= 1 && ratingInt <= 5)) return res.status(400).json({ error: 'rating must be 1–5' });

  const { data, error } = await supabase.from('product_reviews').insert({
    store_id,
    product_id,
    author,
    rating: ratingInt,
    title: title || null,
    body,
    review_date: review_date || new Date().toISOString().slice(0, 10),
    photo_url: safePhotoUrl(photo_url),
    verified: !!verified,
    source: 'manual',
    status: 'pending',
  }).select().single();
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Added manual review by "${author}" (${ratingInt}★)`,
  });

  return res.status(200).json({ review: data });
}

// POST: update_review — edit a review. If it was published, mark dirty (awaits re-push in F2).
export async function update_review(req, res) {
  const { id, store_id, author, rating, title, body, review_date, photo_url, verified, helpful_count } = req.body;
  if (!id || !store_id) return res.status(400).json({ error: 'id and store_id required' });

  // Scope by store_id so a review can only be mutated within its own store.
  const { data: existing, error: getErr } = await supabase.from('product_reviews')
    .select('status, store_id, review_date').eq('id', id).eq('store_id', store_id).single();
  if (getErr || !existing) return res.status(404).json({ error: 'Review not found' });

  const updates = { updated_at: new Date().toISOString() };
  if (author !== undefined) updates.author = author;
  if (rating !== undefined) {
    const ratingInt = parseInt(rating, 10);
    if (!(ratingInt >= 1 && ratingInt <= 5)) return res.status(400).json({ error: 'rating must be 1–5' });
    updates.rating = ratingInt;
  }
  if (title !== undefined) updates.title = title || null;
  if (body !== undefined) updates.body = body;
  // review_date is NOT NULL — never null it; fall back to the existing value or today.
  if (review_date !== undefined) updates.review_date = review_date || existing.review_date || new Date().toISOString().slice(0, 10);
  if (photo_url !== undefined) updates.photo_url = safePhotoUrl(photo_url);
  if (verified !== undefined) updates.verified = !!verified;
  if (helpful_count !== undefined) {
    const hc = parseInt(helpful_count, 10);
    if (!(hc >= 0)) return res.status(400).json({ error: 'helpful_count must be >= 0' });
    updates.helpful_count = hc;
  }

  // Edited after publication → flag for re-push (the re-push itself lands in F2).
  if (existing.status === 'published') updates.dirty = true;

  const { data, error } = await supabase.from('product_reviews')
    .update(updates).eq('id', id).eq('store_id', store_id).select().single();
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id: existing.store_id, agent: 'REVIEWS', level: 'info',
    message: `Updated review ${id}${updates.dirty ? ' (dirty — awaits re-push)' : ''}`,
  });

  return res.status(200).json({ review: data });
}

// POST: delete_review — delete the row, clean up its Storage photo, and flag the
// product for re-push if the deleted review was already live on Shopify.
export async function delete_review(req, res) {
  const { id, store_id } = req.body;
  if (!id || !store_id) return res.status(400).json({ error: 'id and store_id required' });

  // Read what we need before deleting (scoped to the store).
  const { data: existing } = await supabase.from('product_reviews')
    .select('product_id, status, photo_url').eq('id', id).eq('store_id', store_id).single();
  if (!existing) return res.status(404).json({ error: 'Review not found' });

  const { error } = await supabase.from('product_reviews')
    .delete().eq('id', id).eq('store_id', store_id);
  if (error) throw error;

  // Remove the photo from Storage so abusive images don't linger on a public URL.
  await deleteReviewPhoto(existing.photo_url);

  // If it was live on Shopify, the metafield is now stale → flag remaining reviews dirty.
  let staleLive = false;
  if (existing.status === 'published') {
    await flagProductNeedsRepush(store_id, existing.product_id);
    staleLive = true;
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'warn',
    message: `Deleted review ${id}${staleLive ? ' (was live — product needs re-push)' : ''}`,
  });

  return res.status(200).json({ ok: true, needs_republish: staleLive });
}

// POST: set_review_status — batch approve/reject. { ids: [], status }.
export async function set_review_status(req, res) {
  const { ids, status, store_id } = req.body;
  if (!Array.isArray(ids) || !ids.length || !status || !store_id) {
    return res.status(400).json({ error: 'ids (array), status, and store_id required' });
  }
  const allowed = ['pending', 'approved', 'published', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  // If we're taking reviews DOWN from published (→ rejected/pending), note which products
  // were live so we can flag them for re-push (their Shopify metafield is now stale).
  let liveProducts = [];
  if (status === 'rejected' || status === 'pending') {
    const { data: live } = await supabase.from('product_reviews')
      .select('product_id').in('id', ids).eq('store_id', store_id).eq('status', 'published');
    liveProducts = [...new Set((live || []).map((r) => r.product_id))];
  }

  // Scope by store_id so a batch can only touch the caller's own reviews.
  const { data, error } = await supabase.from('product_reviews')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('store_id', store_id)
    .select('id');
  if (error) throw error;

  // Flag affected products so the "needs re-push" badge surfaces the staleness.
  for (const pid of liveProducts) await flagProductNeedsRepush(store_id, pid);

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Set ${data?.length || 0} review(s) → ${status}${liveProducts.length ? ` (${liveProducts.length} product(s) need re-push)` : ''}`,
  });

  return res.status(200).json({ ok: true, updated: data?.length || 0, needs_republish: liveProducts.length > 0 });
}

// POST: seed_reviews_helpful — { store_id, product_id, min, max } → give each of the
// product's reviews a random helpful_count in [min, max] (per-row random via RPC).
export async function seed_reviews_helpful(req, res) {
  const { store_id, product_id, min, max } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  const lo = parseInt(min, 10), hi = parseInt(max, 10);
  if (!(lo >= 0) || !(hi >= 0)) return res.status(400).json({ error: 'min and max must be >= 0' });

  const { data, error } = await supabase.rpc('seed_reviews_helpful', {
    p_store_id: store_id, p_product_id: product_id, p_min: lo, p_max: hi,
  });
  if (error) throw error;

  // Reviews changed → if any were published, flag for re-push.
  await flagProductNeedsRepush(store_id, product_id);

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Seeded helpful (${lo}–${hi}) on ${data || 0} review(s)`,
  });

  return res.status(200).json({ ok: true, updated: data || 0 });
}

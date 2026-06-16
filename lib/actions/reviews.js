import { supabase, computeSummary } from './reviews-shared.js';

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
    photo_url: photo_url || null,
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
  const { id, store_id, author, rating, title, body, review_date, photo_url, verified } = req.body;
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
  if (photo_url !== undefined) updates.photo_url = photo_url || null;
  if (verified !== undefined) updates.verified = !!verified;

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

// POST: delete_review — hard delete (DB only).
export async function delete_review(req, res) {
  const { id, store_id } = req.body;
  if (!id || !store_id) return res.status(400).json({ error: 'id and store_id required' });

  // Scope by store_id; only delete (and report) when the row belongs to the store.
  const { data: deleted, error } = await supabase.from('product_reviews')
    .delete().eq('id', id).eq('store_id', store_id).select('id');
  if (error) throw error;
  if (!deleted?.length) return res.status(404).json({ error: 'Review not found' });

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'warn',
    message: `Deleted review ${id}`,
  });

  return res.status(200).json({ ok: true });
}

// POST: set_review_status — batch approve/reject. { ids: [], status }.
export async function set_review_status(req, res) {
  const { ids, status, store_id } = req.body;
  if (!Array.isArray(ids) || !ids.length || !status || !store_id) {
    return res.status(400).json({ error: 'ids (array), status, and store_id required' });
  }
  const allowed = ['pending', 'approved', 'published', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  // Scope by store_id so a batch can only touch the caller's own reviews.
  const { data, error } = await supabase.from('product_reviews')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('store_id', store_id)
    .select('id');
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Set ${data?.length || 0} review(s) → ${status}`,
  });

  return res.status(200).json({ ok: true, updated: data?.length || 0 });
}

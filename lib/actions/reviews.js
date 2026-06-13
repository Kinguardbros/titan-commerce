import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../rate-limit.js';

// Phase 1 — manual product reviews (list / add / update / delete / status).
// Phase 3 — bulk CSV / Google Sheets import (import_reviews_csv).
// Still no outbound communication: push to Shopify and photo upload are later phases.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Summary (★ average + count) is computed from approved + published reviews only.
function computeSummary(reviews) {
  const counted = (reviews || []).filter((r) => r.status === 'approved' || r.status === 'published');
  if (!counted.length) return { count: 0, average: 0 };
  const sum = counted.reduce((s, r) => s + r.rating, 0);
  return { count: counted.length, average: Math.round((sum / counted.length) * 10) / 10 };
}

// GET: product_reviews_list — { product_id, store_id } → reviews (newest first) + computed summary.
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
  const { id, author, rating, title, body, review_date, photo_url, verified } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { data: existing, error: getErr } = await supabase.from('product_reviews')
    .select('status, store_id').eq('id', id).single();
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
  if (review_date !== undefined) updates.review_date = review_date || null;
  if (photo_url !== undefined) updates.photo_url = photo_url || null;
  if (verified !== undefined) updates.verified = !!verified;

  // Edited after publication → flag for re-push (the re-push itself lands in F2).
  if (existing.status === 'published') updates.dirty = true;

  const { data, error } = await supabase.from('product_reviews')
    .update(updates).eq('id', id).select().single();
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id: existing.store_id, agent: 'REVIEWS', level: 'info',
    message: `Updated review ${id}${updates.dirty ? ' (dirty — awaits re-push)' : ''}`,
  });

  return res.status(200).json({ review: data });
}

// POST: delete_review — hard delete (DB only).
export async function delete_review(req, res) {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { data: existing } = await supabase.from('product_reviews')
    .select('store_id').eq('id', id).single();

  const { error } = await supabase.from('product_reviews').delete().eq('id', id);
  if (error) throw error;

  await supabase.from('pipeline_log').insert({
    store_id: existing?.store_id || null, agent: 'REVIEWS', level: 'warn',
    message: `Deleted review ${id}`,
  });

  return res.status(200).json({ ok: true });
}

// POST: set_review_status — batch approve/reject. { ids: [], status }.
export async function set_review_status(req, res) {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || !ids.length || !status) {
    return res.status(400).json({ error: 'ids (array) and status required' });
  }
  const allowed = ['pending', 'approved', 'published', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  const { data, error } = await supabase.from('product_reviews')
    .update({ status, updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id, store_id');
  if (error) throw error;

  const storeId = data?.[0]?.store_id || null;
  await supabase.from('pipeline_log').insert({
    store_id: storeId, agent: 'REVIEWS', level: 'info',
    message: `Set ${data?.length || 0} review(s) → ${status}`,
  });

  return res.status(200).json({ ok: true, updated: data?.length || 0 });
}

// ── Phase 3: bulk import ─────────────────────────────────────────────────────

// Minimal CSV parser (no dependency) — respects "..."-quoted fields with embedded
// commas/newlines and "" escaping. Header line is required and skipped.
// Expected columns: author,rating,title,body,date,photo_url,verified
function parseReviewsCsv(text) {
  const records = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); records.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); records.push(row); }

  const rows = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  rows.shift(); // drop header

  return rows.map((cells) => {
    const [author, rating, title, body, date, photo_url, verified] = cells.map((c) => (c ?? '').trim());
    return {
      author, rating: parseInt(rating, 10), title, body,
      review_date: date || null,
      photo_url: photo_url || null,
      verified: ['1', 'true', 'yes'].includes((verified || '').toLowerCase()),
    };
  });
}

// Turn a Google Sheets share URL into its CSV export endpoint.
function toSheetsCsvUrl(url) {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

// POST: import_reviews_csv — bulk insert from CSV text or a Google Sheets URL.
// { store_id, product_id, csv?, sheet_url? } → { inserted, skipped }. All rows land as pending/source='csv'.
export async function import_reviews_csv(req, res) {
  if (!await rateLimit('import_reviews_csv', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded — try again later' });
  }
  const { store_id, product_id, sheet_url } = req.body;
  let { csv } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });

  // Google Sheets URL → fetch its CSV export server-side (avoids browser CORS).
  if (!csv && sheet_url) {
    const csvUrl = toSheetsCsvUrl(sheet_url);
    if (!csvUrl) return res.status(400).json({ error: 'Not a valid Google Sheets URL' });
    const r = await fetch(csvUrl);
    if (!r.ok) return res.status(400).json({ error: 'Failed to fetch sheet — is it shared as "anyone with the link"?' });
    csv = await r.text();
  }
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv or sheet_url required' });

  const parsed = parseReviewsCsv(csv);
  const valid = [];
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const r of parsed) {
    if (!r.author || !r.body || !(r.rating >= 1 && r.rating <= 5)) { skipped++; continue; }
    valid.push({
      store_id, product_id,
      author: r.author, rating: r.rating,
      title: r.title || null, body: r.body,
      review_date: r.review_date || today,
      photo_url: r.photo_url, verified: r.verified,
      source: 'csv', status: 'pending',
    });
  }

  let inserted = 0;
  if (valid.length) {
    const { data, error } = await supabase.from('product_reviews').insert(valid).select('id');
    if (error) throw error;
    inserted = data?.length || 0;
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Imported ${inserted} review(s) from ${sheet_url ? 'Google Sheets' : 'CSV'} (${skipped} skipped)`,
  });

  return res.status(200).json({ inserted, skipped });
}

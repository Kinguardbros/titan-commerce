import { supabase, deleteReviewPhotosSettled } from './reviews-shared.js';
import { hasPermission } from '../permissions.js';

// Admin orphan-photo sweep. Companion to the set_review_status('rejected') hook in
// reviews.js: that hook only fires on new rejects going forward, so it doesn't reach
// (a) reviews rejected before this deploy, and (b) reviews that just sit `pending`
// forever and are never actioned either way. Both leak Storage objects indefinitely.
//
// This is a cross-store sweep with no store_id in the request (there's nothing to
// scope it to — "clean up every store's orphans" is the whole point), so it's gated
// on admin:users rather than products:edit + hasStoreAccess like the rest of
// reviews.js — admin:users is already the codebase's "full admin operator" gate used
// by users_list/create_user/etc, none of which are store-scoped either (lib/actions/
// users.js). No reviews:manage / admin:* permission exists in lib/permissions.js's
// closed PERMISSION_LIST — reusing admin:users avoids inventing a new permission for
// a single admin-only sweep button.
export async function cleanup_orphan_review_photos(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase.from('product_reviews')
    .select('id, store_id, photo_urls, photo_url')
    .in('status', ['pending', 'rejected'])
    .lt('created_at', cutoff);
  if (error) throw error;

  // Skip rows the DB predicate above can't express in one shot (no photos at all) —
  // .or('photo_url.not.is.null,photo_urls.not.is.null') is possible via PostgREST but
  // filtering the (typically small) candidate set in JS keeps this readable and avoids
  // depending on .or() string-building for a correctness-critical query.
  const candidates = (rows || []).filter((r) => r.photo_url || (Array.isArray(r.photo_urls) && r.photo_urls.length));

  let files_removed = 0;
  let files_failed = 0;
  let reviews_cleaned = 0;
  // Grouped purely for the pipeline_log entries below (one per store, matching every
  // other reviews action's per-store logging convention) — Storage cleanup and clearing
  // the DB photo fields still happen once per review row regardless of store.
  const perStore = new Map();

  for (const row of candidates) {
    const urls = [
      ...(Array.isArray(row.photo_urls) ? row.photo_urls : []),
      ...(row.photo_url ? [row.photo_url] : []),
    ];

    const result = await deleteReviewPhotosSettled(urls);
    files_removed += result.removed;
    files_failed += result.failed;
    if (result.failed) {
      console.error('[reviews] cleanup_orphan_review_photos: photo removal failures', {
        review_id: row.id, failures: result.failures,
      });
    }

    const { error: updErr } = await supabase.from('product_reviews')
      .update({ photo_url: null, photo_urls: null })
      .eq('id', row.id);
    if (updErr) throw updErr;
    reviews_cleaned++;

    perStore.set(row.store_id, (perStore.get(row.store_id) || 0) + 1);
  }

  for (const [store_id, count] of perStore) {
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'REVIEWS', level: 'info',
      message: `Orphan photo sweep: cleaned ${count} review(s) (pending/rejected, 30+ days old)`,
      user_id: req.user?.user_id || null, initiator: 'user',
    });
  }

  return res.status(200).json({ reviews_cleaned, files_removed, files_failed });
}

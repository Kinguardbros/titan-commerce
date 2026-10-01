// "Approve all pending" in the Reviews panel. set_review_status filters with an
// `id=in.(...)` query string, so ids go out in chunks to keep the URL short.
const CHUNK = 100;

// setStatus(ids, status, storeId) → { updated } — api.js setReviewStatus.
export async function approveAllPending(reviews, storeId, setStatus) {
  const ids = (reviews || []).filter((r) => r.status === 'pending').map((r) => r.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await setStatus(ids.slice(i, i + CHUNK), 'approved', storeId);
    updated += res?.updated || 0;
  }
  return updated;
}

// "Copy to collection…": one copy_reviews_to_products call per target product, one
// after another, so each request stays small. A failed product is reported and the
// rest still run. onProgress(done, total) drives the modal's counter.
export async function copyToProducts(targetIds, copyOne, onProgress) {
  const result = { copied: 0, duplicates: 0, failed: [] };
  onProgress(0, targetIds.length);
  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i];
    try {
      const res = await copyOne(id);
      result.copied += res?.copied || 0;
      result.duplicates += res?.duplicates || 0;
    } catch (err) {
      console.error('[review-bulk] copy to product failed:', { id, message: err.message });
      result.failed.push({ id, error: err.message });
    }
    onProgress(i + 1, targetIds.length);
  }
  return result;
}

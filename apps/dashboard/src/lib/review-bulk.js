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

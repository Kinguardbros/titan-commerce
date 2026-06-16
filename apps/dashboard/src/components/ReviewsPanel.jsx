import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { getProductReviews, addReviewManual, updateReview, deleteReview, setReviewStatus } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import ReviewDetail from './ReviewDetail';
import './ReviewsPanel.css';

// Lazy — pulls in the xlsx parser only when the import modal is actually opened.
const ImportReviews = lazy(() => import('./ImportReviews'));
const GenerateReviews = lazy(() => import('./GenerateReviews'));

const STATUS_BADGE = {
  pending: 'rv-badge--pending',
  approved: 'rv-badge--approved',
  published: 'rv-badge--published',
  rejected: 'rv-badge--rejected',
};

function Stars({ rating }) {
  return (
    <span className="rv-stars" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? 'rv-star rv-star--on' : 'rv-star'}>★</span>
      ))}
    </span>
  );
}

// Phase 1 reviews manager — modal opened from the ProductWorkspace topbar.
// Manual add / edit / approve / reject / delete. No outbound push (that's F2).
// `store` is passed by ProductWorkspace and consumed in F2 (Push-to-Shopify admin gate); unused in F1.
export default function ReviewsPanel({ product, storeId, onClose }) {
  const toast = useToast();
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({ count: 0, average: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // review object being edited
  const [adding, setAdding] = useState(false);     // new manual review form open
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false); // import sub-modal open
  const [generating, setGenerating] = useState(false); // AI generate dialog open

  const fetchReviews = useCallback(async () => {
    try {
      const data = await getProductReviews(product.id, storeId);
      setReviews(data?.reviews || []);
      setSummary(data?.summary || { count: 0, average: 0 });
    } catch (err) {
      console.error('[ReviewsPanel] fetch failed:', err);
      toast.error(`Failed to load reviews: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [product.id, storeId, toast]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const closeDetail = () => { setSelected(null); setAdding(false); };

  const handleSave = async (form) => {
    setSaving(true);
    try {
      if (adding) {
        await addReviewManual({ store_id: storeId, product_id: product.id, ...form });
        toast.success('Review added');
      } else {
        await updateReview({ id: selected.id, store_id: storeId, ...form });
        toast.success('Review saved');
      }
      closeDetail();
      await fetchReviews();
    } catch (err) {
      console.error('[ReviewsPanel] save failed:', err);
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id, status) => {
    try {
      await setReviewStatus([id], status, storeId);
      toast.success(`Review ${status}`);
      closeDetail();
      await fetchReviews();
    } catch (err) {
      console.error('[ReviewsPanel] status update failed:', err);
      toast.error(`Update failed: ${err.message}`);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteReview(id, storeId);
      toast.success('Review deleted');
      closeDetail();
      await fetchReviews();
    } catch (err) {
      console.error('[ReviewsPanel] delete failed:', err);
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const detailOpen = adding || selected;

  return (
    <div className="rv-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="rv-modal" role="dialog" aria-modal="true" aria-label={`Reviews: ${product.title}`}
        onClick={(e) => e.stopPropagation()}>
        <button className="rv-close" aria-label="Close modal" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="rv-header">
          <div>
            <div className="rv-title">Reviews</div>
            <div className="rv-product">{product.title}</div>
          </div>
          <div className="rv-header-right">
            <div className="rv-summary">
              <span className="rv-summary-avg">★ {summary.average || '—'}</span>
              <span className="rv-summary-count">{summary.count} review{summary.count === 1 ? '' : 's'}</span>
            </div>
            <button className="rv-import-btn" onClick={() => setGenerating(true)}>Generate (AI)</button>
            <button className="rv-import-btn" onClick={() => setImporting(true)}>Import</button>
            <button className="rv-add-btn" onClick={() => { setSelected(null); setAdding(true); }}>+ Add</button>
          </div>
        </div>

        <div className="rv-content">
          {/* Table */}
          <div className={`rv-table-wrap${detailOpen ? ' rv-table-wrap--narrow' : ''}`}>
            {loading ? (
              <div className="rv-loading">Loading reviews…</div>
            ) : reviews.length === 0 ? (
              <div className="rv-empty">No reviews yet. Click <strong>+ Add</strong> to create one.</div>
            ) : (
              <table className="rv-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Author</th>
                    <th>Rating</th>
                    <th>Title</th>
                    <th>Body</th>
                    <th>Source</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id} className={`rv-row${selected?.id === r.id ? ' rv-row--active' : ''}`}
                      onClick={() => { setAdding(false); setSelected(r); }}>
                      <td className="rv-cell-photo">
                        {r.photo_url
                          ? <img className="rv-thumb" src={r.photo_url} alt="" />
                          : <span className="rv-thumb-empty">—</span>}
                      </td>
                      <td>
                        <span className="rv-author">{r.author}</span>
                        {r.verified && <span className="rv-verified" title="Verified purchase">✓</span>}
                      </td>
                      <td><Stars rating={r.rating} /></td>
                      <td className="rv-cell-title">{r.title || '—'}</td>
                      <td className="rv-cell-body">{r.body}</td>
                      <td><span className="rv-source">{r.source}</span></td>
                      <td>
                        <span className={`rv-badge ${STATUS_BADGE[r.status] || ''}`}>{r.status}</span>
                        {r.dirty && <span className="rv-changed" title="Edited after publish — awaits re-push">changed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail panel */}
          {detailOpen && (
            <ReviewDetail
              key={adding ? 'new' : selected.id}
              review={adding ? null : selected}
              isNew={adding}
              saving={saving}
              storeId={storeId}
              productId={product.id}
              onSave={handleSave}
              onApprove={() => handleStatus(selected.id, 'approved')}
              onReject={() => handleStatus(selected.id, 'rejected')}
              onDelete={() => handleDelete(selected.id)}
              onClose={closeDetail}
            />
          )}
        </div>

        {importing && (
          <Suspense fallback={null}>
            <ImportReviews
              storeId={storeId}
              productId={product.id}
              onClose={() => setImporting(false)}
              onImported={fetchReviews}
            />
          </Suspense>
        )}
        {generating && (
          <Suspense fallback={null}>
            <GenerateReviews
              storeId={storeId}
              productId={product.id}
              onClose={() => setGenerating(false)}
              onGenerated={fetchReviews}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

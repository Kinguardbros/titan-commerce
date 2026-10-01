import { useState } from 'react';
import { copyReviewsToProduct } from '../lib/api';
import { copyToProducts } from '../lib/review-bulk';
import { useToast } from '../hooks/useToast.jsx';
import ReviewTargetPicker from './ReviewTargetPicker';

// Reviews → "Copy to collection…": copy this product's live (approved + published) reviews
// onto other products of one of its collections. One request per product, with progress.
export default function CopyReviewsModal({ storeId, product, liveCount, onClose }) {
  const toast = useToast();
  const [targetIds, setTargetIds] = useState([product.id]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } while copying

  const extraIds = targetIds.filter((id) => id !== product.id);

  const handleCopy = async () => {
    setBusy(true);
    try {
      const { copied, duplicates, failed } = await copyToProducts(
        extraIds,
        (id) => copyReviewsToProduct(storeId, product.id, id),
        (done, total) => setProgress({ done, total }),
      );
      const extra = duplicates ? ` · ${duplicates} already there` : '';
      toast.success(`Copied ${copied} review${copied === 1 ? '' : 's'} to ${extraIds.length - failed.length} product${extraIds.length - failed.length === 1 ? '' : 's'}${extra}`);
      if (failed.length) toast.error(`${failed.length} product${failed.length === 1 ? '' : 's'} failed: ${failed[0].error}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-import-overlay" onClick={busy ? undefined : onClose}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}>
      <div className="rv-import-modal" role="dialog" aria-modal="true" aria-label="Copy reviews to collection"
        onClick={(e) => e.stopPropagation()}>
        <button className="rv-close" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        <div className="rv-title">Copy Reviews to Collection</div>
        <div className="rv-import-sub">
          The <strong>{liveCount}</strong> live review{liveCount === 1 ? '' : 's'} of this product are copied as{' '}
          <strong>pending</strong> to each selected product. Copies are not marked Verified and start at 0 Helpful;
          reviews a product already has are skipped.
        </div>

        <ReviewTargetPicker storeId={storeId} productId={product.id} selected={targetIds} onChange={setTargetIds} />

        <div className="rv-detail-actions rv-import-actions">
          {progress && busy && <span className="rv-import-count">Copying {progress.done} / {progress.total}…</span>}
          <button className="rv-btn rv-btn--save" disabled={busy || !extraIds.length} onClick={handleCopy}>
            {busy ? 'Copying…' : `Copy to ${extraIds.length} product${extraIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

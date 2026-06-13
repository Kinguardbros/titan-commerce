import { useState } from 'react';
import { generateReviewsAi } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';

// Phase 4 — AI review generation dialog. Claude writes N reviews from product
// title+description; rows land as pending for review. Legal note: the operator
// is responsible for truthfulness — don't publish purely fabricated reviews as real.
export default function GenerateReviews({ storeId, productId, onClose, onGenerated }) {
  const toast = useToast();
  const [count, setCount] = useState(5);
  const [tone, setTone] = useState('mix');
  const [busy, setBusy] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const { inserted } = await generateReviewsAi(storeId, productId, count, tone);
      toast.success(`Generated ${inserted} review${inserted === 1 ? '' : 's'} — review & approve them`);
      onGenerated();
      onClose();
    } catch (err) {
      console.error('[GenerateReviews] generation failed:', err);
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-import-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="rv-import-modal rv-gen-modal" role="dialog" aria-modal="true" aria-label="Generate reviews with AI"
        onClick={(e) => e.stopPropagation()}>
        <button className="rv-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="rv-title">Generate Reviews (AI)</div>
        <div className="rv-import-sub">Claude writes them from the product details. Rows land as <strong>pending</strong>.</div>

        <label className="rv-field-label">How many</label>
        <div className="rv-gen-pills">
          {[3, 5, 10].map((n) => (
            <button key={n} type="button"
              className={`rv-gen-pill${count === n ? ' rv-gen-pill--on' : ''}`}
              onClick={() => setCount(n)}>{n}</button>
          ))}
        </div>

        <label className="rv-field-label">Tone</label>
        <div className="rv-gen-tone">
          <label className={`rv-gen-radio${tone === 'positive' ? ' rv-gen-radio--on' : ''}`}>
            <input type="radio" name="tone" checked={tone === 'positive'} onChange={() => setTone('positive')} />
            <span><strong>Positive</strong> — mostly 5★</span>
          </label>
          <label className={`rv-gen-radio${tone === 'mix' ? ' rv-gen-radio--on' : ''}`}>
            <input type="radio" name="tone" checked={tone === 'mix'} onChange={() => setTone('mix')} />
            <span><strong>Realistic mix</strong> — incl. occasional 3★</span>
          </label>
        </div>

        <div className="rv-gen-note">
          ⚠ You're responsible for truthfulness — don't publish fabricated reviews as genuine (EU/FTC).
        </div>

        <div className="rv-detail-actions rv-import-actions">
          <button className="rv-btn rv-btn--save" disabled={busy} onClick={handleGenerate}>
            {busy ? 'Generating…' : `Generate ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

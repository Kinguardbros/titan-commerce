import { useState, useEffect } from 'react';
import { getSizeCharts, assignSizeChartProducts, unassignSizeChartProducts } from '../lib/api';
import './AssignSizeChartModal.css';

// Shared by two call sites: ProductWorkspace's per-product "Size Chart" widget (a single
// product id) and Products.jsx's bulk toolbar (a filtered selection). The operation is the
// same either way — point N Titan product ids at a chart, or clear the reference — so one
// modal covers both instead of duplicating the picker.
export default function AssignSizeChartModal({ storeId, productIds, currentChartId = null, onClose, onDone }) {
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(currentChartId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!storeId) return;
    getSizeCharts(storeId)
      .then((data) => setCharts(data?.charts || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [storeId]);

  const count = productIds.length;

  const handleAssign = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assignSizeChartProducts(storeId, selected, productIds);
      const chartName = charts.find((c) => c.id === selected)?.name || null;
      onDone({ ...result, action: 'assign', chartId: selected, chartName });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await unassignSizeChartProducts(storeId, productIds);
      onDone({ ...result, action: 'remove' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="asc-modal__backdrop" role="dialog" aria-modal="true" aria-label="Assign size chart">
      <div className="asc-modal">
        <div className="asc-modal__title">Assign size chart</div>
        <div className="asc-modal__count">{count} product{count !== 1 ? 's' : ''} selected</div>

        {loading ? (
          <div className="asc-modal__loading">Loading charts…</div>
        ) : (
          <select className="asc-modal__select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose a chart…</option>
            {charts.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.row_count} sizes, {c.product_count} products)</option>
            ))}
          </select>
        )}

        {error && <div className="asc-modal__error">{error}</div>}

        <div className="asc-modal__actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="asc-modal__remove" onClick={handleRemove} disabled={busy}>
            {busy ? 'Working…' : 'Remove chart'}
          </button>
          <button type="button" className="asc-modal__confirm" onClick={handleAssign} disabled={busy || !selected}>
            {busy ? 'Working…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

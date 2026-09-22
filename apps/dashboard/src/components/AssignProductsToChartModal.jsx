import { useState, useEffect, useMemo } from 'react';
import { getAllProducts, assignSizeChartProducts } from '../lib/api';
import './AssignProductsToChartModal.css';

// The other direction of AssignSizeChartModal: here we already know the chart and are
// picking which products should point at it (opened from a chart's detail view — task
// item 3, "from a chart, see the products using it and add ... products").
export default function AssignProductsToChartModal({ storeId, chartId, alreadyAssignedIds = [], onClose, onDone }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!storeId) return;
    getAllProducts(storeId).then((list) => setProducts(list || [])).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [storeId]);

  const assignedSet = useMemo(() => new Set(alreadyAssignedIds), [alreadyAssignedIds]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !assignedSet.has(p.id) && (!q || p.title.toLowerCase().includes(q)));
  }, [products, search, assignedSet]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleAssign = async () => {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assignSizeChartProducts(storeId, chartId, [...selected]);
      onDone(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apc-modal__backdrop" role="dialog" aria-modal="true" aria-label="Add products to size chart">
      <div className="apc-modal">
        <div className="apc-modal__title">Add products to this chart</div>
        <input className="apc-modal__search" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? (
          <div className="apc-modal__loading">Loading products…</div>
        ) : (
          <ul className="apc-modal__list">
            {filtered.slice(0, 200).map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  {p.title}
                </label>
              </li>
            ))}
            {filtered.length === 0 && <li className="apc-modal__empty">No matching products.</li>}
          </ul>
        )}
        {error && <div className="apc-modal__error">{error}</div>}
        <div className="apc-modal__actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="apc-modal__confirm" onClick={handleAssign} disabled={busy || !selected.size}>
            {busy ? 'Working…' : `Add ${selected.size || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { getSizeCharts, getSizeChartDetail, duplicateSizeChart, unassignSizeChartProducts } from '../lib/api';
import SizeChartTableEditor from '../components/SizeChartTableEditor';
import AssignProductsToChartModal from '../components/AssignProductsToChartModal';
import { useToast } from '../hooks/useToast.jsx';
import './SizeCharts.css';

export default function SizeCharts({ storeId }) {
  const toast = useToast();
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [legacyTextCount, setLegacyTextCount] = useState(0);
  const [selectedId, setSelectedId] = useState(null); // chart gid, or 'new'
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const refresh = useCallback(() => {
    if (!storeId) return;
    setLoading(true);
    getSizeCharts(storeId)
      .then((data) => { setCharts(data?.charts || []); setLegacyTextCount(data?.legacy_text_count || 0); })
      .catch((err) => toast.error(`Failed to load size charts: ${err.message}`))
      .finally(() => setLoading(false));
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSelectedId(null); setDetail(null); refresh(); }, [storeId, refresh]);

  const openChart = useCallback(async (chartId) => {
    setSelectedId(chartId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await getSizeChartDetail(storeId, chartId);
      setDetail(data);
    } catch (err) {
      toast.error(`Failed to load chart: ${err.message}`);
    } finally {
      setDetailLoading(false);
    }
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDuplicate = async (chart, e) => {
    e.stopPropagation();
    try {
      const result = await duplicateSizeChart(storeId, chart.id);
      toast.success(`Duplicated as "${result.chart.name}"`);
      refresh();
    } catch (err) {
      toast.error(`Duplicate failed: ${err.message}`);
    }
  };

  const handleRemoveProduct = async (productId) => {
    try {
      await unassignSizeChartProducts(storeId, [productId]);
      toast.success('Removed from this chart');
      openChart(selectedId);
      refresh();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
  };

  const handleSaved = (chart) => {
    refresh();
    openChart(chart.id);
  };

  const handleClose = () => { setSelectedId(null); setDetail(null); };

  return (
    <div className="szc-page">
      <div className="szc-header">
        <div>
          <div className="szc-title">Size Charts</div>
          <div className="szc-subtitle">
            {charts.length} chart{charts.length !== 1 ? 's' : ''}
            {legacyTextCount > 0 && ` · ${legacyTextCount} product${legacyTextCount !== 1 ? 's' : ''} still carry the old text metafield (not read by the theme)`}
          </div>
        </div>
        <button className="szc-create-btn" onClick={() => { setSelectedId('new'); setDetail(null); }}>+ Create new</button>
      </div>

      <div className="szc-body">
        <div className="szc-list">
          {loading ? (
            <div className="szc-loading">Loading…</div>
          ) : charts.length === 0 ? (
            <div className="szc-empty">No size charts yet for this store.</div>
          ) : (
            <table className="szc-table">
              <thead><tr><th>Name</th><th>Handle</th><th>Columns</th><th>Rows</th><th>Unit</th><th>Products</th><th></th></tr></thead>
              <tbody>
                {charts.map((c) => (
                  <tr key={c.id} className={selectedId === c.id ? 'is-active' : ''} onClick={() => openChart(c.id)}>
                    <td>{c.name}</td>
                    <td className="szc-mono">{c.handle}</td>
                    <td className="szc-cols">{c.columns.join(', ')}</td>
                    <td>{c.row_count}</td>
                    <td>{c.unit}</td>
                    <td>{c.product_count}</td>
                    <td><button className="szc-dup-btn" onClick={(e) => handleDuplicate(c, e)}>Duplicate</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedId && (
          <div className="szc-detail">
            <div className="szc-detail__header">
              <div className="szc-detail__title">{selectedId === 'new' ? 'New size chart' : (detail?.chart?.name || '…')}</div>
              <button className="szc-close" onClick={handleClose}>Close</button>
            </div>

            {selectedId !== 'new' && detailLoading ? (
              <div className="szc-loading">Loading…</div>
            ) : (
              <>
                <SizeChartTableEditor
                  storeId={storeId}
                  chart={selectedId === 'new' ? null : detail?.chart}
                  initialValidation={detail?.validation}
                  onSaved={handleSaved}
                  onCancel={handleClose}
                />

                {selectedId !== 'new' && (
                  <div className="szc-assigned">
                    <div className="szc-assigned__header">
                      <div className="szc-assigned__title">Products using this chart ({detail?.products?.length || 0})</div>
                      <button onClick={() => setShowAssign(true)}>+ Add products</button>
                    </div>
                    {detail?.products?.length ? (
                      <ul className="szc-assigned__list">
                        {detail.products.map((p) => (
                          <li key={p.shopify_id}>
                            <span>{p.title}</span>
                            {p.product_id ? (
                              <button className="szc-remove-btn" onClick={() => handleRemoveProduct(p.product_id)}>Remove</button>
                            ) : (
                              <span className="szc-not-synced" title="Not yet synced into Titan — run a Shopify sync to manage it here">not synced</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="szc-empty">No products assigned yet.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showAssign && selectedId && selectedId !== 'new' && (
        <AssignProductsToChartModal
          storeId={storeId}
          chartId={selectedId}
          alreadyAssignedIds={(detail?.products || []).map((p) => p.product_id).filter(Boolean)}
          onClose={() => setShowAssign(false)}
          onDone={(result) => {
            setShowAssign(false);
            toast.success(`Assigned to ${result.updated} product${result.updated !== 1 ? 's' : ''}`);
            openChart(selectedId);
            refresh();
          }}
        />
      )}
    </div>
  );
}

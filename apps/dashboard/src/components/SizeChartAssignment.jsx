import { useState } from 'react';
import AssignSizeChartModal from './AssignSizeChartModal';
import { useToast } from '../hooks/useToast.jsx';
import './SizeChartAssignment.css';

// Replaces the old SizeChartEditor.jsx mount in ProductDetail.jsx (retired 2026-09-22 along
// with the plain-text custom.size_chart_text mechanism it edited). This widget only shows
// which size_chart metaobject the product currently references and lets the user
// (re)assign or remove it — editing a chart's actual table lives in the Size Charts tab
// (SizeCharts.jsx / SizeChartTableEditor.jsx), one editor for a table shared by many
// products rather than a per-product copy.
export default function SizeChartAssignment({ product, storeId }) {
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const [current, setCurrent] = useState({
    has: !!product.has_size_chart,
    name: product.size_chart_name || null,
  });

  const handleDone = (result) => {
    setShowModal(false);
    if (result.action === 'assign') {
      setCurrent({ has: true, name: result.chartName });
      toast.success(`Assigned "${result.chartName || 'chart'}"`);
    } else {
      setCurrent({ has: false, name: null });
      toast.success('Size chart removed');
    }
  };

  return (
    <div className="pd-card">
      <div className="pd-card-heading">Size Chart</div>
      {current.has ? (
        <div className="sca-current">
          <span className="sca-name">{current.name || 'Assigned'}</span>
          <button className="sca-btn" onClick={() => setShowModal(true)}>Change…</button>
        </div>
      ) : (
        <div className="sca-current">
          <span className="sca-empty">No size chart assigned</span>
          <button className="sca-btn" onClick={() => setShowModal(true)}>Assign…</button>
        </div>
      )}
      <div className="sca-hint">Table content, columns and rows are edited in the Size Charts tab — a chart is shared by every product assigned to it.</div>

      {showModal && (
        <AssignSizeChartModal
          storeId={storeId}
          productIds={[product.id]}
          onClose={() => setShowModal(false)}
          onDone={handleDone}
        />
      )}
    </div>
  );
}

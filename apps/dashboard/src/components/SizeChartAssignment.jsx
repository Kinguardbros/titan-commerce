import { useState, useRef } from 'react';
import AssignSizeChartModal from './AssignSizeChartModal';
import SizeChartTableEditor from './SizeChartTableEditor';
import { parseCsvTable } from '../lib/size-chart-csv';
import { parseSizeChartImage, assignSizeChartProducts } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './SizeChartAssignment.css';

// Replaces the old SizeChartEditor.jsx mount in ProductDetail.jsx (retired 2026-09-22 along
// with the plain-text custom.size_chart_text mechanism it edited). This widget only shows
// which size_chart metaobject the product currently references and lets the user
// (re)assign or remove it — editing a chart's actual table lives in the Size Charts tab
// (SizeCharts.jsx / SizeChartTableEditor.jsx), one editor for a table shared by many
// products rather than a per-product copy.
// 2026-10-07: "Import from image" — photo of a size table → Claude Vision → the chart editor
// pre-filled (review before saving) → Save creates a NEW chart (free handle, never overwrites a
// shared one) and assigns it to this product.
export default function SizeChartAssignment({ product, storeId }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [showModal, setShowModal] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState(null); // chart pre-filled from an image, open in the editor
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

  const handleImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const data = await parseSizeChartImage(dataUrl);
      const table = data?.csv ? parseCsvTable(data.csv) : null;
      if (!table) {
        toast.error('Could not extract a table from that image');
        return;
      }
      setDraft({ name: product.title, columns: table.columns, rows: table.rows, unit: 'cm', note: '' });
      toast.success('Size chart extracted — check it, then Save');
    } catch (err) {
      console.error('[SizeChartAssignment] image import failed:', err);
      toast.error(`Image import failed: ${err.message}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDraftSaved = async (chart) => {
    try {
      await assignSizeChartProducts(storeId, chart.id, [product.id]);
      setCurrent({ has: true, name: chart.name });
      setDraft(null);
      toast.success(`Created "${chart.name}" and assigned it to this product`);
    } catch (err) {
      console.error('[SizeChartAssignment] assign after create failed:', err);
      toast.error(`Chart created, but assigning it failed: ${err.message}. Use Assign… to retry.`);
    }
  };

  const importBtn = (
    <>
      <button className="sca-btn" onClick={() => fileRef.current?.click()} disabled={parsing}>
        {parsing ? 'Reading image…' : 'Import from image'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImage} />
    </>
  );

  return (
    <div className="pd-card">
      <div className="pd-card-heading">Size Chart</div>
      {current.has ? (
        <div className="sca-current">
          <span className="sca-name">{current.name || 'Assigned'}</span>
          <button className="sca-btn" onClick={() => setShowModal(true)}>Change…</button>
          {importBtn}
        </div>
      ) : (
        <div className="sca-current">
          <span className="sca-empty">No size chart assigned</span>
          <button className="sca-btn" onClick={() => setShowModal(true)}>Assign…</button>
          {importBtn}
        </div>
      )}
      <div className="sca-hint">Table content, columns and rows are edited in the Size Charts tab — a chart is shared by every product assigned to it. Import from image creates a new chart for this product.</div>

      {showModal && (
        <AssignSizeChartModal
          storeId={storeId}
          productIds={[product.id]}
          onClose={() => setShowModal(false)}
          onDone={handleDone}
        />
      )}

      {draft && (
        <div className="sca-overlay" onClick={() => setDraft(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }}>
          <div className="sca-modal" role="dialog" aria-modal="true" aria-label="New size chart from image"
            onClick={(e) => e.stopPropagation()}>
            <SizeChartTableEditor storeId={storeId} chart={draft}
              onSaved={handleDraftSaved} onCancel={() => setDraft(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

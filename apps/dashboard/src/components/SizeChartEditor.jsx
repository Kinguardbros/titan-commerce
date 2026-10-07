import { useState, useEffect, useCallback, useRef } from 'react';
import { readSizeChart, saveSizeChart, parseSizeChartImage } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './SizeChartEditor.css';

function parseCSV(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(',').map((c) => c.trim()));
  return { headers, rows };
}

function toCSV(headers, rows) {
  const headerLine = headers.join(', ');
  const rowLines = rows.map((r) => r.join(', '));
  return [headerLine, ...rowLines].join('\n');
}

export default function SizeChartEditor({ product, storeId }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [chartText, setChartText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);

  const fetchChart = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readSizeChart(storeId, product.id);
      setChartText(data.size_chart_text);
      if (data.size_chart_text) {
        const parsed = parseCSV(data.size_chart_text);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
      }
    } catch (err) {
      console.error('[SizeChartEditor] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId, product.id]);

  useEffect(() => { fetchChart(); }, [fetchChart]);

  const handleEdit = () => {
    if (!chartText) {
      setHeaders(['Size', 'US', 'Bust (in)', 'Waist (in)', 'Hips (in)']);
      setRows([['S', '', '', '', ''], ['M', '', '', '', ''], ['L', '', '', '', '']]);
    }
    setEditing(true);
  };

  const handleCellChange = (rowIdx, colIdx, value) => {
    setRows((prev) => prev.map((r, i) => i === rowIdx ? r.map((c, j) => j === colIdx ? value : c) : r));
  };

  const handleHeaderChange = (colIdx, value) => {
    setHeaders((prev) => prev.map((h, i) => i === colIdx ? value : h));
  };

  const addRow = () => {
    setRows((prev) => [...prev, Array(headers.length).fill('')]);
  };

  const deleteRow = (idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addColumn = () => {
    setHeaders((prev) => [...prev, 'New']);
    setRows((prev) => prev.map((r) => [...r, '']));
  };

  const deleteColumn = (colIdx) => {
    if (headers.length <= 1) return;
    setHeaders((prev) => prev.filter((_, i) => i !== colIdx));
    setRows((prev) => prev.map((r) => r.filter((_, i) => i !== colIdx)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const csv = toCSV(headers, rows);
      await saveSizeChart(storeId, product.id, csv);
      setChartText(csv);
      setEditing(false);
      toast.success('Size chart saved to Shopify!');
    } catch (err) {
      console.error('[SizeChartEditor] Save error:', err);
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to data URL for Claude Vision
    setParsing(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const data = await parseSizeChartImage(dataUrl);
      if (data.csv) {
        const parsed = parseCSV(data.csv);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setEditing(true);
        toast.success('Size chart extracted from image!');
      } else {
        toast.error('Could not extract size chart from image');
      }
    } catch (err) {
      console.error('[SizeChartEditor] Image parse error:', err);
      toast.error(`Image parse failed: ${err.message}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="sc-section">
        <div className="sc-section-title">Size Chart</div>
        <div className="sc-loading">Loading...</div>
      </div>
    );
  }

  const preview = headers.length > 0 ? toCSV(headers, rows) : '';
  const parsed = chartText ? parseCSV(chartText) : null;

  return (
    <div className="sc-section">
      <div className="sc-section-header">
        <div className="sc-section-title">Size Chart</div>
        <div className="sc-actions">
          {!editing && (
            <>
              <button className="sc-btn" onClick={handleEdit}>
                {chartText ? 'Edit' : 'Add Size Chart'}
              </button>
              <button className="sc-btn sc-btn--secondary" onClick={() => fileRef.current?.click()} disabled={parsing}>
                {parsing ? 'Parsing...' : 'Import from Image'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            </>
          )}
        </div>
      </div>

      {/* Read-only display */}
      {!editing && parsed && parsed.headers.length > 0 && (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>{parsed.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {parsed.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!editing && !chartText && (
        <div className="sc-empty">No size chart set for this product</div>
      )}

      {/* Editor */}
      {editing && (
        <div className="sc-editor">
          <div className="sc-editor-table-wrap">
            <table className="sc-editor-table">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i}>
                      <input className="sc-cell sc-cell--header" value={h} onChange={(e) => handleHeaderChange(i, e.target.value)} />
                      {headers.length > 1 && <button className="sc-col-delete" onClick={() => deleteColumn(i)} title="Delete column">x</button>}
                    </th>
                  ))}
                  <th><button className="sc-add-col" onClick={addColumn} title="Add column">+</button></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>
                        <input className="sc-cell" value={cell} onChange={(e) => handleCellChange(ri, ci, e.target.value)} />
                      </td>
                    ))}
                    <td><button className="sc-row-delete" onClick={() => deleteRow(ri)} title="Delete row">x</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="sc-add-row" onClick={addRow}>+ Add Row</button>

          <div className="sc-preview">
            <div className="sc-preview-label">Preview</div>
            <pre className="sc-preview-text">{preview}</pre>
          </div>

          <div className="sc-editor-actions">
            <button className="sc-btn sc-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save to Shopify'}
            </button>
            <button className="sc-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

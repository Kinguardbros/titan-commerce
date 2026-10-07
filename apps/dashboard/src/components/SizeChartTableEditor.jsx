import { useState, useRef } from 'react';
import { createSizeChart, updateSizeChart, parseSizeChartImage } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import { parseCsvTable } from '../lib/size-chart-csv';
import './SizeChartTableEditor.css';

// Mirrors the storefront's own conversion exactly (clara-size-chart.liquid): every number
// in a measurement cell divided by 2.54, rounded to one decimal, comma as the decimal
// separator (German). The size-label column (index 0) is never touched, and the raw cm
// text is kept in state so toggling back and forth can never drift the values — same
// guarantee the theme gets from keeping the cm value in a data attribute.
function cmToInch(text) {
  return String(text).replace(/\d+(?:[.,]\d+)?/g, (n) => {
    const v = parseFloat(n.replace(',', '.')) / 2.54;
    return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  });
}

export default function SizeChartTableEditor({ storeId, chart, initialValidation, onSaved, onCancel }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [chartId, setChartId] = useState(chart?.id || null);
  const [name, setName] = useState(chart?.name || '');
  const [note, setNote] = useState(chart?.note || '');
  const [unit, setUnit] = useState(chart?.unit || 'cm');
  const [columns, setColumns] = useState(chart?.columns?.length ? chart.columns : ['Größe', 'Brust', 'Taille', 'Hüfte']);
  const [rows, setRows] = useState(chart?.rows?.length ? chart.rows : [Array(4).fill('')]);
  const [previewUnit, setPreviewUnit] = useState('cm');
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState(initialValidation?.warnings || []);

  const handleColumnChange = (idx, value) => setColumns((prev) => prev.map((c, i) => (i === idx ? value : c)));
  const handleCellChange = (ri, ci, value) => setRows((prev) => prev.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r)));

  const addColumn = () => { setColumns((prev) => [...prev, 'New']); setRows((prev) => prev.map((r) => [...r, ''])); };
  const removeColumn = (idx) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((_, i) => i !== idx));
    setRows((prev) => prev.map((r) => r.filter((_, i) => i !== idx)));
  };
  const addRow = () => setRows((prev) => [...prev, Array(columns.length).fill('')]);
  const removeRow = (idx) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleImportImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const data = await parseSizeChartImage(dataUrl);
      const table = data?.csv ? parseCsvTable(data.csv) : null;
      if (table) {
        setColumns(table.columns);
        setRows(table.rows);
        toast.success('Size chart extracted from image — review before saving');
      } else {
        toast.error('Could not extract a table from that image');
      }
    } catch (err) {
      toast.error(`Image parse failed: ${err.message}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const payload = { name, columns, rows, note, unit };
      const result = chartId
        ? await updateSizeChart(storeId, chartId, payload)
        : await createSizeChart(storeId, payload);
      setChartId(result.chart.id);
      setWarnings(result.warnings || []);
      toast.success(chartId ? 'Size chart saved' : 'Size chart created');
      onSaved?.(result.chart);
    } catch (err) {
      // Backend responds 400 with { error, errors: [...] } on validation failure.
      const details = err.body?.errors;
      if (Array.isArray(details) && details.length) {
        setErrors(details);
        toast.error('Fix the errors below before saving');
      } else {
        toast.error(`Save failed: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const previewRows = rows.map((row) => row.map((cell, ci) => (ci > 0 && previewUnit === 'in' ? cmToInch(cell) : cell)));

  return (
    <div className="sct-editor">
      <div className="sct-editor__fields">
        <label className="sct-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Damen Oberteile" />
        </label>
        <label className="sct-field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="cm">cm (shows the CM/INCH switch)</option>
            <option value="fixed">fixed (unit stays in the header, no switch)</option>
          </select>
        </label>
        <label className="sct-field sct-field--wide">
          <span>Note (shown below the table)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
      </div>

      {errors.length > 0 && (
        <div className="sct-banner sct-banner--error">
          <div className="sct-banner__title">Fix before saving</div>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="sct-banner sct-banner--warn">
          <div className="sct-banner__title">Warnings (saved anyway)</div>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <div className="sct-editor__grid-wrap">
        <table className="sct-editor__table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i}>
                  <input value={c} onChange={(e) => handleColumnChange(i, e.target.value)} />
                  {columns.length > 1 && <button type="button" className="sct-x" onClick={() => removeColumn(i)} title="Remove column">×</button>}
                </th>
              ))}
              <th><button type="button" className="sct-add" onClick={addColumn} title="Add column">+</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}><input value={cell} onChange={(e) => handleCellChange(ri, ci, e.target.value)} /></td>
                ))}
                <td><button type="button" className="sct-x" onClick={() => removeRow(ri)} title="Remove row">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="sct-add-row" onClick={addRow}>+ Add row</button>
      </div>

      <div className="sct-editor__actions">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing}>
          {parsing ? 'Parsing…' : 'Import from image'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImportImage} />
        <div className="sct-editor__actions-right">
          <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="sct-save" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Live preview — same data path the storefront panel reads: columns[0]/rows[i][0] is
          the size label and is never converted; unit === 'cm' is the only case that shows a
          switch at all, and toggling divides every other cell's numbers by 2.54. Skin is the
          dashboard's own (Nextbyte Dark Luxe), not the storefront's KiwiSizing-matched CSS —
          this proves the DATA behavior the theme will render, not a pixel copy of its chrome. */}
      <div className="sct-preview">
        <div className="sct-preview__title">Storefront preview</div>
        {unit === 'cm' && (
          <div className="sct-preview__units" role="group" aria-label="Unit">
            <button type="button" className={previewUnit === 'cm' ? 'is-active' : ''} onClick={() => setPreviewUnit('cm')}>CM</button>
            <button type="button" className={previewUnit === 'in' ? 'is-active' : ''} onClick={() => setPreviewUnit('in')}>INCH</button>
          </div>
        )}
        <div className="sct-preview__scroll">
          <table className="sct-preview__table">
            <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {previewRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (ci === 0 ? <th key={ci} scope="row">{cell}</th> : <td key={ci}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note && <p className="sct-preview__note">{note}</p>}
      </div>
    </div>
  );
}

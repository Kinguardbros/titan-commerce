import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { importReviewsCsv } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';

const CSV_EXAMPLE = `author,rating,title,body,date,photo_url,verified
Maria,5,"Perfect fit","True to size, super comfortable",2024-06-10,,1
Jane,4,"Nice quality","Good material, runs a bit big",2024-06-08,,`;

// Downloadable template: header + example rows covering every column variant
// (with/without photo_url, verified true/blank, quoted fields with commas).
const CSV_TEMPLATE = `author,rating,title,body,date,photo_url,verified
Maria K.,5,"Perfect fit","True to size and super comfortable, the shaping is amazing.",2024-06-10,https://example.com/photo.jpg,1
Jane D.,4,"Nice quality","Good material, runs a bit big.",2024-06-08,,
Sophie M.,5,,"Exactly as pictured and ships fast.",2024-06-02,,1`;

// Trigger a client-side download of the CSV template (no backend, no dependency).
function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reviews-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Convert a .xlsx/.csv File into a CSV string in the browser (xlsx = SheetJS).
// Keeps the backend dependency-free — it only ever receives CSV text.
function fileToCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_csv(sheet));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Phase 3 bulk import — paste CSV, upload .csv/.xlsx, or pull a Google Sheet.
// All rows land as pending for review. No outbound push.
export default function ImportReviews({ storeId, productId, onClose, onImported }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const rowCount = csv.trim() ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToCsv(file);
      setCsv(text);
      setSheetUrl('');
      setFileName(file.name);
    } catch (err) {
      console.error('[ImportReviews] file parse failed:', err);
      toast.error(`Could not read "${file.name}": ${err.message}`);
    }
  };

  const handleImport = async () => {
    const payload = sheetUrl.trim() ? { sheet_url: sheetUrl.trim() } : { csv };
    if (!sheetUrl.trim() && !csv.trim()) { toast.error('Paste CSV, upload a file, or add a Sheets URL'); return; }
    setBusy(true);
    try {
      const { inserted, skipped, duplicates } = await importReviewsCsv(storeId, productId, payload);
      const extra = [skipped ? `${skipped} skipped` : '', duplicates ? `${duplicates} duplicate` : ''].filter(Boolean).join(' · ');
      toast.success(`Imported ${inserted} review${inserted === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}`);
      onImported();
      onClose();
    } catch (err) {
      console.error('[ImportReviews] import failed:', err);
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-import-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="rv-import-modal" role="dialog" aria-modal="true" aria-label="Import reviews"
        onClick={(e) => e.stopPropagation()}>
        <button className="rv-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="rv-title">Import Reviews</div>
        <div className="rv-import-sub">Rows import as <strong>pending</strong> — review &amp; approve them after.</div>

        <div className="rv-import-template">
          <span>New here? Grab the format:</span>
          <button type="button" className="rv-template-btn" onClick={downloadTemplate}>↓ Download CSV template</button>
        </div>

        <label className="rv-field-label">Paste CSV</label>
        <textarea className="rv-textarea rv-import-textarea" rows={6}
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setSheetUrl(''); setFileName(''); }}
          placeholder={CSV_EXAMPLE} />
        <div className="rv-import-meta">
          {fileName ? <span>📄 {fileName}</span> : <span>Columns: author, rating, title, body, date, photo_url, verified</span>}
          {rowCount > 0 && <span className="rv-import-count">{rowCount} row{rowCount === 1 ? '' : 's'}</span>}
        </div>

        <div className="rv-import-row">
          <button className="rv-btn rv-import-file-btn" onClick={() => fileRef.current?.click()}>
            Upload .csv / .xlsx
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={handleFile} />
          <span className="rv-import-or">or</span>
          <input className="rv-input" placeholder="Paste Google Sheets link (shared: anyone with link)"
            value={sheetUrl}
            onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value) { setCsv(''); setFileName(''); } }} />
        </div>

        <div className="rv-detail-actions rv-import-actions">
          <button className="rv-btn rv-btn--save" disabled={busy} onClick={handleImport}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

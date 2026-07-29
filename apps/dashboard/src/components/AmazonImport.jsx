import { useState } from 'react';
import { scrapeAmazonPreview, importAmazonReviews } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './AmazonImport.css';

// 4th ImportReviews tab — scrape Amazon reviews, preview + select, import as pending.
// Two views: input form -> preview list with checkboxes -> import selected.
export default function AmazonImport({ storeId, productId, onImported }) {
  const toast = useToast();
  const [amazonUrl, setAmazonUrl] = useState('');
  const [maxReviews, setMaxReviews] = useState(10);
  const [busy, setBusy] = useState(false);
  const [previewReviews, setPreviewReviews] = useState(null); // null = not scraped yet
  const [selectedIds, setSelectedIds] = useState(new Set());

  const handleScrape = async () => {
    if (!amazonUrl.trim()) { toast.error('Paste an Amazon product URL'); return; }
    setBusy(true);
    try {
      const { reviews } = await scrapeAmazonPreview(storeId, productId, amazonUrl.trim(), maxReviews);
      const withIds = (reviews || []).map((r, i) => ({ ...r, _id: i }));
      setPreviewReviews(withIds);
      setSelectedIds(new Set(withIds.map((r) => r._id)));
      if (withIds.length === 0) toast.info('No reviews found for this product');
    } catch (err) {
      console.error('[AmazonImport] scrape failed:', err);
      toast.error(`Scrape failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => (
      prev.size === previewReviews.length ? new Set() : new Set(previewReviews.map((r) => r._id))
    ));
  };

  const handleImport = async () => {
    const selected = previewReviews.filter((r) => selectedIds.has(r._id)).map((r) => {
      const rest = { ...r };
      delete rest._id;
      return rest;
    });
    if (selected.length === 0) { toast.error('Select at least one review'); return; }
    setBusy(true);
    try {
      const { inserted, skipped, duplicates } = await importAmazonReviews(storeId, productId, selected);
      const extra = [skipped ? `${skipped} skipped` : '', duplicates ? `${duplicates} duplicate` : ''].filter(Boolean).join(' · ');
      toast.success(`Imported ${inserted} review${inserted === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}`);
      setPreviewReviews(null);
      setAmazonUrl('');
      onImported();
    } catch (err) {
      console.error('[AmazonImport] import failed:', err);
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (previewReviews === null) {
    return (
      <div className="az-form">
        <div className="az-sub">Scrape reviews from a similar Amazon product to boost social proof before organic reviews arrive.</div>
        <label className="rv-field-label">Amazon product URL</label>
        <input className="rv-input" placeholder="https://www.amazon.com/dp/B0EXAMPLE"
          value={amazonUrl} onChange={(e) => setAmazonUrl(e.target.value)} />
        <label className="rv-field-label">Max reviews</label>
        <input className="rv-input az-max-input" type="number" min={1} max={10}
          value={maxReviews} onChange={(e) => setMaxReviews(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 10)))} />
        <div className="rv-detail-actions rv-import-actions">
          <button className="rv-btn rv-btn--save" disabled={busy} onClick={handleScrape}>
            {busy ? 'Scraping… (up to 60s)' : 'Scrape Preview'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="az-preview">
      <div className="az-preview-bar">
        <span>{selectedIds.size} of {previewReviews.length} selected</span>
        <button type="button" className="rv-template-btn" onClick={toggleAll}>
          {selectedIds.size === previewReviews.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="az-list">
        {previewReviews.map((r) => (
          <label key={r._id} className="az-row">
            <input type="checkbox" checked={selectedIds.has(r._id)} onChange={() => toggleOne(r._id)} />
            <span className="az-stars">{'★'.repeat(Math.round(r.rating))}{'☆'.repeat(5 - Math.round(r.rating))}</span>
            <span className="az-author">{r.author}</span>
            <span className="az-title">{r.title}</span>
            <span className="az-body">{(r.body || '').slice(0, 100)}{(r.body || '').length > 100 ? '…' : ''}</span>
            {r.photo_urls?.[0] && <img className="az-thumb" src={r.photo_urls[0]} alt="" />}
          </label>
        ))}
        {previewReviews.length === 0 && <div className="az-empty">No reviews found for this product.</div>}
      </div>
      <div className="rv-detail-actions rv-import-actions">
        <button className="rv-btn" disabled={busy} onClick={() => setPreviewReviews(null)}>Back</button>
        <button className="rv-btn rv-btn--save" disabled={busy || selectedIds.size === 0} onClick={handleImport}>
          {busy ? 'Importing…' : `Import Selected (${selectedIds.size})`}
        </button>
      </div>
    </div>
  );
}

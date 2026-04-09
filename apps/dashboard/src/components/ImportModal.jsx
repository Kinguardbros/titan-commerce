import { useState } from 'react';
import { scrapeProductUrl, confirmImport } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './ImportModal.css';

const STEPS = ['url', 'preview', 'importing', 'done'];

export default function ImportModal({ onClose, storeId, onImported }) {
  const toast = useToast();
  const [step, setStep] = useState('url');
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [mode, setMode] = useState(null); // 'single' | 'collection'
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [editProduct, setEditProduct] = useState(null); // single product being edited
  const [autoOptimize, setAutoOptimize] = useState(true);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [generateCount, setGenerateCount] = useState(4);
  const [progress, setProgress] = useState([]);
  const [result, setResult] = useState(null);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    try {
      const data = await scrapeProductUrl(url.trim());
      setMode(data.mode);
      if (data.mode === 'single') {
        setEditProduct(data.product);
      } else {
        setProducts(data.products || []);
        setSelected(new Set(data.products?.map((_, i) => i) || []));
      }
      setStep('preview');
    } catch (err) {
      console.error('[ImportModal] Scrape error:', err);
      toast.error(`Scrape failed: ${err.message}`);
    } finally {
      setScraping(false);
    }
  };

  const handleImportSingle = async (product) => {
    setStep('importing');
    const steps = [
      { label: 'Product scraped', done: true },
      { label: 'Creating in Shopify...', done: false },
      { label: autoOptimize ? 'Optimizing listing with Claude AI...' : null, done: false },
      { label: autoGenerate ? `Generating ${generateCount} creatives...` : null, done: false },
    ].filter((s) => s.label);
    setProgress(steps);

    try {
      const importResult = await confirmImport({
        store_id: storeId,
        product_data: {
          title: product.title,
          description: product.description,
          price: product.price,
          images: product.images,
          product_type: '',
          vendor: '',
          tags: [],
          source_url: product.url,
        },
        auto_optimize: autoOptimize,
        auto_generate: autoGenerate,
        generate_count: generateCount,
      });

      setProgress(steps.map((s) => ({ ...s, done: true })));
      setResult(importResult);
      setStep('done');
      toast.success(`"${importResult.title}" imported!`);
    } catch (err) {
      console.error('[ImportModal] Import error:', err);
      toast.error(`Import failed: ${err.message}`);
      setStep('preview');
    }
  };

  const handleBulkImport = async () => {
    const toImport = products.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;

    setStep('importing');
    const steps = toImport.map((p) => ({ label: `Importing "${p.title?.slice(0, 40)}"...`, done: false }));
    setProgress(steps);

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      try {
        await confirmImport({
          store_id: storeId,
          product_data: {
            title: toImport[i].title,
            description: toImport[i].description,
            price: toImport[i].price,
            images: toImport[i].images,
            tags: [],
            source_url: toImport[i].url,
          },
          auto_optimize: autoOptimize,
          auto_generate: autoGenerate,
          generate_count: generateCount,
        });
        successCount++;
        setProgress((prev) => prev.map((s, j) => j === i ? { ...s, done: true } : s));
      } catch (err) {
        console.error('[ImportModal] Bulk import error:', err);
        setProgress((prev) => prev.map((s, j) => j === i ? { ...s, label: `Failed: ${toImport[i].title?.slice(0, 30)}`, error: true } : s));
      }
    }

    setResult({ title: `${successCount} products`, bulk: true, count: successCount });
    setStep('done');
    toast.success(`${successCount} of ${toImport.length} products imported!`);
  };

  const handleReset = () => {
    setStep('url');
    setUrl('');
    setMode(null);
    setProducts([]);
    setSelected(new Set());
    setEditProduct(null);
    setProgress([]);
    setResult(null);
  };

  return (
    <div className="im-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="im-modal">
        <button className="im-close" onClick={onClose}>x</button>
        <div className="im-title">Import Product</div>
        <div className="im-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`im-step${step === s ? ' im-step--active' : ''}${STEPS.indexOf(step) > i ? ' im-step--done' : ''}`}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* STEP 1: URL */}
        {step === 'url' && (
          <div className="im-body">
            <div className="im-label">Product or collection URL</div>
            <input
              className="im-url-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://competitor.com/products/summer-dress"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleScrape(); }}
            />
            <div className="im-hint">Paste a single product URL or a collection page to import multiple products</div>
            <button className="im-btn im-btn--primary" onClick={handleScrape} disabled={scraping || !url.trim()}>
              {scraping ? 'Scraping...' : 'Scrape'}
            </button>
          </div>
        )}

        {/* STEP 2: PREVIEW — single */}
        {step === 'preview' && mode === 'single' && editProduct && (
          <div className="im-body">
            {editProduct.images?.length > 0 && (
              <div className="im-images">
                {editProduct.images.map((img, i) => (
                  <img key={i} src={img} alt="" className="im-thumb" loading="lazy" />
                ))}
              </div>
            )}

            <div className="im-field">
              <div className="im-field-label">Title</div>
              <input className="im-input" value={editProduct.title} onChange={(e) => setEditProduct({ ...editProduct, title: e.target.value })} />
            </div>
            <div className="im-field">
              <div className="im-field-label">Price</div>
              <input className="im-input" value={editProduct.price} onChange={(e) => setEditProduct({ ...editProduct, price: e.target.value })} placeholder="0.00" />
            </div>
            <div className="im-field">
              <div className="im-field-label">Description</div>
              <textarea className="im-textarea" rows={3} value={editProduct.description} onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })} />
            </div>
            {editProduct.features?.length > 0 && (
              <div className="im-field">
                <div className="im-field-label">Features</div>
                <div className="im-features">{editProduct.features.map((f, i) => <span key={i} className="im-feature-tag">{f}</span>)}</div>
              </div>
            )}

            <div className="im-options">
              <label className="im-checkbox">
                <input type="checkbox" checked={autoOptimize} onChange={(e) => setAutoOptimize(e.target.checked)} />
                Auto-optimize listing (Claude AI)
              </label>
              <label className="im-checkbox">
                <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                Auto-generate {generateCount} creatives
              </label>
              {autoGenerate && (
                <div className="im-count-pills">
                  {[2, 4, 6].map((n) => (
                    <button key={n} className={`im-count-pill${generateCount === n ? ' im-count-pill--active' : ''}`} onClick={() => setGenerateCount(n)}>{n}</button>
                  ))}
                </div>
              )}
            </div>

            <button className="im-btn im-btn--primary" onClick={() => handleImportSingle(editProduct)}>
              Import to Shopify
            </button>
          </div>
        )}

        {/* STEP 2: PREVIEW — collection */}
        {step === 'preview' && mode === 'collection' && (
          <div className="im-body">
            <div className="im-collection-header">
              <span>{products.length} products found</span>
              <button className="im-select-all" onClick={() => {
                if (selected.size === products.length) setSelected(new Set());
                else setSelected(new Set(products.map((_, i) => i)));
              }}>
                {selected.size === products.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="im-collection-grid">
              {products.map((p, i) => (
                <div key={i} className={`im-collection-item${selected.has(i) ? ' im-collection-item--selected' : ''}`} onClick={() => {
                  setSelected((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
                }}>
                  <div className="im-collection-check">{selected.has(i) ? '✓' : ''}</div>
                  {p.images?.[0] && <img src={p.images[0]} alt="" className="im-collection-img" loading="lazy" />}
                  <div className="im-collection-info">
                    <div className="im-collection-name">{p.title}</div>
                    {p.price && <div className="im-collection-price">${p.price}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="im-options">
              <label className="im-checkbox">
                <input type="checkbox" checked={autoOptimize} onChange={(e) => setAutoOptimize(e.target.checked)} />
                Auto-optimize listings
              </label>
              <label className="im-checkbox">
                <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} />
                Auto-generate creatives
              </label>
            </div>

            <button className="im-btn im-btn--primary" onClick={handleBulkImport} disabled={selected.size === 0}>
              Import {selected.size} product{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* STEP 3: IMPORTING */}
        {step === 'importing' && (
          <div className="im-body">
            <div className="im-progress">
              {progress.map((s, i) => (
                <div key={i} className={`im-progress-item${s.done ? ' im-progress-item--done' : ''}${s.error ? ' im-progress-item--error' : ''}`}>
                  <span className="im-progress-icon">{s.error ? '✗' : s.done ? '✓' : '⏳'}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: DONE */}
        {step === 'done' && result && (
          <div className="im-body im-done">
            <div className="im-done-icon">✓</div>
            <div className="im-done-title">Import complete!</div>
            <div className="im-done-product">"{result.title}"</div>
            <div className="im-done-meta">
              Created in Shopify
              {result.optimization_pending && ' + optimization pending'}
              {result.creatives_count > 0 && ` + ${result.creatives_count} creatives queued`}
              {result.bulk && ` (${result.count} products)`}
            </div>
            <div className="im-done-actions">
              <button className="im-btn im-btn--primary" onClick={() => { onImported?.(); onClose(); }}>
                View Products
              </button>
              <button className="im-btn" onClick={handleReset}>
                Import Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

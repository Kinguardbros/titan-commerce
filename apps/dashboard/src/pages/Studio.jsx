import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { getAllProducts, getStudioCreatives, generateBranded, generateCreatives, getCustomStyles } from '../lib/api';
import CreativeStudio from '../components/CreativeStudio';
import CreativeEditor from '../components/CreativeEditor';
import CreativeDetailModal, { mapCreativeToModalData } from '../components/CreativeDetailModal';
import { approveAd, rejectAd, updateCreative, convertToVideo, pushCreativeToShopify, pollGenerations } from '../lib/api';
import supabase from '../lib/supabase';
import { useToast } from '../hooks/useToast.jsx';
import './Studio.css';

const StyleBuilder = lazy(() => import('../components/StyleBuilder'));

const STYLE_OPTIONS = [
  { key: 'all', label: 'All styles' },
  { key: 'ad_creative', label: 'Ad Creative' },
  { key: 'product_photo_beach', label: 'Beach Photo' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'product_shot', label: 'Product Shot' },
  { key: 'review_ugc', label: 'UGC' },
  { key: 'static_clean', label: 'Clean Minimal' },
  { key: 'static_split', label: 'Split Screen' },
  { key: 'static_urgency', label: 'Urgency' },
];

const STATUS_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'published', label: 'Published' },
];

const FORMAT_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
];

const BULK_STYLES = [
  { key: 'ad_creative', label: 'Ad Creative' },
  { key: 'product_photo_beach', label: 'Beach Photo' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'static_clean', label: 'Clean Minimal' },
  { key: 'static_urgency', label: 'Urgency' },
];

export default function Studio({ storeId, store, initialProductId, onNavigateToProduct }) {
  const toast = useToast();
  const [creatives, setCreatives] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterStyle, setFilterStyle] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFormat, setFilterFormat] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Generate
  const [showGeneratePanel, setShowGeneratePanel] = useState(false);
  const [generateProduct, setGenerateProduct] = useState(null);
  const [editingCreative, setEditingCreative] = useState(null);

  // Panels
  const [showBulk, setShowBulk] = useState(false);

  // Bulk generate state
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkStyle, setBulkStyle] = useState('ad_creative');
  const [bulkCount, setBulkCount] = useState(2);
  const [bulkModel, setBulkModel] = useState('fal_nano_banana');
  const [bulkSubject, setBulkSubject] = useState(true);
  const [bulkBodyType, setBulkBodyType] = useState('Auto');
  const [bulkFraming, setBulkFraming] = useState('Full body');
  const [bulkRatio, setBulkRatio] = useState('1:1');
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkCompleted, setBulkCompleted] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  // Custom styles
  const [customStyles, setCustomStyles] = useState([]);
  const [showStyleBuilder, setShowStyleBuilder] = useState(false);
  useEffect(() => {
    if (!storeId) return;
    getCustomStyles(storeId).then(setCustomStyles).catch(() => {});
  }, [storeId]);
  const allStyleOptions = useMemo(() => [
    ...STYLE_OPTIONS,
    ...customStyles.map(cs => ({ key: cs.style_key, label: cs.name })),
  ], [customStyles]);

  // Fetch all creatives for store
  const fetchCreatives = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStudioCreatives(storeId);
      if (data) setCreatives(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { fetchCreatives(); }, [fetchCreatives]);
  useEffect(() => {
    if (storeId) getAllProducts(storeId).then(setProducts).catch(() => {});
  }, [storeId]);

  // Pre-select product filter from navigation
  useEffect(() => {
    if (initialProductId && products.length > 0) {
      setFilterProduct(initialProductId);
    }
  }, [initialProductId, products]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`studio-${storeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'creatives' },
        (payload) => { if (payload.new.store_id === storeId) setCreatives((prev) => [payload.new, ...prev]); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'creatives' },
        (payload) => { setCreatives((prev) => prev.map((c) => c.id === payload.new.id ? { ...c, ...payload.new } : c)); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'creatives' },
        (payload) => { setCreatives((prev) => prev.filter((c) => c.id !== payload.old.id)); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId]);

  // Poll fal.ai jobs while any creative is still generating
  useEffect(() => {
    if (!storeId) return;
    const hasPending = creatives.some((c) => c.status === 'generating');
    if (!hasPending) return;
    const tick = () => { pollGenerations(storeId).catch((err) => console.warn('[Studio] poll failed:', err.message)); };
    tick();
    const iv = setInterval(tick, 3000);
    return () => clearInterval(iv);
  }, [storeId, creatives]);

  // Filtered creatives
  const filtered = useMemo(() => {
    return creatives.filter((c) => {
      if (filterProduct !== 'all' && c.product_id !== filterProduct) return false;
      if (filterStyle !== 'all' && (c.style || 'ad_creative') !== filterStyle) return false;
      if (filterStatus !== 'all') {
        if (filterStatus === 'approved' && c.status !== 'approved' && c.status !== 'published') return false;
        if (filterStatus === 'pending' && c.status !== 'pending') return false;
        if (filterStatus === 'published' && c.status !== 'published') return false;
      }
      if (filterFormat !== 'all' && c.format !== filterFormat) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const matchHook = (c.hook_used || '').toLowerCase().includes(q);
        const matchHeadline = (c.headline || '').toLowerCase().includes(q);
        const matchProduct = (c.product?.title || '').toLowerCase().includes(q);
        if (!matchHook && !matchHeadline && !matchProduct) return false;
      }
      return true;
    });
  }, [creatives, filterProduct, filterStyle, filterStatus, filterFormat, searchText]);

  // Product options for filter dropdown
  const productOptions = useMemo(() => {
    const withCreatives = new Map();
    creatives.forEach((c) => {
      if (c.product_id && c.product) {
        withCreatives.set(c.product_id, c.product);
      }
    });
    let list = Array.from(withCreatives.entries()).map(([id, p]) => ({ id, title: p.title, image_url: p.image_url }));
    if (productSearch) {
      list = list.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()));
    }
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }, [creatives, productSearch]);

  const selectedProductName = filterProduct === 'all' ? 'All products' : productOptions.find((p) => p.id === filterProduct)?.title || 'Product';

  // Stats
  const totalPending = filtered.filter((c) => c.status === 'pending').length;
  const totalApproved = filtered.filter((c) => c.status === 'approved' || c.status === 'published').length;

  // Handlers
  const handleApprove = async (id, comment) => {
    try { await approveAd(id, 'Team', comment); toast.success('Creative approved!'); } catch (e) { console.error(e); toast.error(`Approve failed: ${e.message}`); }
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: 'approved' } : c));
    setEditingCreative(null);
  };
  const handleReject = async (id, reason) => {
    try { await rejectAd(id, 'Team', reason); toast.success('Creative rejected'); } catch (e) { console.error(e); toast.error(`Reject failed: ${e.message}`); }
    setCreatives((prev) => prev.filter((c) => c.id !== id));
    setEditingCreative(null);
  };
  const handleSave = async (id, updates) => {
    try { await updateCreative(id, updates); } catch (e) { console.error(e); toast.error(`Save failed: ${e.message}`); }
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c));
  };

  const openGenerate = (product) => {
    setGenerateProduct(product);
    setShowGeneratePanel(true);
  };

  // Bulk generate
  const handleBulkGenerate = async () => {
    if (bulkSelected.size === 0) return;
    setBulkGenerating(true);
    setBulkCompleted(0);
    const total = bulkSelected.size * bulkCount;
    setBulkTotal(total);
    toast.info(`Generating ${total} images across ${bulkSelected.size} products...`);

    const bodyHint = bulkSubject && bulkBodyType !== 'Auto' ? `Model body type: ${bulkBodyType}. ` : '';
    const framingHint = bulkSubject ? (
      bulkFraming === 'Head crop' ? 'Framing: crop from chest up, do NOT show full head — cut off the top of the head above the eyes. Focus on the product, not the face. '
      : bulkFraming === 'Cropped with head' ? 'Framing: crop from waist/hip up, show full head and face. Upper body portrait with the product clearly visible. '
      : 'Framing: full body shot, show the model head to toe. '
    ) : '';
    const customPrompt = `${bodyHint}${framingHint}`.trim();

    const allJobs = [];
    for (const productId of bulkSelected) {
      for (let i = 0; i < bulkCount; i++) { allJobs.push({ productId }); }
    }
    const BATCH_SIZE = 10;
    for (let b = 0; b < allJobs.length; b += BATCH_SIZE) {
      const batch = allJobs.slice(b, b + BATCH_SIZE);
      await Promise.allSettled(batch.map((job) =>
        generateCreatives({
          product_id: job.productId, store_id: storeId, style: bulkStyle,
          ai_model: bulkModel, show_model: bulkSubject, text_overlay: 'none',
          aspect_ratio: bulkRatio, custom_prompt: customPrompt || undefined,
        }).then(() => setBulkCompleted((p) => p + 1))
          .catch((err) => { console.error(`Bulk gen failed:`, err); setBulkCompleted((p) => p + 1); })
      ));
    }
    setBulkGenerating(false);
    toast.success(`Bulk generation complete!`);
    fetchCreatives();
  };

  const toggleBulkProduct = (id) => {
    setBulkSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleBulkAll = () => {
    setBulkSelected((prev) => prev.size === products.length ? new Set() : new Set(products.map((p) => p.id)));
  };

  const bulkProducts = useMemo(() => {
    return products.filter((p) => !productSearch || p.title.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 200);
  }, [products, productSearch]);

  return (
    <div className="studio">
      {/* Header */}
      <div className="studio-header">
        <div className="studio-title gradient-heading">Studio</div>
        <div className="studio-store">{store?.name}</div>
        <div className="studio-header-stats">
          <span className="studio-stat">{totalPending} pending</span>
          <span className="studio-stat studio-stat--approved">{totalApproved} approved</span>
          <span className="studio-stat">{filtered.length} total</span>
        </div>
        <div className="studio-header-actions">
          <button className="studio-btn studio-btn--bulk" onClick={() => setShowBulk(!showBulk)}>
            {showBulk ? 'Hide Bulk' : 'Bulk Generate'}
          </button>
          <button className="studio-btn studio-btn--generate" onClick={() => setShowGeneratePanel(true)}>
            + Generate
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="studio-filters">
        {/* Product dropdown */}
        <div className="studio-filter-dropdown" onClick={() => setShowProductDropdown(!showProductDropdown)}>
          <span className="studio-filter-label">{selectedProductName}</span>
          <span className="studio-filter-arrow">▾</span>
          {showProductDropdown && (
            <div className="studio-dropdown" onClick={(e) => e.stopPropagation()}>
              <input className="studio-dropdown-search" type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products..." autoFocus />
              <div className="studio-dropdown-item" onClick={() => { setFilterProduct('all'); setShowProductDropdown(false); }}>
                All products
              </div>
              {productOptions.map((p) => (
                <div key={p.id} className={`studio-dropdown-item${filterProduct === p.id ? ' studio-dropdown-item--active' : ''}`}
                  onClick={() => { setFilterProduct(p.id); setShowProductDropdown(false); }}>
                  {p.image_url && <img src={p.image_url} alt="" className="studio-dropdown-img" />}
                  <span>{p.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Style pills */}
        <div className="studio-filter-pills">
          {allStyleOptions.map((s) => (
            <button key={s.key} className={`studio-fpill${filterStyle === s.key ? ' studio-fpill--active' : ''}`} onClick={() => setFilterStyle(s.key)}>{s.label}</button>
          ))}
          <button className="studio-fpill studio-fpill--add" onClick={() => setShowStyleBuilder(true)}>+ Custom Style</button>
        </div>

        {/* Status pills */}
        <div className="studio-filter-pills">
          {STATUS_OPTIONS.map((s) => (
            <button key={s.key} className={`studio-fpill${filterStatus === s.key ? ' studio-fpill--active' : ''}`} onClick={() => setFilterStatus(s.key)}>{s.label}</button>
          ))}
        </div>

        {/* Format pills */}
        <div className="studio-filter-pills">
          {FORMAT_OPTIONS.map((s) => (
            <button key={s.key} className={`studio-fpill${filterFormat === s.key ? ' studio-fpill--active' : ''}`} onClick={() => setFilterFormat(s.key)}>{s.label}</button>
          ))}
        </div>

        {/* Search */}
        <input className="studio-search" type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search creatives..." />
      </div>

      {/* Bulk Generate panel (collapsible) */}
      {showBulk && (
        <div className="studio-bulk">
          <div className="studio-card">
            <div className="studio-card-title gradient-heading">Bulk Generate</div>

            <div className="studio-row" style={{ marginBottom: 12 }}>
              <div>
                <div className="studio-field-label">Style</div>
                <div className="studio-pills">{BULK_STYLES.map((s) => (
                  <button key={s.key} className={`studio-pill${bulkStyle === s.key ? ' studio-pill--active' : ''}`} onClick={() => setBulkStyle(s.key)}>{s.label}</button>
                ))}</div>
              </div>
              <div>
                <div className="studio-field-label">Per product</div>
                <div className="studio-pills">{[1, 2, 3, 4].map((n) => (
                  <button key={n} className={`studio-pill studio-pill--sm${bulkCount === n ? ' studio-pill--active' : ''}`} onClick={() => setBulkCount(n)}>{n}</button>
                ))}</div>
              </div>
              <div>
                <div className="studio-field-label">AI Model</div>
                <div className="studio-pills">{[['fal_nano_banana', 'Nano Banana'], ['fal_flux2_edit', 'FLUX.2'], ['fal_flux2_pro_edit', 'FLUX.2 Pro'], ['fal_ideogram_bg', 'Ideogram BG']].map(([k, l]) => (
                  <button key={k} className={`studio-pill${bulkModel === k ? ' studio-pill--active' : ''}`} onClick={() => setBulkModel(k)}>{l}</button>
                ))}</div>
              </div>
            </div>

            <div className="studio-row" style={{ marginBottom: 12 }}>
              <div>
                <div className="studio-field-label">Subject</div>
                <div className="studio-pills">
                  <button className={`studio-pill${bulkSubject ? ' studio-pill--active' : ''}`} onClick={() => setBulkSubject(true)}>On Model</button>
                  <button className={`studio-pill${!bulkSubject ? ' studio-pill--active' : ''}`} onClick={() => setBulkSubject(false)}>No Model</button>
                </div>
              </div>
              <div>
                <div className="studio-field-label">Ratio</div>
                <div className="studio-pills">{['1:1', '4:5', '9:16', '16:9'].map((r) => (
                  <button key={r} className={`studio-pill studio-pill--sm${bulkRatio === r ? ' studio-pill--active' : ''}`} onClick={() => setBulkRatio(r)}>{r}</button>
                ))}</div>
              </div>
              {bulkSubject && (
                <>
                  <div>
                    <div className="studio-field-label">Body Type</div>
                    <div className="studio-pills">{['Auto', 'Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'].map((b) => (
                      <button key={b} className={`studio-pill${bulkBodyType === b ? ' studio-pill--active' : ''}`} onClick={() => setBulkBodyType(b)}>{b}</button>
                    ))}</div>
                  </div>
                  <div>
                    <div className="studio-field-label">Framing</div>
                    <div className="studio-pills">{['Full body', 'Cropped with head', 'Head crop'].map((f) => (
                      <button key={f} className={`studio-pill${bulkFraming === f ? ' studio-pill--active' : ''}`} onClick={() => setBulkFraming(f)}>{f}</button>
                    ))}</div>
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="studio-field-label" style={{ margin: 0 }}>Products ({bulkSelected.size}/{products.length})</div>
              <button className="studio-pill studio-pill--sm" onClick={toggleBulkAll} style={{ cursor: 'pointer' }}>
                {bulkSelected.size === products.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="studio-bulk-products">
              {bulkProducts.map((p) => (
                <div key={p.id} onClick={() => toggleBulkProduct(p.id)} className={`studio-bulk-product-row${bulkSelected.has(p.id) ? ' studio-bulk-product-row--selected' : ''}`}>
                  <div className={`studio-bulk-check${bulkSelected.has(p.id) ? ' studio-bulk-check--active' : ''}`}>{bulkSelected.has(p.id) ? '✓' : ''}</div>
                  {p.image_url && <img src={p.image_url} alt="" className="studio-bulk-product-img" />}
                  <div className="studio-bulk-product-name">{p.title}</div>
                </div>
              ))}
            </div>

            <button className="studio-generate-btn" onClick={handleBulkGenerate} disabled={bulkGenerating || bulkSelected.size === 0}>
              {bulkGenerating ? `Generating ${bulkCompleted}/${bulkTotal}...` : `Generate ${bulkSelected.size * bulkCount} images (${bulkSelected.size} × ${bulkCount})`}
            </button>
            {bulkGenerating && (
              <div className="studio-progress"><div className="studio-progress-bar" style={{ width: `${bulkTotal > 0 ? (bulkCompleted / bulkTotal) * 100 : 0}%` }} /></div>
            )}
          </div>
        </div>
      )}

      {/* Creative Gallery */}
      {loading ? (
        <div className="studio-loading">Loading creatives...</div>
      ) : filtered.length === 0 ? (
        <div className="studio-empty">
          <div>No creatives found</div>
          <div className="studio-empty-hint">Try adjusting your filters or generate new creatives</div>
        </div>
      ) : (
        <div className="studio-grid">
          {filtered.map((c) => (
            <GalleryCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} onGenerate={() => {
              const prod = products.find((p) => p.id === c.product_id);
              if (prod) openGenerate(prod);
            }} />
          ))}
        </div>
      )}

      {/* Generate modal */}
      {showGeneratePanel && (
        <div className="studio-generate-overlay">
          {!generateProduct ? (
            <div className="studio-product-picker" onClick={(e) => e.target === e.currentTarget && setShowGeneratePanel(false)}>
              <div className="studio-card" style={{ maxWidth: 480, margin: '60px auto' }}>
                <div className="studio-card-title gradient-heading">Select Product to Generate</div>
                <input className="studio-search" type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products..." />
                <div className="studio-product-list">
                  {products.filter((p) => !productSearch || p.title.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 30).map((p) => (
                    <div key={p.id} className="studio-product-row" onClick={() => openGenerate(p)}>
                      <div className="studio-product-img" style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}} />
                      <div className="studio-product-info">
                        <div className="studio-product-name">{p.title}</div>
                        <div className="studio-product-meta">{p.price ? `$${p.price}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="studio-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setShowGeneratePanel(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <CreativeStudio
              product={generateProduct}
              storeId={storeId}
              creatives={creatives.filter((c) => c.product_id === generateProduct.id)}
              onClose={() => { setShowGeneratePanel(false); setGenerateProduct(null); }}
              onGenerated={() => { setShowGeneratePanel(false); setGenerateProduct(null); fetchCreatives(); }}
            />
          )}
        </div>
      )}

      {/* Creative detail modal */}
      {editingCreative && (() => {
        const idx = filtered.findIndex(c => c.id === editingCreative.id);
        return (
          <CreativeDetailModal
            data={mapCreativeToModalData(editingCreative)}
            onClose={() => setEditingCreative(null)}
            onPrev={idx > 0 ? () => setEditingCreative(filtered[idx - 1]) : null}
            onNext={idx < filtered.length - 1 ? () => setEditingCreative(filtered[idx + 1]) : null}
            onAction={(actionId) => {
              const id = editingCreative.id;
              switch (actionId) {
                case 'approve': handleApprove(id); break;
                case 'reject': handleReject(id); break;
                case 'download': window.open(editingCreative.file_url, '_blank'); break;
                case 'copy-url': navigator.clipboard.writeText(editingCreative.file_url); toast.success('URL copied'); break;
                case 'convert-video': convertToVideo(id).then(() => { toast.success('Converting to video...'); setEditingCreative(null); fetchCreatives(); }).catch(e => toast.error(e.message)); break;
                case 'push-shopify': pushCreativeToShopify(id, storeId).then((r) => { toast.success(r.message || 'Pushed to Shopify'); fetchCreatives(); }).catch(e => toast.error(e.message)); break;
                default: break;
              }
            }}
          />
        );
      })()}

      {showStyleBuilder && (
        <Suspense fallback={null}>
          <StyleBuilder
            storeId={storeId}
            storeName={store?.name}
            onClose={() => setShowStyleBuilder(false)}
            onCreated={() => {
              setShowStyleBuilder(false);
              toast.success('Custom style created!');
              getCustomStyles(storeId).then(setCustomStyles).catch(() => {});
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function GalleryCard({ creative: c, onClick }) {
  const isVideo = c.format === 'video';
  const metadata = isVideo && c.metadata ? (typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata) : {};
  const thumbUrl = isVideo ? metadata.source_image_url || c.file_url : c.file_url;
  const productName = c.product?.title || c.headline || '';
  const styleName = STYLE_OPTIONS.find((s) => s.key === (c.style || 'ad_creative'))?.label || c.style;

  return (
    <div className="studio-gcard" onClick={onClick}>
      <div className="studio-gcard-img" style={thumbUrl ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
        {isVideo && <span className="studio-play-icon">▶</span>}
        <div className="studio-gcard-badges">
          <span className={`pill ${c.status}`}>{c.status}</span>
        </div>
      </div>
      <div className="studio-gcard-body">
        <div className="studio-gcard-product">{productName}</div>
        <div className="studio-gcard-meta">
          <span className="studio-gcard-style">{styleName}</span>
          {c.aspect_ratio && c.aspect_ratio !== '1:1' && <span className="studio-gcard-ratio">{c.aspect_ratio}</span>}
        </div>
      </div>
    </div>
  );
}

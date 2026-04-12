import { useState, useEffect, useCallback } from 'react';
import { getAllProducts, getStudioCreatives, generateBranded, generateCreatives } from '../lib/api';
import CreativeStudio from '../components/CreativeStudio';
import CreativeEditor from '../components/CreativeEditor';
import { approveAd, rejectAd } from '../lib/api';
import supabase from '../lib/supabase';
import Breadcrumbs from '../components/Breadcrumbs';
import { useToast } from '../hooks/useToast.jsx';
import './Studio.css';

const BRANDED_TYPES = [
  { key: 'branded_lifestyle', label: 'Lifestyle' },
  { key: 'branded_banner', label: 'Banner' },
  { key: 'branded_social', label: 'Social Post' },
];

const STYLES = [
  { key: 'ad_creative', label: 'Ad Creative' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'static_clean', label: 'Clean Minimal' },
  { key: 'static_urgency', label: 'Urgency' },
];

export default function Studio({ storeId, store, initialProductId, onNavigateToProduct }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialProductId ? 'product' : 'branded');
  const [creatives, setCreatives] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showGeneratePanel, setShowGeneratePanel] = useState(false);
  const [editingCreative, setEditingCreative] = useState(null);
  const [loading, setLoading] = useState(true);
  const [productSearch, setProductSearch] = useState('');

  // Branded form state
  const [brandedType, setBrandedType] = useState('branded_lifestyle');
  const [brandedPrompt, setBrandedPrompt] = useState('');
  const [brandedStyle, setBrandedStyle] = useState('lifestyle');
  const [brandedModel, setBrandedModel] = useState(true);
  const [brandedCount, setBrandedCount] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [genCompleted, setGenCompleted] = useState(0);

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

  const fetchCreatives = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStudioCreatives(storeId, mode === 'branded' ? 'branded' : null);
      if (data) setCreatives(data);
    } catch (err) { console.error(err); toast.error(`Failed to load creatives: ${err.message}`); }
    finally { setLoading(false); }
  }, [storeId, mode]);

  useEffect(() => { fetchCreatives(); }, [fetchCreatives]);

  useEffect(() => {
    if (storeId) getAllProducts(storeId).then(setProducts).catch(() => {});
  }, [storeId]);

  // Pre-select product from navigation
  useEffect(() => {
    if (initialProductId && products.length > 0) {
      const p = products.find((x) => x.id === initialProductId);
      if (p) { setSelectedProduct(p); setMode('product'); }
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

  const handleGenerateBranded = async () => {
    if (!brandedPrompt.trim()) return;
    setGenerating(true);
    setGenCompleted(0);
    toast.info('Generating branded content...');
    const promises = Array.from({ length: brandedCount }, () =>
      generateBranded({ store_id: storeId, type: brandedType, prompt: brandedPrompt, style: brandedStyle, show_model: brandedModel })
        .then(() => setGenCompleted((p) => p + 1))
        .catch(() => { toast.error('Branded generation failed'); })
    );
    await Promise.allSettled(promises);
    toast.success(`${genCompleted} branded creative(s) generated!`);
    setGenerating(false);
    fetchCreatives();
  };

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
      for (let i = 0; i < bulkCount; i++) {
        allJobs.push({ productId });
      }
    }

    // Process in batches of 10 to avoid Vercel timeout
    const BATCH_SIZE = 10;
    for (let b = 0; b < allJobs.length; b += BATCH_SIZE) {
      const batch = allJobs.slice(b, b + BATCH_SIZE);
      await Promise.allSettled(batch.map((job) =>
        generateCreatives({
          product_id: job.productId, store_id: storeId, style: bulkStyle,
          ai_model: bulkModel, show_model: bulkSubject, text_overlay: 'none',
          aspect_ratio: bulkRatio,
          custom_prompt: customPrompt || undefined,
        }).then(() => setBulkCompleted((p) => p + 1))
          .catch((err) => { console.error(`Bulk gen failed for ${job.productId}:`, err); setBulkCompleted((p) => p + 1); })
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

  const handleApprove = async (id) => {
    try { await approveAd(id, 'Team'); toast.success('Creative approved!'); } catch (e) { console.error(e); }
    setCreatives((prev) => prev.map((c) => c.id === id ? { ...c, status: 'approved' } : c));
    setEditingCreative(null);
  };
  const handleReject = async (id, reason) => {
    try { await rejectAd(id, 'Team', reason); toast.success('Creative rejected'); } catch (e) { console.error(e); }
    setCreatives((prev) => prev.filter((c) => c.id !== id));
    setEditingCreative(null);
  };

  const filteredProducts = products.filter((p) =>
    !productSearch || p.title.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, mode === 'bulk' ? 200 : 20);

  const filteredCreatives = mode === 'branded'
    ? creatives.filter((c) => c.type?.startsWith('branded'))
    : selectedProduct
      ? creatives.filter((c) => c.product_id === selectedProduct.id)
      : creatives.filter((c) => c.product_id && c.type === 'product');

  return (
    <div className="studio">
      <div className="studio-header">
        <div className="studio-title gradient-heading">Studio</div>
        <div className="studio-store">{store?.name}</div>
      </div>

      <div className="studio-mode">
        <button className={`studio-mode-btn${mode === 'branded' ? ' studio-mode-btn--active' : ''}`} onClick={() => { setMode('branded'); setSelectedProduct(null); }}>
          Branded Content
        </button>
        <button className={`studio-mode-btn${mode === 'product' ? ' studio-mode-btn--active' : ''}`} onClick={() => setMode('product')}>
          Product Creatives
        </button>
        <button className={`studio-mode-btn${mode === 'bulk' ? ' studio-mode-btn--active' : ''}`} onClick={() => { setMode('bulk'); setSelectedProduct(null); }}>
          Bulk Generate
        </button>
      </div>

      {mode === 'branded' && (
        <div className="studio-branded">
          <div className="studio-card">
            <div className="studio-card-title gradient-heading">Generate Branded Content</div>

            <div className="studio-field-label">Type</div>
            <div className="studio-pills">
              {BRANDED_TYPES.map((t) => (
                <button key={t.key} className={`studio-pill${brandedType === t.key ? ' studio-pill--active' : ''}`} onClick={() => setBrandedType(t.key)}>{t.label}</button>
              ))}
            </div>

            <div className="studio-field-label">Describe what you want</div>
            <textarea className="studio-textarea" value={brandedPrompt} onChange={(e) => setBrandedPrompt(e.target.value)}
              placeholder='e.g. "Woman walking on beach at sunset, vacation vibes, brand colors"' rows={3} />

            <div className="studio-row">
              <div>
                <div className="studio-field-label">Style</div>
                <div className="studio-pills">
                  {STYLES.map((s) => (
                    <button key={s.key} className={`studio-pill${brandedStyle === s.key ? ' studio-pill--active' : ''}`} onClick={() => setBrandedStyle(s.key)}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="studio-field-label">Subject</div>
                <div className="studio-pills">
                  <button className={`studio-pill${brandedModel ? ' studio-pill--active' : ''}`} onClick={() => setBrandedModel(true)}>On Model</button>
                  <button className={`studio-pill${!brandedModel ? ' studio-pill--active' : ''}`} onClick={() => setBrandedModel(false)}>No Model</button>
                </div>
              </div>
              <div>
                <div className="studio-field-label">Count</div>
                <div className="studio-pills">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} className={`studio-pill studio-pill--sm${brandedCount === n ? ' studio-pill--active' : ''}`} onClick={() => setBrandedCount(n)}>{n}</button>
                  ))}
                </div>
              </div>
            </div>

            <button className="studio-generate-btn" onClick={handleGenerateBranded} disabled={generating || !brandedPrompt.trim()}>
              {generating ? `Generating ${genCompleted}/${brandedCount}...` : `Generate ${brandedCount} Branded`}
            </button>
          </div>
        </div>
      )}

      {mode === 'product' && !selectedProduct && (
        <div className="studio-products">
          <div className="studio-card">
            <div className="studio-card-title gradient-heading">Select Product</div>
            <input className="studio-search" type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products..." />
            <div className="studio-product-list">
              {filteredProducts.map((p) => (
                <div key={p.id} className="studio-product-row" onClick={() => setSelectedProduct(p)}>
                  <div className="studio-product-img" style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}} />
                  <div className="studio-product-info">
                    <div className="studio-product-name">{p.title}</div>
                    <div className="studio-product-meta">{p.price ? `$${p.price}` : ''} {p.creative_count > 0 ? `· ${p.creative_count} creatives` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'product' && selectedProduct && (
        <div className="studio-product-selected">
          <Breadcrumbs items={[
            { label: 'Studio', onClick: () => setSelectedProduct(null) },
            { label: selectedProduct.title },
          ]} />
          <div className="studio-selected-header">
            <span className="studio-selected-name">{selectedProduct.title}</span>
            <button className="studio-generate-btn studio-generate-btn--sm" onClick={() => setShowGeneratePanel(true)}>+ Generate</button>
          </div>
        </div>
      )}

      {mode === 'bulk' && (
        <div className="studio-branded">
          <div className="studio-card">
            <div className="studio-card-title gradient-heading">Bulk Generate</div>
            <p style={{ color: 'var(--text4)', fontSize: 12, marginBottom: 16 }}>
              Select products and generate multiple images at once. All run in parallel.
            </p>

            <div className="studio-row" style={{ marginBottom: 12 }}>
              <div>
                <div className="studio-field-label">Style</div>
                <div className="studio-pills">
                  {STYLES.map((s) => (
                    <button key={s.key} className={`studio-pill${bulkStyle === s.key ? ' studio-pill--active' : ''}`} onClick={() => setBulkStyle(s.key)}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="studio-field-label">Images per product</div>
                <div className="studio-pills">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} className={`studio-pill studio-pill--sm${bulkCount === n ? ' studio-pill--active' : ''}`} onClick={() => setBulkCount(n)}>{n}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="studio-row" style={{ marginBottom: 12 }}>
              <div>
                <div className="studio-field-label">AI Model</div>
                <div className="studio-pills">
                  {[['fal_nano_banana', 'Nano Banana'], ['fal_flux2_edit', 'FLUX.2'], ['fal_flux2_pro_edit', 'FLUX.2 Pro'], ['fal_ideogram_bg', 'Ideogram BG']].map(([k, l]) => (
                    <button key={k} className={`studio-pill${bulkModel === k ? ' studio-pill--active' : ''}`} onClick={() => setBulkModel(k)}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="studio-field-label">Subject</div>
                <div className="studio-pills">
                  <button className={`studio-pill${bulkSubject ? ' studio-pill--active' : ''}`} onClick={() => setBulkSubject(true)}>On Model</button>
                  <button className={`studio-pill${!bulkSubject ? ' studio-pill--active' : ''}`} onClick={() => setBulkSubject(false)}>No Model</button>
                </div>
              </div>
              <div>
                <div className="studio-field-label">Aspect Ratio</div>
                <div className="studio-pills">
                  {['1:1', '4:5', '9:16', '16:9'].map((r) => (
                    <button key={r} className={`studio-pill studio-pill--sm${bulkRatio === r ? ' studio-pill--active' : ''}`} onClick={() => setBulkRatio(r)}>{r}</button>
                  ))}
                </div>
              </div>
            </div>

            {bulkSubject && (
              <div className="studio-row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="studio-field-label">Body Type</div>
                  <div className="studio-pills">
                    {['Auto', 'Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'].map((b) => (
                      <button key={b} className={`studio-pill${bulkBodyType === b ? ' studio-pill--active' : ''}`} onClick={() => setBulkBodyType(b)}>{b}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="studio-field-label">Framing</div>
                  <div className="studio-pills">
                    {['Full body', 'Cropped with head', 'Head crop'].map((f) => (
                      <button key={f} className={`studio-pill${bulkFraming === f ? ' studio-pill--active' : ''}`} onClick={() => setBulkFraming(f)}>{f}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="studio-field-label" style={{ margin: 0 }}>Products ({bulkSelected.size}/{products.length})</div>
              <button className="studio-pill studio-pill--sm" onClick={toggleBulkAll} style={{ cursor: 'pointer' }}>
                {bulkSelected.size === products.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <input className="studio-search" type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products..." style={{ marginBottom: 8 }} />

            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
              {filteredProducts.map((p) => (
                <div key={p.id} onClick={() => toggleBulkProduct(p.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 8, cursor: 'pointer', transition: 'background 150ms',
                  background: bulkSelected.has(p.id) ? 'var(--accent-primary-soft)' : 'transparent',
                  border: `1px solid ${bulkSelected.has(p.id) ? 'rgba(139,92,246,0.2)' : 'transparent'}`,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${bulkSelected.has(p.id) ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                    background: bulkSelected.has(p.id) ? 'var(--accent-primary)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11,
                  }}>{bulkSelected.has(p.id) ? '✓' : ''}</div>
                  {p.image_url && <img src={p.image_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                  </div>
                </div>
              ))}
            </div>

            <button className="studio-generate-btn" onClick={handleBulkGenerate} disabled={bulkGenerating || bulkSelected.size === 0}>
              {bulkGenerating
                ? `Generating ${bulkCompleted}/${bulkTotal}...`
                : `Generate ${bulkSelected.size * bulkCount} images (${bulkSelected.size} products × ${bulkCount})`
              }
            </button>

            {bulkGenerating && (
              <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: 'var(--bg-surface)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent-primary)', transition: 'width 0.3s', width: `${bulkTotal > 0 ? (bulkCompleted / bulkTotal) * 100 : 0}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery — split by format */}
      {filteredCreatives.length > 0 && (
        <div className="studio-gallery">
          <MediaSection
            title="Images"
            items={filteredCreatives.filter((c) => c.format === 'image')}
            onClickItem={setEditingCreative}
          />
          <MediaSection
            title="Videos"
            items={filteredCreatives.filter((c) => c.format === 'video')}
            onClickItem={setEditingCreative}
            isVideo
          />
        </div>
      )}

      {showGeneratePanel && selectedProduct && (
        <CreativeStudio
          product={selectedProduct}
          storeId={storeId}
          creatives={filteredCreatives}
          onClose={() => setShowGeneratePanel(false)}
          onGenerated={() => { setShowGeneratePanel(false); fetchCreatives(); }}
        />
      )}

      <CreativeEditor
        creative={editingCreative}
        open={!!editingCreative}
        storeId={storeId}
        onClose={() => setEditingCreative(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onSave={() => {}}
      />
    </div>
  );
}

function MediaSection({ title, items, onClickItem, isVideo }) {
  if (items.length === 0) return null;

  const pendingItems = items.filter((c) => c.status === 'pending');
  const approvedItems = items.filter((c) => c.status === 'approved');
  const metadata = (c) => {
    if (!isVideo) return null;
    return typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {});
  };

  return (
    <div className="studio-media-section">
      <div className="studio-section-title">
        {title} <span className="studio-count">{items.length}</span>
      </div>

      {pendingItems.length > 0 && (
        <>
          <div className="studio-subsection-title">Pending</div>
          <div className="studio-grid">
            {pendingItems.map((c) => {
              const thumbUrl = isVideo ? metadata(c)?.source_image_url || c.file_url : c.file_url;
              return (
                <div key={c.id} className="studio-thumb" onClick={() => onClickItem(c)}>
                  <div className="studio-thumb-img" style={thumbUrl ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                    {isVideo && <span className="studio-play-icon">▶</span>}
                    <span className="pill pending">pending</span>
                  </div>
                  <div className="studio-thumb-label">{c.hook_used?.slice(0, 40) || c.type}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {approvedItems.length > 0 && (
        <>
          <div className="studio-subsection-title" style={{ color: 'var(--accent-success)' }}>Approved</div>
          <div className="studio-grid">
            {approvedItems.map((c) => {
              const thumbUrl = isVideo ? metadata(c)?.source_image_url || c.file_url : c.file_url;
              return (
                <div key={c.id} className="studio-thumb" onClick={() => onClickItem(c)}>
                  <div className="studio-thumb-img" style={thumbUrl ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                    {isVideo && <span className="studio-play-icon">▶</span>}
                    <span className="pill approved">approved</span>
                  </div>
                  <div className="studio-thumb-label">{c.hook_used?.slice(0, 40) || c.type}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

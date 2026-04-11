import { useState, useEffect, useCallback } from 'react';
import { getAllProducts, getStudioCreatives, generateBranded, generateCreatives } from '../lib/api';
import GeneratePanel from '../components/GeneratePanel';
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
  ).slice(0, 20);

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
        <GeneratePanel
          product={selectedProduct}
          mode="image"
          defaultStyle="ad_creative"
          creatives={filteredCreatives}
          storeId={storeId}
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

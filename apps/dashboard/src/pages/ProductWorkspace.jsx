import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { getProductCreatives } from '../lib/api';
import supabase from '../lib/supabase';
import CreativeStudio from '../components/CreativeStudio';
import CreativeEditor from '../components/CreativeEditor';
import CreativeDetailModal, { mapCreativeToModalData } from '../components/CreativeDetailModal';
import OptimizePanel from '../components/OptimizePanel';
import PhotoStoryModal from '../components/PhotoStoryModal';
import { approveAd, rejectAd, updateCreative, convertToVideo, pushCreativeToShopify, pollGenerations } from '../lib/api';
import Breadcrumbs from '../components/Breadcrumbs';
import { SkeletonGrid } from '../components/Skeleton';
import { useToast } from '../hooks/useToast.jsx';
import './ProductWorkspace.css';

const ProductDetail = lazy(() => import('../components/ProductDetail'));

const STYLES = [
  { key: 'ad_creative', label: 'Ad Creatives' },
  { key: 'product_shot', label: 'Product Shots' },
  { key: 'product_photo_beach', label: 'Beach Photo' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'review_ugc', label: 'Review / UGC' },
  { key: 'static_clean', label: 'Clean Minimal' },
  { key: 'static_split', label: 'Split Screen' },
  { key: 'static_urgency', label: 'Urgency / Sale' },
];

export default function ProductWorkspace({ product, onBack, onNavigateToStudio, storeId, store }) {
  const toast = useToast();
  const [activeStyle, setActiveStyle] = useState('ad_creative');
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateMode, setGenerateMode] = useState('image');
  const [editingCreative, setEditingCreative] = useState(null);
  const [showOptimize, setShowOptimize] = useState(false);
  const [showPhotoStory, setShowPhotoStory] = useState(false);

  const fetchCreatives = useCallback(async () => {
    try {
      const data = await getProductCreatives(product.id);
      if (data) setCreatives(data);
    } catch (err) {
      console.error('Failed to fetch creatives:', err);
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    fetchCreatives();
    const channel = supabase
      .channel(`product-${product.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'creatives' },
        (payload) => { if (payload.new.product_id === product.id) setCreatives((prev) => [payload.new, ...prev]); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'creatives' },
        (payload) => { setCreatives((prev) => prev.map((c) => c.id === payload.new.id ? { ...c, ...payload.new } : c)); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'creatives' },
        (payload) => { setCreatives((prev) => prev.filter((c) => c.id !== payload.old.id)); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [product.id, fetchCreatives]);

  // Poll fal.ai jobs while any creative is still generating
  useEffect(() => {
    if (!storeId) return;
    const hasPending = creatives.some((c) => c.status === 'generating');
    if (!hasPending) return;
    const tick = () => { pollGenerations(storeId).catch((err) => console.warn('[ProductWorkspace] poll failed:', err.message)); };
    tick();
    const iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, [storeId, creatives]);

  const generating = useMemo(() => creatives.filter((c) => c.status === 'generating' && (c.style || 'ad_creative') === activeStyle), [creatives, activeStyle]);
  const pending = useMemo(() => creatives.filter((c) => c.status === 'pending' && (c.style || 'ad_creative') === activeStyle), [creatives, activeStyle]);
  const approved = useMemo(() => creatives.filter((c) => (c.status === 'approved' || c.status === 'published') && (c.style || 'ad_creative') === activeStyle), [creatives, activeStyle]);

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

  const totalPending = creatives.filter((c) => c.status === 'pending').length;
  const totalApproved = creatives.filter((c) => c.status === 'approved' || c.status === 'published').length;

  return (
    <div className="pw">
      {/* Header bar */}
      <div className="pw-topbar">
        <Breadcrumbs items={[
          { label: 'Products', onClick: onBack },
          { label: product.title },
        ]} />
        <div className="pw-topbar-actions">
          <button className="pw-action-btn" onClick={() => { setGenerateMode('image'); setShowGenerate(true); }}>+ Image</button>
          <button className="pw-action-btn pw-action-btn--video" onClick={() => { setGenerateMode('video'); setShowGenerate(true); }}>+ Video</button>
          <button className="pw-action-btn pw-action-btn--story" onClick={() => setShowPhotoStory(true)}>Photo Story</button>
          <button className="pw-action-btn pw-action-btn--optimize" onClick={() => setShowOptimize(true)}>Optimize</button>
          {onNavigateToStudio && (
            <button className="pw-action-btn pw-action-btn--muted" onClick={() => onNavigateToStudio(product.id)}>Studio</button>
          )}
        </div>
      </div>

      {/* ══ PRODUCT EDITOR (Shopify-style) ══ */}
      <Suspense fallback={<div className="pw-detail-loading">Loading...</div>}>
        <ProductDetail product={product} storeId={storeId} store={store} />
      </Suspense>

      {/* ══ CREATIVES SECTION ══ */}
      <div className="pw-creatives-section">
        <div className="pw-creatives-header">
          <div className="pw-creatives-title">Ad Creatives</div>
          <div className="pw-creatives-stats">
            <span>{totalPending} pending</span>
            <span>{totalApproved} approved</span>
            {onNavigateToStudio && (
              <button className="pw-action-btn pw-action-btn--muted" style={{ marginLeft: 8, fontSize: 10 }} onClick={() => onNavigateToStudio(product.id)}>View all in Studio →</button>
            )}
          </div>
        </div>

        <div className="pw-tabs">
          {STYLES.map((s) => {
            const count = creatives.filter((c) => (c.style || 'ad_creative') === s.key).length;
            return (
              <button key={s.key} className={`pw-tab${activeStyle === s.key ? ' pw-tab--active' : ''}`}
                onClick={() => setActiveStyle(s.key)}>
                {s.label} {count > 0 && <span className="pw-tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {loading ? (
          <SkeletonGrid count={4} />
        ) : (
          <>
            {generating.length > 0 && (
              <div className="pw-section">
                <div className="pw-section-title pw-section-title--generating">
                  Generating...<span className="pw-section-count">{generating.length}</span>
                </div>
                <div className="pw-grid">
                  {generating.map((c) => (
                    <div key={c.id} className="pw-card pw-card--generating">
                      <div className="pw-card-img" style={{ background: 'var(--surface)' }}>
                        <div className="pw-generating-spinner" />
                      </div>
                      <div className="pw-card-body">
                        <div className="pw-card-hook">Generating image...</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pending.length > 0 && (
              <div className="pw-section">
                <div className="pw-section-title">Review & Approve<span className="pw-section-count">{pending.length}</span></div>
                <div className="pw-grid">
                  {pending.map((c) => <CreativeCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} />)}
                </div>
              </div>
            )}

            {approved.length > 0 && (
              <div className="pw-section">
                <div className="pw-section-title pw-section-title--approved">Approved<span className="pw-section-count pw-section-count--approved">{approved.length}</span></div>
                <div className="pw-grid">
                  {approved.map((c) => <CreativeCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} status="approved" />)}
                </div>
              </div>
            )}

            {generating.length === 0 && pending.length === 0 && approved.length === 0 && (
              <div className="pw-empty">
                <div>No {STYLES.find((s) => s.key === activeStyle)?.label.toLowerCase()} yet</div>
                <div className="pw-empty-actions">
                  <button className="pw-action-btn-sm" onClick={() => { setGenerateMode('image'); setShowGenerate(true); }}>+ Image</button>
                  <button className="pw-action-btn-sm pw-action-btn-sm--video" onClick={() => { setGenerateMode('video'); setShowGenerate(true); }}>+ Video</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showGenerate && (
        <CreativeStudio product={product} storeId={storeId} creatives={creatives}
          onClose={() => setShowGenerate(false)} onGenerated={() => { setShowGenerate(false); fetchCreatives(); }} />
      )}
      {editingCreative && (() => {
        const idx = creatives.findIndex(c => c.id === editingCreative.id);
        return (
          <CreativeDetailModal
            data={mapCreativeToModalData(editingCreative)}
            onClose={() => setEditingCreative(null)}
            onPrev={idx > 0 ? () => setEditingCreative(creatives[idx - 1]) : null}
            onNext={idx < creatives.length - 1 ? () => setEditingCreative(creatives[idx + 1]) : null}
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
      {showOptimize && (
        <OptimizePanel product={product} onClose={() => setShowOptimize(false)} onApplied={() => { setShowOptimize(false); }} />
      )}
      {showPhotoStory && (
        <PhotoStoryModal product={product} storeId={storeId}
          onClose={() => setShowPhotoStory(false)}
          onCompleted={() => { setShowPhotoStory(false); fetchCreatives(); }}
        />
      )}
    </div>
  );
}

function CreativeCard({ creative: c, onClick, status }) {
  const isVideo = c.format === 'video';
  const metadata = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {});
  const thumbUrl = metadata.source_image_url || c.file_url;

  return (
    <div className="pw-card" onClick={onClick}>
      <div className="pw-card-img" style={
        thumbUrl ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'var(--surface)' }
      }>
        {isVideo && <span className="pw-card-play">+</span>}
        {status === 'approved' && <span className="pw-card-check">+</span>}
        {c.status === 'published' && <span className="pill published" style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, padding: '2px 7px' }}>Published</span>}
        {!status && <span className="pill pending">pending</span>}
      </div>
      <div className="pw-card-body">
        <div className="pw-card-hook">{c.hook_used?.slice(0, 60) || c.headline?.slice(0, 60)}</div>
        <div className="pw-card-meta">
          <span className="pw-card-variant">v{c.variant_index}</span>
          {isVideo && <span className="pw-card-format-badge">VIDEO</span>}
        </div>
      </div>
    </div>
  );
}

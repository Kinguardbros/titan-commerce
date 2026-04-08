import { useState, useEffect, useCallback, useMemo } from 'react';
import { getProductCreatives } from '../lib/api';
import supabase from '../lib/supabase';
import GeneratePanel from '../components/GeneratePanel';
import CreativeEditor from '../components/CreativeEditor';
import OptimizePanel from '../components/OptimizePanel';
import { approveAd, rejectAd, updateCreative } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './ProductWorkspace.css';

const STYLES = [
  { key: 'ad_creative', label: 'Ad Creatives' },
  { key: 'product_shot', label: 'Product Shots' },
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
        (payload) => {
          if (payload.new.product_id === product.id) {
            setCreatives((prev) => [payload.new, ...prev]);
          }
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'creatives' },
        (payload) => {
          setCreatives((prev) => prev.map((c) => c.id === payload.new.id ? { ...c, ...payload.new } : c));
        }
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'creatives' },
        (payload) => {
          setCreatives((prev) => prev.filter((c) => c.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [product.id, fetchCreatives]);

  // Split by status
  const generating = useMemo(() =>
    creatives.filter((c) => c.status === 'generating' && (c.style || 'ad_creative') === activeStyle),
    [creatives, activeStyle]
  );
  const pending = useMemo(() =>
    creatives.filter((c) => c.status === 'pending' && (c.style || 'ad_creative') === activeStyle),
    [creatives, activeStyle]
  );
  const approved = useMemo(() =>
    creatives.filter((c) => c.status === 'approved' && (c.style || 'ad_creative') === activeStyle),
    [creatives, activeStyle]
  );

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

  const images = JSON.parse(product.images || '[]');
  const totalPending = creatives.filter((c) => c.status === 'pending').length;
  const totalApproved = creatives.filter((c) => c.status === 'approved').length;

  return (
    <div className="pw">
      <button className="pw-back" onClick={onBack}>← Back to Products</button>

      <div className="pw-header">
        <div className="pw-hero" style={
          product.image_url
            ? { backgroundImage: `url(${product.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: 'var(--surface)' }
        } />
        <div className="pw-info">
          <div className="pw-title">{product.title}</div>
          {product.price && <div className="pw-price">${product.price}</div>}
          <div className="pw-meta">
            {product.handle && <span>{product.handle}</span>}
            <span>{images.length} product images</span>
            <span>{totalPending} pending</span>
            <span>{totalApproved} approved</span>
          </div>
        </div>
        <div className="pw-generate-group">
          <button className="pw-generate-btn" onClick={() => { setGenerateMode('image'); setShowGenerate(true); }}>
            + Image
          </button>
          <button className="pw-generate-btn pw-generate-btn--video" onClick={() => { setGenerateMode('video'); setShowGenerate(true); }}>
            ▶ Video
          </button>
          <button className="pw-generate-btn pw-generate-btn--optimize" onClick={() => setShowOptimize(true)}>
            ✨ Optimize
          </button>
          {onNavigateToStudio && (
            <button className="pw-generate-btn" onClick={() => onNavigateToStudio(product.id)} style={{ opacity: 0.6 }}>
              Studio →
            </button>
          )}
        </div>
      </div>

      <div className="pw-tabs">
        {STYLES.map((s) => {
          const count = creatives.filter((c) => (c.style || 'ad_creative') === s.key).length;
          return (
            <button
              key={s.key}
              className={`pw-tab${activeStyle === s.key ? ' pw-tab--active' : ''}`}
              onClick={() => setActiveStyle(s.key)}
            >
              {s.label} {count > 0 && <span className="pw-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="pw-empty">Loading...</div>
      ) : (
        <>
          {/* Generating — waiting for Higgsfield */}
          {generating.length > 0 && (
            <div className="pw-section">
              <div className="pw-section-title pw-section-title--generating">
                Generating...
                <span className="pw-section-count">{generating.length}</span>
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

          {/* Pending — new creatives to review */}
          {pending.length > 0 && (
            <div className="pw-section">
              <div className="pw-section-title">
                New — Review & Approve
                <span className="pw-section-count">{pending.length}</span>
              </div>
              <div className="pw-grid">
                {pending.map((c) => (
                  <CreativeCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} />
                ))}
              </div>
            </div>
          )}

          {/* Approved — passed the review */}
          {approved.length > 0 && (
            <div className="pw-section">
              <div className="pw-section-title pw-section-title--approved">
                Approved
                <span className="pw-section-count pw-section-count--approved">{approved.length}</span>
              </div>
              <div className="pw-grid">
                {approved.map((c) => (
                  <CreativeCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} status="approved" />
                ))}
              </div>
            </div>
          )}

          {generating.length === 0 && pending.length === 0 && approved.length === 0 && (
            <div className="pw-empty">
              <div>No {STYLES.find((s) => s.key === activeStyle)?.label.toLowerCase()} yet</div>
              <div className="pw-generate-group">
                <button className="pw-generate-btn-sm" onClick={() => { setGenerateMode('image'); setShowGenerate(true); }}>+ Image</button>
                <button className="pw-generate-btn-sm pw-generate-btn-sm--video" onClick={() => { setGenerateMode('video'); setShowGenerate(true); }}>▶ Video</button>
              </div>
            </div>
          )}
        </>
      )}

      {showGenerate && (
        <GeneratePanel
          product={product}
          mode={generateMode}
          defaultStyle={activeStyle}
          creatives={creatives}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { setShowGenerate(false); fetchCreatives(); }}
        />
      )}

      <CreativeEditor
        creative={editingCreative}
        open={!!editingCreative}
        onClose={() => setEditingCreative(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onSave={handleSave}
      />

      {showOptimize && (
        <OptimizePanel
          product={product}
          onClose={() => setShowOptimize(false)}
          onApplied={() => { setShowOptimize(false); }}
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
        thumbUrl
          ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'var(--surface)' }
      }>
        {isVideo && <span className="pw-card-play">▶</span>}
        {status === 'approved' && <span className="pw-card-check">✓</span>}
        {!status && <span className={`pill pending`}>pending</span>}
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

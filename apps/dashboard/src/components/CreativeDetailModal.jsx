import { useState, useRef, useEffect } from 'react';
import './CreativeDetailModal.css';

const STATUS_MAP = {
  approved: { label: 'Approved', color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', icon: '✓' },
  pending: { label: 'Pending', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', icon: '○' },
  rejected: { label: 'Rejected', color: '#EF4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', icon: '✕' },
  published: { label: 'Published', color: '#10B981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', icon: '✓' },
};

function DropdownBtn({ icon, label, items, onAction, dropUp = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="cdm-dropdown">
      <button onClick={() => setOpen(p => !p)} className="cdm-dropdown-btn">
        <span style={{ fontSize: 15 }}>{icon}</span>
        {label}
        <span className="cdm-dropdown-arrow" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
      </button>
      {open && (
        <div className={`cdm-dropdown-menu ${dropUp ? 'cdm-dropdown-menu--up' : 'cdm-dropdown-menu--down'}`}>
          {items.map(item => (
            <button key={item.id} className="cdm-dropdown-item" style={item.color ? { color: item.color } : undefined}
              onClick={() => { onAction(item.id); setOpen(false); }}>
              <span className="cdm-dropdown-item-icon" style={item.color ? { color: item.color } : undefined}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="cdm-detail-row">
      <span className="cdm-detail-label">{label}</span>
      <span className={`cdm-detail-value${mono ? ' cdm-detail-value--mono' : ''}`}>{value}</span>
    </div>
  );
}

export function mapCreativeToModalData(creative) {
  const meta = creative.metadata
    ? (typeof creative.metadata === 'string' ? JSON.parse(creative.metadata) : creative.metadata)
    : {};
  const ratioMap = { '1:1': '1080 × 1080', '4:5': '1080 × 1350', '9:16': '1080 × 1920', '16:9': '1920 × 1080' };
  const ar = creative.aspect_ratio || '1:1';
  return {
    id: creative.id,
    product: creative.product?.title || creative.product_title || creative.headline || 'Unknown',
    imageUrl: creative.file_url,
    status: creative.status || 'pending',
    variant: `v${meta.variant || 1}`,
    abVariant: meta.ab_variant || null,
    style: creative.style || 'ad_creative',
    format: creative.format || 'image',
    aspectRatio: ar,
    resolution: ratioMap[ar] || '1080 × 1080',
    created: creative.created_at ? new Date(creative.created_at).toLocaleString() : '',
    model: meta.model || 'Nano Banana 2',
    provider: meta.provider || 'fal.ai',
    pose: creative.hook_used || meta.pose || '',
    scene: meta.scene || '',
    subject: creative.show_model === false ? 'Product only' : 'On model',
    bodyType: meta.body_type || '',
    framing: meta.framing || '',
    seed: meta.seed || null,
    cfgScale: meta.cfg_scale || null,
    steps: meta.steps || null,
    promptLines: meta.prompt_lines || null,
    negativePrompt: meta.negative_prompt || '',
    tags: meta.tags || [],
    fileUrl: creative.file_url,
  };
}

export default function CreativeDetailModal({ data, onClose, onAction, onPrev, onNext }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [showNeg, setShowNeg] = useState(false);
  const status = STATUS_MAP[data.status] || STATUS_MAP.pending;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPrev, onNext, onClose]);

  const configRows = [
    { label: 'Model', value: data.model },
    { label: 'Provider', value: data.provider, mono: true },
    { label: 'Style', value: data.style, mono: true },
    { label: 'Subject', value: data.subject },
    ...(data.subject === 'On model' ? [
      data.pose && { label: 'Pose', value: data.pose },
      data.bodyType && { label: 'Body type', value: data.bodyType },
      data.framing && { label: 'Framing', value: data.framing },
    ] : []),
    data.scene && { label: 'Scene', value: data.scene },
    data.cfgScale != null && { label: 'CFG scale', value: String(data.cfgScale), mono: true },
    data.steps != null && { label: 'Steps', value: String(data.steps), mono: true },
    { label: 'Aspect ratio', value: data.aspectRatio, mono: true },
    { label: 'Resolution', value: data.resolution, mono: true },
    data.promptLines != null && { label: 'Prompt lines', value: String(data.promptLines), mono: true },
    { label: 'Created', value: data.created, mono: true },
  ].filter(Boolean);

  return (
    <div className="cdm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div className="cdm-modal">
        {/* Left: Image */}
        <div className="cdm-image-pane">
          {!imgLoaded && <div className="cdm-spinner"><div className="cdm-spinner-ring" /></div>}
          <img src={data.imageUrl} alt={data.product} onLoad={() => setImgLoaded(true)} style={{ opacity: imgLoaded ? 1 : 0 }} />
          {onPrev && <button className="cdm-nav cdm-nav--prev" onClick={onPrev} aria-label="Previous">‹</button>}
          {onNext && <button className="cdm-nav cdm-nav--next" onClick={onNext} aria-label="Next">›</button>}
          <div className="cdm-image-badges">
            <div className="cdm-badge-pill">{data.aspectRatio}</div>
            <div className="cdm-badge-pill">{data.resolution}</div>
          </div>
          <div className="cdm-status-badge" style={{ background: status.bg, color: status.color, borderColor: status.border, border: `1px solid ${status.border}` }}>
            <span style={{ fontSize: 11 }}>{status.icon}</span>{status.label}
          </div>
          {data.abVariant && <div className="cdm-ab-badge">A/B {data.abVariant}</div>}
        </div>

        {/* Right: Panel */}
        <div className="cdm-panel">
          {/* Header */}
          <div className="cdm-header">
            <div className="cdm-toolbar">
              <DropdownBtn icon="↓" label="Export" items={[
                { id: 'download', icon: '↓', label: 'Download image' },
                { id: 'push-shopify', icon: '⬡', label: 'Push to Shopify' },
                { id: 'push-meta', icon: '◎', label: 'Push to Meta Ads' },
                { id: 'copy-url', icon: '◇', label: 'Copy public URL' },
              ]} onAction={onAction} dropUp={false} />
              <button className="cdm-close-btn" onClick={onClose}>✕</button>
            </div>
            <div className="cdm-product-info">
              <span className="cdm-product-status" style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>{status.label}</span>
              <span className="cdm-product-meta">{data.format} — {data.variant}</span>
            </div>
            <h2 className="cdm-product-title">{data.product}</h2>
          </div>

          {/* Scrollable body */}
          <div className="cdm-body">
            <div className="cdm-section-head">Generation config</div>
            <div className="cdm-config-table">
              <div className="cdm-config-scroll">
                {configRows.map((row, i) => (
                  <div key={row.label}>
                    {i > 0 && <div className="cdm-divider" />}
                    <DetailRow label={row.label} value={row.value} mono={row.mono} />
                  </div>
                ))}
              </div>
            </div>

            {data.negativePrompt && (
              <div>
                <button className="cdm-neg-toggle" onClick={() => setShowNeg(p => !p)} style={{ color: showNeg ? '#6C47FF' : '#A1A1AA' }}>
                  <span style={{ fontSize: 7, transform: showNeg ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
                  Negative prompt
                </button>
                {showNeg && <div className="cdm-neg-content">{data.negativePrompt}</div>}
              </div>
            )}

            {data.tags?.length > 0 && (
              <>
                <div className="cdm-section-head">Tags</div>
                <div className="cdm-tags">
                  {data.tags.map(t => <span key={t} className="cdm-tag">{t}</span>)}
                </div>
              </>
            )}
            <div style={{ height: 16 }} />
          </div>

          {/* Footer */}
          <div className="cdm-footer">
            <div className="cdm-footer-inner">
              <div className="cdm-footer-actions">
                <button className="cdm-btn-approve" onClick={() => onAction('approve')}>
                  <span style={{ fontSize: 16 }}>✓</span>Approve
                </button>
                <button className="cdm-btn-reject" onClick={() => onAction('reject')}>
                  <span style={{ fontSize: 14 }}>✕</span>Reject
                </button>
              </div>
              <div className="cdm-footer-divider" />
              <DropdownBtn icon="↻" label="Generate" items={[
                { id: 'regenerate', icon: '↻', label: 'Regenerate image' },
                { id: 'convert-video', icon: '▶', label: 'Convert to video' },
                { id: 'regenerate-variant', icon: '◫', label: 'New variant' },
              ]} onAction={onAction} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

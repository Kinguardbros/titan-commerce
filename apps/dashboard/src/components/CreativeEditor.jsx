import { useState, useEffect } from 'react';
import { regenerateCreative, convertToVideo, pushCreativeToShopify } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './CreativeEditor.css';

export default function CreativeEditor({ creative, open, onClose, onApprove, onReject, onSave, onRegenerate, storeId }) {
  const toast = useToast();
  const [hook, setHook] = useState('');
  const [headline, setHeadline] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showApproveInput, setShowApproveInput] = useState(false);
  const [approveComment, setApproveComment] = useState('');

  useEffect(() => {
    if (open && creative) {
      setHook(creative.hook_used || '');
      setHeadline(creative.headline || '');
      setImageUrl(creative.file_url || '');
      setDirty(false);
    }
  }, [open, creative]);

  useEffect(() => {
    if (!creative) return;
    setDirty(hook !== (creative.hook_used || '') || headline !== (creative.headline || ''));
  }, [hook, headline, creative]);

  const handleClose = () => {
    setHook('');
    setHeadline('');
    setImageUrl('');
    setDirty(false);
    setRegenerating(false);
    setConverting(false);
    setShowRejectInput(false);
    setRejectReason('');
    setShowApproveInput(false);
    setApproveComment('');
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(creative.id, { hook_used: hook, headline });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      // Save text changes first if dirty
      if (dirty) {
        await onSave(creative.id, { hook_used: hook, headline });
        setDirty(false);
      }
      const updated = await regenerateCreative(creative.id);
      if (updated?.file_url) {
        setImageUrl(updated.file_url + '?t=' + Date.now()); // cache bust
        if (onRegenerate) onRegenerate(creative.id, updated);
      }
      toast.success('New image generated!');
    } catch (err) {
      console.error('Regenerate failed:', err);
      toast.error(`Regeneration failed: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const handleConvertToVideo = async () => {
    setConverting(true);
    try {
      await convertToVideo(creative.id);
      toast.success('Video ready!');
    } catch (err) {
      console.error('Convert to video failed:', err);
      toast.error(`Video conversion failed: ${err.message}`);
    } finally {
      setConverting(false);
    }
  };

  const isVideo = creative?.format === 'video';

  if (!open || !creative) return null;

  const productName = creative.brief?.product_name || creative.headline || 'Creative';
  const hasImage = imageUrl && !imageUrl.includes('undefined');

  return (
    <div className="ce-overlay" onClick={handleClose} onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}>
      <div className="ce-modal" role="dialog" aria-modal="true" aria-label={`Edit creative: ${productName}`} onClick={(e) => e.stopPropagation()}>
        <button className="ce-close" aria-label="Close modal" onClick={handleClose}>✕</button>

        <div className="ce-layout">
          <div className="ce-preview">
            {(regenerating || converting) && (
              <div className="ce-generating">
                <div className="ce-spinner" />
                <div>{converting ? 'Converting to video...' : isVideo ? 'Generating new video...' : 'Generating new image...'}</div>
              </div>
            )}
            {hasImage ? (
              isVideo ? (
                <video
                  src={imageUrl}
                  className={`ce-image${regenerating || converting ? ' ce-image--dim' : ''}`}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img src={imageUrl} alt={productName} className={`ce-image${regenerating || converting ? ' ce-image--dim' : ''}`} />
              )
            ) : (
              <div className="ce-placeholder">No {isVideo ? 'video' : 'image'}</div>
            )}
          </div>

          <div className="ce-editor">
            <div className="ce-section-label">Product</div>
            <div className="ce-product-name">{productName}</div>
            {creative.brief?.price && <div className="ce-price">{creative.brief.price}</div>}

            <div className="ce-divider" />

            <div className="ce-section-label">Headline</div>
            <input
              className="ce-input"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Ad headline..."
            />

            <div className="ce-section-label">Hook / Copy</div>
            <textarea
              className="ce-textarea"
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="Ad copy hook..."
              rows={3}
            />

            <div className="ce-section-label">Preview</div>
            <div className="ce-ad-preview">
              <div className="ce-ad-preview-img">
                {hasImage && (isVideo
                  ? <video src={imageUrl} muted autoPlay loop playsInline />
                  : <img src={imageUrl} alt="" />
                )}
              </div>
              <div className="ce-ad-preview-body">
                <div className="ce-ad-preview-headline">{headline || 'Headline'}</div>
                <div className="ce-ad-preview-hook">{hook || 'Hook text...'}</div>
                <div className="ce-ad-preview-cta">Shop Now</div>
              </div>
            </div>

            <div className="ce-section-label">Details</div>
            <div className="ce-details">
              <div className="ce-detail-row">
                <span>Variant</span><span>v{creative.variant_index}</span>
              </div>
              <div className="ce-detail-row">
                <span>Style</span><span>{creative.style || 'ad_creative'}</span>
              </div>
              <div className="ce-detail-row">
                <span>Format</span><span>{creative.format}</span>
              </div>
              <div className="ce-detail-row">
                <span>Aspect ratio</span><span>{creative.aspect_ratio || '1:1'}</span>
              </div>
              <div className="ce-detail-row">
                <span>Status</span><span className={`pill ${creative.status}`}>{creative.status}</span>
              </div>
              {creative.status === 'published' && (
                <div className="ce-detail-row">
                  <span>Published</span><span style={{ color: 'var(--accent-success)', fontSize: 11 }}>Pushed to Shopify</span>
                </div>
              )}
              <div className="ce-detail-row">
                <span>Created</span><span>{new Date(creative.created_at).toLocaleDateString('en-US')}</span>
              </div>
            </div>

            <div className="ce-actions">
              <button
                className="ce-btn regenerate"
                onClick={handleRegenerate}
                disabled={regenerating || converting}
              >
                {regenerating ? 'Generating...' : isVideo ? 'Regenerate Video' : 'Regenerate Image'}
              </button>
              {!isVideo && (
                <button
                  className="ce-btn convert-video"
                  onClick={handleConvertToVideo}
                  disabled={regenerating || converting}
                >
                  {converting ? 'Converting...' : '▶ Convert to Video'}
                </button>
              )}
              {dirty && (
                <button className="ce-btn save" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              )}
              {!showApproveInput ? (
                <button className="ce-btn approve" onClick={() => setShowApproveInput(true)}>
                  Approve
                </button>
              ) : (
                <div className="ce-approve-box">
                  <textarea
                    className="ce-approve-input"
                    value={approveComment}
                    onChange={(e) => setApproveComment(e.target.value)}
                    placeholder="What do you like about this? (optional)"
                    rows={2}
                    autoFocus
                  />
                  <div className="ce-reject-actions">
                    <button className="ce-btn approve" onClick={() => { onApprove(creative.id, approveComment); handleClose(); }}>
                      Confirm Approve
                    </button>
                    <button className="ce-btn cancel" onClick={() => { setShowApproveInput(false); setApproveComment(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {!showRejectInput ? (
                <button className="ce-btn reject" onClick={() => setShowRejectInput(true)}>
                  Reject
                </button>
              ) : (
                <div className="ce-reject-box">
                  <textarea
                    className="ce-reject-input"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="What's wrong with this image?"
                    rows={2}
                    autoFocus
                  />
                  <div className="ce-reject-actions">
                    <button className="ce-btn reject" onClick={() => { onReject(creative.id, rejectReason); handleClose(); }}>
                      Confirm Reject
                    </button>
                    <button className="ce-btn cancel" onClick={() => { setShowRejectInput(false); setRejectReason(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {(creative.status === 'approved' || creative.status === 'published') && storeId && (
                <button className="ce-btn publish" disabled={pushing} onClick={async () => {
                  setPushing(true);
                  try {
                    await pushCreativeToShopify(creative.id, storeId);
                    toast.success('Image added to product on Shopify!');
                  } catch (err) { toast.error(`Push failed: ${err.message}`); }
                  finally { setPushing(false); }
                }}>
                  {pushing ? 'Pushing...' : creative.status === 'published' ? 'Re-push to Shopify' : 'Push to Shopify'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

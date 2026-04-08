import { useState } from 'react';
import { optimizeProductAPI, approveOptimization, rejectOptimization, saveDraftOptimization } from '../lib/api';
import DOMPurify from 'dompurify';
import { useToast } from '../hooks/useToast.jsx';
import './OptimizePanel.css';

export default function OptimizePanel({ product, existingOptimization, onClose, onApplied }) {
  const toast = useToast();
  const [optimizationId, setOptimizationId] = useState(existingOptimization?.optimization_id || null);
  const [original, setOriginal] = useState(null);
  const [optimized, setOptimized] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [editing, setEditing] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleOptimize = async () => {
    setLoading(true);
    setError('');
    toast.info('Optimizing with AI...');
    try {
      const result = await optimizeProductAPI(product.id, extraContext);
      setOptimizationId(result.optimization_id);
      setOriginal(result.original);
      setOptimized(result.optimized);
      toast.success('Optimization ready — review below');
    } catch (err) {
      setError(err.message || 'Optimization failed');
      toast.error(`Optimization failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!optimizationId || !optimized) return;
    setSaving(true);
    try {
      await saveDraftOptimization(optimizationId, optimized);
      toast.success('Draft saved!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!optimizationId) return;
    setApplying(true);
    setError('');
    try {
      await approveOptimization(optimizationId, optimized);
      toast.success('Published to Shopify!');
      if (onApplied) onApplied();
      onClose();
    } catch (err) {
      setError(err.message.includes('403') ? 'Missing write_products scope. Update your Shopify app permissions.' : err.message);
      toast.error(`Publish failed: ${err.message}`);
      setApplying(false);
    }
  };

  const handleReject = async () => {
    if (!optimizationId) return;
    try {
      await rejectOptimization(optimizationId, rejectReason);
      toast.success('Optimization rejected');
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  // Load existing optimization if provided
  if (existingOptimization && !original && !loading) {
    // Fetch full data — for now just show what we have
    handleOptimize();
  }

  return (
    <div className="op-overlay" onClick={onClose}>
      <div className="op-modal" onClick={(e) => e.stopPropagation()}>
        <button className="op-close" onClick={onClose}>✕</button>
        <div className="op-title">Product Optimizer</div>
        <div className="op-product">{product.title}</div>

        {!optimized && !loading && (
          <>
            <div className="op-section">Extra Context (optional)</div>
            <textarea
              className="op-textarea"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Paste brand notes, competitor analysis, keywords, target audience info..."
              rows={4}
            />
            <button className="op-generate-btn" onClick={handleOptimize}>✨ Optimize with AI</button>
          </>
        )}

        {loading && (
          <div className="op-loading">
            <div className="op-spinner" />
            <div>Optimizing with Claude AI...</div>
          </div>
        )}

        {error && <div className="op-error">{error}</div>}

        {optimized && !loading && (
          <>
            <div className="op-compare">
              {/* Original column */}
              <div className="op-col op-col--original">
                <div className="op-col-label">Original</div>
                <div className="op-field-label">Title</div>
                <div className="op-field-value op-field--dim">{original?.title}</div>
                <div className="op-field-label">Description</div>
                <div className="op-field-value op-field--dim op-field--desc">{original?.description?.slice(0, 200) || '(empty)'}</div>
                <div className="op-field-label">Tags</div>
                <div className="op-field-value op-field--dim">{(original?.tags || []).join(', ') || '(none)'}</div>
                {original?.variants?.length > 0 && (
                  <>
                    <div className="op-field-label">Variants</div>
                    {original.variants.slice(0, 5).map((v, i) => (
                      <div key={i} className="op-field-value op-field--dim" style={{ fontSize: 9 }}>
                        {v.option1}{v.option2 ? ` / ${v.option2}` : ''}
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Optimized column */}
              <div className="op-col op-col--optimized">
                <div className="op-col-label">Optimized</div>

                <EditableField label="Title" value={optimized.title} editing={editing === 'title'}
                  onEdit={() => setEditing('title')} onChange={(v) => setOptimized({ ...optimized, title: v })} onBlur={() => setEditing(null)} />

                <div className="op-field-label">Description</div>
                {editing === 'description' ? (
                  <textarea className="op-edit-textarea" value={optimized.description}
                    onChange={(e) => setOptimized({ ...optimized, description: e.target.value })}
                    onBlur={() => setEditing(null)} rows={8} autoFocus />
                ) : (
                  <div className="op-field-value op-field--editable op-field--html"
                    onClick={() => setEditing('description')}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(optimized.description) }} />
                )}

                <EditableField label="Tags" value={optimized.tags?.join(', ')} editing={editing === 'tags'}
                  onEdit={() => setEditing('tags')}
                  onChange={(v) => setOptimized({ ...optimized, tags: v.split(',').map((t) => t.trim()) })}
                  onBlur={() => setEditing(null)} />

                <EditableField label="SEO Title" value={optimized.seo_title} editing={editing === 'seo_title'}
                  onEdit={() => setEditing('seo_title')} onChange={(v) => setOptimized({ ...optimized, seo_title: v })} onBlur={() => setEditing(null)} />

                <EditableField label="SEO Description" value={optimized.seo_description} editing={editing === 'seo_desc'}
                  onEdit={() => setEditing('seo_desc')} onChange={(v) => setOptimized({ ...optimized, seo_description: v })} onBlur={() => setEditing(null)} textarea />

                {optimized.variants?.length > 0 && (
                  <>
                    <div className="op-field-label">Variants (standardized)</div>
                    <div className="op-variants-table">
                      {optimized.variants.map((v, i) => (
                        <div key={i} className="op-variant-row">
                          <span className="op-variant-original">{v.original || `${v.option1} / ${v.option2}`}</span>
                          <span className="op-variant-arrow">→</span>
                          <span className="op-variant-new">{v.option1}{v.option2 ? ` / ${v.option2}` : ''}</span>
                        </div>
                      ))}
                    </div>
                    {optimized.option_labels && (
                      <div className="op-variant-labels">
                        Labels: {Object.entries(optimized.option_labels).map(([k, v]) => `${k}: "${v}"`).join(', ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            {!rejectMode ? (
              <div className="op-actions">
                <button className="op-btn op-btn--regen" onClick={handleOptimize} disabled={loading}>
                  {loading ? 'Regenerating...' : 'Re-generate'}
                </button>
                <button className="op-btn op-btn--save" onClick={handleSaveDraft} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button className="op-btn op-btn--apply" onClick={handleApprove} disabled={applying}>
                  {applying ? 'Applying...' : 'Approve & Push'}
                </button>
                <button className="op-btn op-btn--reject" onClick={() => setRejectMode(true)}>
                  Reject
                </button>
              </div>
            ) : (
              <div className="op-reject-box">
                <textarea className="op-reject-input" value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why are you rejecting this optimization?"
                  rows={2} autoFocus />
                <div className="op-actions">
                  <button className="op-btn op-btn--reject" onClick={handleReject}>Confirm Reject</button>
                  <button className="op-btn op-btn--regen" onClick={() => setRejectMode(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EditableField({ label, value, editing, onEdit, onChange, onBlur, textarea }) {
  return (
    <>
      <div className="op-field-label">{label}</div>
      {editing ? (
        textarea ? (
          <textarea className="op-edit-textarea" value={value || ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} rows={2} autoFocus />
        ) : (
          <input className="op-edit-input" value={value || ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} autoFocus />
        )
      ) : (
        <div className="op-field-value op-field--editable" onClick={onEdit}>
          {value || '(empty)'} <span className="op-edit-icon">✎</span>
        </div>
      )}
    </>
  );
}

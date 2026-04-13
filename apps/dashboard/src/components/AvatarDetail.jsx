import { useState, useRef } from 'react';
import { generateAvatar, uploadAvatar, setAvatarReference, deleteAvatar } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './AvatarDetail.css';

const MAX_SIZE = 1024;
const resizeAndEncode = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > MAX_SIZE || height > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    resolve(dataUrl.split(',')[1]);
  };
  img.onerror = reject;
  img.src = URL.createObjectURL(file);
});

export default function AvatarDetail({ persona, storeId, storeName, onClose, onUpdated }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const dragCounter = useRef(0);

  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [variants, setVariants] = useState(persona.variants || []);
  const [referenceUrl, setReferenceUrl] = useState(persona.reference_url);
  const [showEdit, setShowEdit] = useState(false);
  const [descText, setDescText] = useState(persona.description || '');

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const fullDesc = descText || persona.description || persona.label;
      const result = await generateAvatar(storeId, persona.name, fullDesc);
      const newVariants = (result.variants || []).map(url => (typeof url === 'string' ? { url } : url));
      setVariants(prev => [...prev, ...newVariants]);
      toast.success(`Generated ${newVariants.length} variant(s)`);
      onUpdated?.();
    } catch (err) {
      console.error('[AvatarDetail] Generate failed:', { error: err.message, persona: persona.name });
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const processFile = async (file) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Only PNG, JPEG, or WebP images');
      return;
    }
    setUploading(true);
    try {
      const base64 = await resizeAndEncode(file);
      const result = await uploadAvatar(storeId, persona.name, base64, 'image/jpeg');
      if (result.reference_url) {
        setReferenceUrl(result.reference_url);
        setVariants(prev => [...prev, { url: result.reference_url }]);
        toast.success('Photo uploaded');
        onUpdated?.();
      }
    } catch (err) {
      console.error('[AvatarDetail] Upload failed:', { error: err.message, persona: persona.name });
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleSetReference = async (url) => {
    try {
      await setAvatarReference(storeId, persona.name, url);
      setReferenceUrl(url);
      toast.success('Reference updated');
      onUpdated?.();
    } catch (err) {
      console.error('[AvatarDetail] Set reference failed:', { error: err.message, persona: persona.name });
      toast.error(`Failed to set reference: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete all avatar data for ${persona.name}? This cannot be undone.`)) return;
    try {
      await deleteAvatar(storeId, persona.name);
      toast.success(`Avatar data for ${persona.name} deleted`);
      onUpdated?.();
      onClose();
    } catch (err) {
      console.error('[AvatarDetail] Delete failed:', { error: err.message, persona: persona.name });
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="avd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="avd-modal">
        {/* Left toolbar */}
        <div className="avd-toolbar">
          <button onClick={handleGenerate} disabled={generating} title="Generate variants">
            {generating ? '...' : 'Gen'}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Upload photo">
            {uploading ? '...' : 'Upload'}
          </button>
          <button onClick={() => setShowEdit(p => !p)} title="Edit description">
            Edit
          </button>
          <button onClick={handleDelete} title="Delete avatar" className="avd-tool--danger">
            Del
          </button>
        </div>

        {/* Main content */}
        <div className="avd-main">
          {/* Preview area — D&D zone */}
          <div
            className={`avd-preview ${dragging ? 'avd-preview--drag' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {referenceUrl ? (
              <img src={referenceUrl} alt={persona.name} />
            ) : (
              <div className="avd-placeholder">Drop a photo here or click Upload</div>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFileSelect} />
          </div>

          {/* Info */}
          <div className="avd-info">
            <div className="avd-info-name">{persona.name} &ldquo;{persona.label}&rdquo; &middot; {persona.age}</div>
            {showEdit ? (
              <textarea
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                className="avd-desc-edit"
                rows={3}
                placeholder="Describe this persona's look, style, and vibe..."
              />
            ) : (
              <div className="avd-info-desc">{descText || persona.label}</div>
            )}
          </div>

          {/* Variants */}
          {variants.length > 0 && (
            <div className="avd-variants">
              <div className="avd-variants-label">Variants</div>
              <div className="avd-variants-grid">
                {variants.map((v, i) => {
                  const url = v.url || v;
                  return (
                    <div
                      key={i}
                      className={`avd-variant ${url === referenceUrl ? 'avd-variant--active' : ''}`}
                      onClick={() => handleSetReference(url)}
                    >
                      <img src={url} alt={`v${i + 1}`} />
                      {url === referenceUrl && <div className="avd-variant-check">&#10003;</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button className="avd-close" onClick={onClose}>&times;</button>
      </div>
    </div>
  );
}

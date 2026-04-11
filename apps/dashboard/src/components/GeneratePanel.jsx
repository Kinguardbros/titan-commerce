import { useState, useEffect } from 'react';
import { generateCreatives, convertToVideo, getSkills } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './GeneratePanel.css';

const STYLES_WITH_MODEL = ['ad_creative', 'lifestyle', 'review_ugc', 'product_photo_beach', 'static_split', 'static_urgency'];

const STYLES = [
  { key: 'ad_creative', label: 'Ad Creative', desc: 'Campaign-ready Meta ad — studio lighting, gold tones', group: 'Custom' },
  { key: 'product_shot', label: 'Product Shot', desc: 'Clean white background, product focus, detail shots', group: 'Custom' },
  { key: 'product_photo_beach', label: 'Beach Photo', desc: 'Beach setting — warm golden tones, real woman on sand with ocean bokeh', group: 'Custom' },
  { key: 'lifestyle', label: 'Lifestyle', desc: 'Real setting — café, office, street, natural light', group: 'Custom' },
  { key: 'review_ugc', label: 'Review / UGC', desc: 'Casual smartphone mirror selfie, authentic feel', group: 'Custom' },
  { key: 'static_clean', label: 'Clean Minimal', desc: 'White bg, centered, Apple-style — same for every product', group: 'Static Templates' },
  { key: 'static_split', label: 'Split Screen', desc: 'Model left + product detail right — standardized layout', group: 'Static Templates' },
  { key: 'static_urgency', label: 'Urgency / Sale', desc: 'Bold gradient, dynamic pose — flash sale energy', group: 'Static Templates' },
];

export default function GeneratePanel({ product, mode = 'image', defaultStyle, creatives = [], onClose, onGenerated }) {
  const toast = useToast();
  const [style, setStyle] = useState(defaultStyle || 'ad_creative');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showModel, setShowModel] = useState(true);
  const [count, setCount] = useState(2);
  const [textOverlay, setTextOverlay] = useState('none');
  const [overlayText, setOverlayText] = useState('');
  const [videoSource, setVideoSource] = useState('from_image'); // from_image | generate_new
  const [selectedSource, setSelectedSource] = useState(null);
  const [audience, setAudience] = useState('auto');
  const [personas, setPersonas] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);

  // Load personas from audience-personas skill
  useEffect(() => {
    if (!product?.store_id) return;
    getSkills(product.store_id).then((data) => {
      const audienceSkill = (data.skills || []).find((s) => s.skill_type === 'audience-personas');
      if (audienceSkill?.content) {
        // Parse personas: "### Maria (42) — The Hiding Mom" or "**Maria (42)** — The Hiding Mom"
        const parsed = [];
        const regex = /(?:###?\s*|(?:\*\*))?\s*(\w+)\s*\((\d+)\)\s*(?:\*\*)?\s*[—–-]\s*(.+?)(?:\n|$)/g;
        let m;
        while ((m = regex.exec(audienceSkill.content)) !== null) {
          parsed.push({ name: m[1], age: m[2], label: m[3].trim().replace(/\*+$/, '') });
        }
        if (parsed.length) setPersonas(parsed);
      }
    }).catch(() => {});
  }, [product?.store_id]);

  const isVideo = mode === 'video';
  const sourceImages = creatives.filter((c) => c.format === 'image' && (c.status === 'approved' || c.status === 'pending') && c.file_url);

  const handleGenerate = async () => {
    setGenerating(true);
    setCompleted(0);
    setFailed(0);

    toast.info('Generating creative...');

    if (isVideo && videoSource === 'from_image') {
      const sourceId = selectedSource || sourceImages[0]?.id;
      if (!sourceId) { setGenerating(false); return; }
      const promises = Array.from({ length: count }, () =>
        convertToVideo(sourceId)
          .then(() => setCompleted((p) => p + 1))
          .catch((err) => { setFailed((p) => p + 1); toast.error(`Generation failed: ${err.message}`); })
      );
      await Promise.allSettled(promises);
    } else {
      // Image mode OR video "generate new" (generates image first, then converts)
      const results = [];
      const promises = Array.from({ length: count }, () =>
        generateCreatives({
          product_id: product.id,
          store_id: product.store_id,
          style,
          custom_prompt: customPrompt,
          show_model: showModel,
          text_overlay: textOverlay,
          overlay_text: overlayText,
          audience: audience !== 'auto' ? audience : undefined,
        })
          .then((data) => { setCompleted((p) => p + 1); results.push(data); })
          .catch((err) => { setFailed((p) => p + 1); toast.error(`Generation failed: ${err.message}`); })
      );
      await Promise.allSettled(promises);

      // If video generate_new: chain convert to video
      if (isVideo && videoSource === 'generate_new' && results.length > 0) {
        setCompleted(0);
        setFailed(0);
        const videoPromises = results
          .filter((r) => r?.creative_id)
          .map((r) =>
            convertToVideo(r.creative_id)
              .then(() => setCompleted((p) => p + 1))
              .catch((err) => { setFailed((p) => p + 1); toast.error(`Generation failed: ${err.message}`); })
          );
        await Promise.allSettled(videoPromises);
      }
    }

    toast.success(`${completed} creative(s) generated!`);
    setTimeout(() => onGenerated(), 800);
  };

  const total = completed + failed;
  const showStyleOptions = !isVideo || videoSource === 'generate_new';

  return (
    <div className="gp-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="gp-modal" role="dialog" aria-modal="true" aria-label={`Generate ${isVideo ? 'video' : 'image'} for ${product.title}`} onClick={(e) => e.stopPropagation()}>
        <button className="gp-close" aria-label="Close modal" onClick={onClose}>✕</button>

        <div className="gp-title">Generate {isVideo ? 'Video' : 'Image'}</div>
        <div className="gp-product">{product.title}</div>

        {/* Video source toggle */}
        {isVideo && (
          <>
            <div className="gp-section">Video Source</div>
            <div className="gp-toggle">
              <button className={`gp-toggle-btn${videoSource === 'from_image' ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setVideoSource('from_image')}>
                From Existing Image
              </button>
              <button className={`gp-toggle-btn${videoSource === 'generate_new' ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setVideoSource('generate_new')}>
                Generate New
              </button>
            </div>
          </>
        )}

        {/* Source image picker (video from_image only) */}
        {isVideo && videoSource === 'from_image' && (
          <>
            <div className="gp-section">Select Image</div>
            {sourceImages.length === 0 ? (
              <div className="gp-no-source">No images available. Generate and approve an image first.</div>
            ) : (
              <div className="gp-source-grid">
                {sourceImages.map((c) => (
                  <div
                    key={c.id}
                    className={`gp-source-card${(selectedSource || sourceImages[0]?.id) === c.id ? ' gp-source-card--active' : ''}`}
                    onClick={() => setSelectedSource(c.id)}
                  >
                    <img src={c.file_url} alt="" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Style, Subject, Text — for image mode and video generate_new */}
        {showStyleOptions && (
          <>
            <div className="gp-section">Style</div>
            {['Custom', 'Static Templates'].map((group) => (
              <div key={group}>
                <div className="gp-group-label">{group}</div>
                <div className="gp-styles">
                  {STYLES.filter((s) => s.group === group).map((s) => (
                    <div
                      key={s.key}
                      className={`gp-style${style === s.key ? ' gp-style--active' : ''}`}
                      onClick={() => !generating && setStyle(s.key)}
                    >
                      <div className="gp-style-label">{s.label}</div>
                      <div className="gp-style-desc">{s.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="gp-section">Subject</div>
            <div className="gp-toggle">
              <button className={`gp-toggle-btn${showModel ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setShowModel(true)}>
                On Model
              </button>
              <button className={`gp-toggle-btn${!showModel ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setShowModel(false)}>
                Product Only
              </button>
            </div>

            {/* Audience picker — only for styles with model */}
            {STYLES_WITH_MODEL.includes(style) && personas.length > 0 && (
              <>
                <div className="gp-section">Audience</div>
                <select className="gp-audience-select" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={generating}>
                  <option value="auto">Auto — best match</option>
                  {personas.map((p) => (
                    <option key={p.name} value={p.name}>{p.name} ({p.age}) — {p.label}</option>
                  ))}
                </select>
              </>
            )}

            <div className="gp-section">Text in Image</div>
            <div className="gp-toggle gp-toggle--triple">
              <button className={`gp-toggle-btn${textOverlay === 'none' ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setTextOverlay('none')}>
                No Text
              </button>
              <button className={`gp-toggle-btn${textOverlay === 'auto' ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setTextOverlay('auto')}>
                Auto Generate
              </button>
              <button className={`gp-toggle-btn${textOverlay === 'custom' ? ' gp-toggle-btn--active' : ''}`} onClick={() => !generating && setTextOverlay('custom')}>
                Custom Text
              </button>
            </div>
            {textOverlay === 'custom' && (
              <input
                className="gp-text-input"
                value={overlayText}
                onChange={(e) => setOverlayText(e.target.value)}
                placeholder="e.g. 'Now $49.95' or 'Free Shipping Today'"
                disabled={generating}
              />
            )}
          </>
        )}

        <div className="gp-section">How many</div>
        <div className="gp-variants">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className={`gp-variant${count === n ? ' gp-variant--active' : ''}`}
              onClick={() => !generating && setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="gp-section">Custom Instructions (optional)</div>
        <textarea
          className="gp-textarea"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder={isVideo ? "e.g. 'Slow camera pan, cinematic feel'" : "e.g. 'Show her walking in a park, autumn colors'"}
          rows={2}
          disabled={generating}
        />

        <div className="gp-footer">
          {generating ? (
            <div className="gp-progress">
              <div className="gp-spinner" />
              <span>
                {total < count
                  ? `${isVideo ? 'Processing' : 'Generating'} ${total + 1} of ${count}...`
                  : `Done! ${completed} generated${failed > 0 ? `, ${failed} failed` : ''}`}
              </span>
            </div>
          ) : (
            <button
              className={`gp-generate-btn${isVideo ? ' gp-generate-btn--video' : ''}`}
              onClick={handleGenerate}
              disabled={isVideo && videoSource === 'from_image' && sourceImages.length === 0}
            >
              {isVideo
                ? videoSource === 'from_image'
                  ? `Convert ${count} to Video`
                  : `Generate ${count} Image${count > 1 ? 's' : ''} + Video`
                : `Generate ${count} ${STYLES.find((s) => s.key === style)?.label}${count > 1 ? 's' : ''}${!showModel ? ' (Product Only)' : ''}`
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

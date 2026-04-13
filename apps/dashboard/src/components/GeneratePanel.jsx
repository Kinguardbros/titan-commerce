import { useState, useEffect, useMemo } from 'react';
import { generateCreatives, convertToVideo, getSkills, getProductDetail, getCustomStyles } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './GeneratePanel.css';

const STYLES_WITH_MODEL = ['ad_creative', 'lifestyle', 'review_ugc', 'product_photo_beach', 'static_split', 'static_urgency'];

const AI_MODELS = [
  { key: 'fal_nano_banana', label: 'Nano Banana 2 (fal.ai)', desc: 'Reference-based editing' },
  { key: 'flux_kontext', label: 'Flux Kontext Max', desc: 'Text-to-image, fast' },
  { key: 'soul', label: 'Soul', desc: 'Creative, stylized' },
  { key: 'soul_ref', label: 'Soul Reference', desc: 'Max reference fidelity' },
];

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

export default function GeneratePanel({ product, mode = 'image', defaultStyle, creatives = [], onClose, onGenerated, storeId }) {
  const toast = useToast();
  const [style, setStyle] = useState(defaultStyle || 'ad_creative');
  const [aiModel, setAiModel] = useState('fal_nano_banana');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showModel, setShowModel] = useState(true);
  const [count, setCount] = useState(2);
  const [textOverlay, setTextOverlay] = useState('none');
  const [overlayText, setOverlayText] = useState('');
  const [videoSource, setVideoSource] = useState('from_image'); // from_image | generate_new
  const [selectedSource, setSelectedSource] = useState(null);
  const [audience, setAudience] = useState('auto');
  const [personas, setPersonas] = useState([]);
  const [selectedColor, setSelectedColor] = useState('All colors');
  const [colors, setColors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);

  // Load product colors from Shopify variants
  useEffect(() => {
    const sid = storeId || product?.store_id;
    if (!sid || !product?.id) return;
    getProductDetail(sid, product.id).then((data) => {
      if (!data?.product?.variants) return;
      const sizes = new Set(['S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XS', 'OS', 'One Size']);
      const colorSet = new Set();
      for (const v of data.product.variants) {
        // Color is usually option1 or option2 — pick the one that isn't a size
        for (const opt of [v.option1, v.option2, v.option3]) {
          if (opt && !sizes.has(opt)) colorSet.add(opt);
        }
      }
      if (colorSet.size > 0) setColors(['All colors', ...colorSet]);
    }).catch(() => {});
  }, [storeId, product?.id, product?.store_id]);

  // Load personas from audience-personas skill
  useEffect(() => {
    const sid = storeId || product?.store_id;
    if (!sid) return;
    getSkills(sid).then((data) => {
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
  }, [storeId, product?.store_id]);

  // Load custom styles from backend
  const [customStyles, setCustomStyles] = useState([]);
  useEffect(() => {
    const sid = storeId || product?.store_id;
    if (!sid) return;
    getCustomStyles(sid).then(data => setCustomStyles(data || [])).catch(() => {});
  }, [storeId, product?.store_id]);

  const allStyles = useMemo(() => [
    ...STYLES,
    ...customStyles.map(cs => ({
      key: cs.style_key,
      label: cs.name,
      desc: `Custom style — ${cs.color_palette?.slice(0, 3).join(', ') || 'reference-based'}`,
      group: 'Custom Styles',
    })),
  ], [customStyles]);

  const stylesWithModel = useMemo(() => [
    ...STYLES_WITH_MODEL,
    ...customStyles.map(cs => cs.style_key),
  ], [customStyles]);

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
          store_id: storeId || product.store_id,
          style,
          ai_model: aiModel,
          custom_prompt: (selectedColor !== 'All colors' ? `Product color: ${selectedColor}. The product MUST be in this exact color variant.\n` : '') + (customPrompt || ''),
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
            {['Custom', 'Static Templates', ...(customStyles.length ? ['Custom Styles'] : [])].map((group) => (
              <div key={group}>
                <div className="gp-group-label">{group}</div>
                <div className="gp-styles">
                  {allStyles.filter((s) => s.group === group).map((s) => (
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

            <div className="gp-section">Model</div>
            <select className="gp-audience-select" value={aiModel} onChange={(e) => setAiModel(e.target.value)} disabled={generating}>
              {AI_MODELS.map((m) => (
                <option key={m.key} value={m.key} disabled={m.disabled}>{m.label} — {m.desc}</option>
              ))}
            </select>

            {/* Color picker */}
            {colors.length > 1 && (
              <>
                <div className="gp-section">Color</div>
                <select className="gp-audience-select" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)} disabled={generating}>
                  {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            )}

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
            {stylesWithModel.includes(style) && personas.length > 0 && (
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

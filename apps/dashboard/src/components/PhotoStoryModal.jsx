import { useState, useEffect, useMemo } from 'react';
import { generateCreatives, getProductDetail, getSkills } from '../lib/api';
const genStoryId = () => crypto.randomUUID();
import { STORY_SHOTS, buildColorVariantPrompt, buildUGCPrompt, DEFAULT_COST_PER_IMAGE } from '../lib/photo-story-prompts';
import { useToast } from '../hooks/useToast.jsx';
import './PhotoStoryModal.css';

const AI_MODELS = [
  { key: 'fal_nano_banana', label: 'Nano Banana 2', cost: 0.14 },
  { key: 'flux_kontext', label: 'Flux Kontext Max', cost: 0.10 },
  { key: 'soul_ref', label: 'Soul Reference', cost: 0.12 },
];

const ASPECT_RATIOS = ['1:1', '4:5', '9:16'];
const SCENES = ['Auto', 'Studio', 'Beach', 'Park', 'Café', 'Street', 'Home interior', 'Rooftop', 'Garden', 'Poolside', 'Hotel'];

export default function PhotoStoryModal({ product, storeId, onClose, onCompleted }) {
  const toast = useToast();
  const [colors, setColors] = useState([]);
  const [heroColor, setHeroColor] = useState('');
  const [variantColors, setVariantColors] = useState(new Set());
  const [selectedShots, setSelectedShots] = useState(() => new Set(STORY_SHOTS.filter(s => s.defaultOn).map(s => s.key)));
  const [includeUGC, setIncludeUGC] = useState(false);
  const [aiModel, setAiModel] = useState('fal_nano_banana');
  const [aspectRatio, setAspectRatio] = useState('4:5');
  const [scene, setScene] = useState('Auto');
  const [personas, setPersonas] = useState([]);
  const [audience, setAudience] = useState('auto');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });

  // Load product colors from Shopify variants
  useEffect(() => {
    const sid = storeId || product?.store_id;
    if (!sid || !product?.id) return;
    getProductDetail(sid, product.id).then(data => {
      if (!data?.product?.variants) return;
      const sizes = new Set(['S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XS', 'OS', 'One Size']);
      const colorSet = new Set();
      for (const v of data.product.variants) {
        for (const opt of [v.option1, v.option2, v.option3]) {
          if (opt && !sizes.has(opt)) colorSet.add(opt);
        }
      }
      const arr = [...colorSet];
      setColors(arr);
      if (arr.length > 0) setHeroColor(arr[0]);
    }).catch(() => {});
    // Load audience personas
    getSkills(sid).then(data => {
      const as = (data.skills || []).find(s => s.skill_type === 'audience-personas');
      if (as?.content) {
        const parsed = [];
        const rx1 = /(?:###?\s*|(?:\*\*))?\s*(\w+)\s*\((\d+)\)\s*(?:\*\*)?\s*[—–-]\s*(.+?)(?:\n|$)/g;
        let m; while ((m = rx1.exec(as.content)) !== null) parsed.push({ name: m[1], age: m[2], label: m[3].trim().replace(/\*+$/, '') });
        if (!parsed.length) {
          const rx2 = /###\s*Persona\s*\d+:\s*(\w+)\s*"([^"]+)"\s*\n[^]*?(?:\*\*Age\*\*|Age):\s*(\d+)/g;
          while ((m = rx2.exec(as.content)) !== null) parsed.push({ name: m[1], age: m[3], label: m[2].trim() });
        }
        if (parsed.length) setPersonas(parsed);
      }
    }).catch(() => {});
  }, [storeId, product?.id, product?.store_id]);

  const toggleShot = (key) => setSelectedShots(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const toggleVariant = (color) => setVariantColors(prev => {
    const n = new Set(prev);
    n.has(color) ? n.delete(color) : n.add(color);
    return n;
  });

  const totalImages = useMemo(() => {
    let count = selectedShots.size;
    if (selectedShots.has('before_after')) count += 1; // 2 images for B/A
    count += variantColors.size;
    if (includeUGC) count += 1;
    return count;
  }, [selectedShots, variantColors, includeUGC]);

  const modelCost = AI_MODELS.find(m => m.key === aiModel)?.cost || DEFAULT_COST_PER_IMAGE;
  const estimatedCost = (totalImages * modelCost).toFixed(2);

  const handleGenerate = async () => {
    if (!heroColor) { toast.error('Select a hero color'); return; }
    setGenerating(true);
    let completed = 0;
    const total = totalImages;
    setProgress({ current: 0, total, label: '' });

    try {
      const storyId = genStoryId();
      const shots = STORY_SHOTS.filter(s => selectedShots.has(s.key)).sort((a, b) => a.order - b.order);

      // Build scene + audience context to append to each prompt
      const sceneCtx = scene !== 'Auto' ? `\nScene/Environment: ${scene}. Set the photo in this specific environment.` : '';
      const audienceCtx = audience !== 'auto' ? audience : undefined;

      // Build all jobs with story_id + story_shot
      const allJobs = [
        ...shots.map(shot => ({
          label: shot.label,
          fn: () => generateCreatives({
            product_id: product.id, store_id: storeId, style: shot.suggestedStyle,
            custom_prompt: shot.buildPrompt(product, heroColor) + sceneCtx,
            show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
            audience: audienceCtx, story_id: storyId, story_shot: shot.key,
          }),
        })),
        ...[...variantColors].map(color => ({
          label: `Color: ${color}`,
          fn: () => generateCreatives({
            product_id: product.id, store_id: storeId, style: 'product_shot',
            custom_prompt: buildColorVariantPrompt(product, color) + sceneCtx,
            show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
            audience: audienceCtx, story_id: storyId, story_shot: `color_${color.toLowerCase().replace(/\s+/g, '-')}`,
          }),
        })),
      ];

      // Generate in parallel (max 5 concurrent)
      setProgress({ current: 0, total, label: 'Generating all shots...' });
      const BATCH = 5;
      for (let i = 0; i < allJobs.length; i += BATCH) {
        const batch = allJobs.slice(i, i + BATCH);
        setProgress({ current: completed, total, label: batch.map(j => j.label).join(', ') });
        const results = await Promise.allSettled(batch.map(j => j.fn()));
        results.forEach((r, idx) => {
          if (r.status === 'rejected') {
            console.error(`[PhotoStory] Failed ${batch[idx].label}:`, { error: r.reason?.message });
            toast.error(`${batch[idx].label} failed`);
          }
        });
        completed += batch.length;
      }

      // UGC
      if (includeUGC) {
        setProgress({ current: completed, total, label: 'UGC Shot' });
        try {
          await generateCreatives({
            product_id: product.id,
            store_id: storeId,
            style: 'review_ugc',
            custom_prompt: buildUGCPrompt(product, heroColor) + sceneCtx,
            show_model: true,
            text_overlay: 'none',
            ai_model: aiModel,
            aspect_ratio: aspectRatio,
            audience: audienceCtx,
          });
        } catch (err) {
          console.error('[PhotoStory] UGC failed:', { error: err.message });
        }
        completed++;
      }

      setProgress({ current: total, total, label: 'Done!' });
      toast.success(`Generated ${total} photos for ${product.title}`);
      onCompleted?.();
    } catch (err) {
      console.error('[PhotoStory] Generation failed:', { error: err.message });
      toast.error(`Photo story failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="ps-overlay" onClick={e => e.target === e.currentTarget && !generating && onClose()}>
      <div className="ps-modal">
        <div className="ps-header">
          <div>
            <div className="ps-title">Full Product Photo Story</div>
            <div className="ps-subtitle">Generate a complete set of product photos</div>
          </div>
          <button className="ps-close" onClick={onClose} disabled={generating}>x</button>
        </div>

        {generating ? (
          <div className="ps-progress">
            <div className="ps-progress-label">Generating {progress.current + 1}/{progress.total}: {progress.label}</div>
            <div className="ps-progress-bar">
              <div className="ps-progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
            <div className="ps-progress-sub">{progress.current} of {progress.total} completed</div>
          </div>
        ) : (
          <>
            {/* Hero color */}
            <div className="ps-section">
              <label className="ps-label">Hero Color</label>
              {colors.length > 0 ? (
                <select className="ps-select" value={heroColor} onChange={e => setHeroColor(e.target.value)}>
                  {colors.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input className="ps-input" value={heroColor} onChange={e => setHeroColor(e.target.value)} placeholder="e.g. rich midnight navy" />
              )}
            </div>

            {/* Shot selection */}
            <div className="ps-section">
              <label className="ps-label">Shots to generate</label>
              <div className="ps-checks">
                {STORY_SHOTS.map(s => (
                  <label key={s.key} className="ps-check">
                    <input type="checkbox" checked={selectedShots.has(s.key)} onChange={() => toggleShot(s.key)} />
                    <span>{s.label}</span>
                    {!s.defaultOn && <span className="ps-check-hint">optional</span>}
                  </label>
                ))}
                <label className="ps-check">
                  <input type="checkbox" checked={includeUGC} onChange={() => setIncludeUGC(p => !p)} />
                  <span>UGC / Authentic</span>
                  <span className="ps-check-hint">optional</span>
                </label>
              </div>
            </div>

            {/* Color variants */}
            {colors.length > 1 && (
              <div className="ps-section">
                <label className="ps-label">Color Variants (additional hero per color)</label>
                <div className="ps-checks">
                  {colors.filter(c => c !== heroColor).map(c => (
                    <label key={c} className="ps-check">
                      <input type="checkbox" checked={variantColors.has(c)} onChange={() => toggleVariant(c)} />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Audience + Scene */}
            <div className="ps-row">
              {personas.length > 0 && (
                <div className="ps-section ps-section--half">
                  <label className="ps-label">Audience</label>
                  <select className="ps-select" value={audience} onChange={e => setAudience(e.target.value)}>
                    <option value="auto">Auto — best match</option>
                    {personas.map(p => <option key={p.name} value={p.name}>{p.name} ({p.age}) — {p.label}</option>)}
                  </select>
                </div>
              )}
              <div className="ps-section ps-section--half">
                <label className="ps-label">Scene / Environment</label>
                <select className="ps-select" value={scene} onChange={e => setScene(e.target.value)}>
                  {SCENES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Model + Aspect ratio */}
            <div className="ps-row">
              <div className="ps-section ps-section--half">
                <label className="ps-label">AI Model</label>
                <select className="ps-select" value={aiModel} onChange={e => setAiModel(e.target.value)}>
                  {AI_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div className="ps-section ps-section--half">
                <label className="ps-label">Aspect Ratio</label>
                <select className="ps-select" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                  {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {/* Summary */}
            <div className="ps-summary">
              <span>Total: <strong>{totalImages} images</strong></span>
              <span>~${estimatedCost}</span>
            </div>

            <div className="ps-actions">
              <button className="ps-btn ps-btn--primary" onClick={handleGenerate} disabled={!heroColor || selectedShots.size === 0}>
                Generate Full Story
              </button>
              <button className="ps-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

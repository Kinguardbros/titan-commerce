import { useState, useEffect, useMemo } from 'react';
import { generateCreatives, getProductDetail, getSkills } from '../lib/api';
const genStoryId = () => crypto.randomUUID();
import { STORY_SHOTS, buildColorVariantPrompt, buildUGCPrompt, DEFAULT_COST_PER_IMAGE } from '../lib/photo-story-prompts';
import { useToast } from '../hooks/useToast.jsx';
import './PhotoStoryModal.css';

const AI_MODELS = [
  { key: 'fal_nano_banana', label: 'Smart (HF hero + Nano Banana ref)', cost: 0.08 },
  { key: 'flux_kontext', label: 'Flux Kontext (fal.ai)', cost: 0.10 },
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
  const [realisticMode, setRealisticMode] = useState(false);
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

  // Smart cost: hero via HF ($0.01), rest via fal.ai Nano Banana ($0.08)
  const heroCost = 0.01;
  const refCost = 0.08;
  const heroCount = selectedShots.has('hero') ? 1 : 0;
  const restCount = totalImages - heroCount;
  const estimatedCost = (heroCount * heroCost + restCount * refCost).toFixed(2);

  const handleGenerate = async () => {
    if (!heroColor) { toast.error('Select a hero color'); return; }
    setGenerating(true);
    let completed = 0;
    const total = totalImages;
    setProgress({ current: 0, total, label: '' });

    try {
      const storyId = genStoryId();
      const shots = (STORY_SHOTS || []).filter(s => selectedShots.has(s.key)).sort((a, b) => a.order - b.order);
      if (!shots.length && !variantColors.size) { toast.error('No shots selected'); setGenerating(false); return; }

      // Build scene + audience context to append to each prompt
      const sceneCtx = scene !== 'Auto' ? `\nScene/Environment: ${scene}. Set the photo in this specific environment.` : '';
      const selectedPersona = !realisticMode && audience !== 'auto' ? personas.find(p => p.name === audience) : null;
      const audienceCtx = realisticMode ? undefined : (selectedPersona ? selectedPersona.name : undefined);
      const ageCtx = realisticMode ? '' : (selectedPersona
        ? `\nIMPORTANT: The model MUST be a real ${selectedPersona.age}-year-old woman. She clearly looks ${selectedPersona.age} years old — visible smile lines, age-appropriate skin, NOT a young model. ${parseInt(selectedPersona.age) > 45 ? 'Crow\'s feet, mature skin texture.' : 'Natural expression lines.'}`
        : '\nThe model must be a real woman age 30-55, NOT a young fashion model.');

      // 1. Hero shot FIRST (sequential) — becomes visual reference for all others
      const heroShot = shots.find(s => s.key === 'hero');
      const otherShots = shots.filter(s => s.key !== 'hero');
      let heroUrl = null;

      if (heroShot) {
        setProgress({ current: 0, total, label: 'Hero Shot (anchor)...' });
        try {
          const result = await generateCreatives({
            product_id: product.id, store_id: storeId, style: realisticMode ? 'realistic_beach' : heroShot.suggestedStyle,
            custom_prompt: heroShot.buildPrompt(product, heroColor) + sceneCtx + ageCtx,
            show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
            audience: audienceCtx, story_id: storyId, story_shot: 'hero',
          });
          heroUrl = result?.file_url || null;
        } catch (err) {
          console.error('[PhotoStory] Hero failed:', { error: err.message });
          toast.error('Hero shot failed — continuing without reference');
        }
        completed++;
      }

      // 2. Remaining shots PARALLEL with hero as reference_url
      const remainingJobs = [
        ...otherShots.map(shot => ({
          label: shot.label,
          fn: () => generateCreatives({
            product_id: product.id, store_id: storeId, style: realisticMode ? 'realistic_beach' : shot.suggestedStyle,
            custom_prompt: shot.buildPrompt(product, heroColor) + sceneCtx + ageCtx,
            show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
            audience: audienceCtx, story_id: storyId, story_shot: shot.key,
            reference_url: heroUrl,
          }),
        })),
        ...[...variantColors].map(color => ({
          label: `Color: ${color}`,
          fn: () => generateCreatives({
            product_id: product.id, store_id: storeId, style: 'product_shot',
            custom_prompt: buildColorVariantPrompt(product, color) + sceneCtx + ageCtx,
            show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
            audience: audienceCtx, story_id: storyId, story_shot: `color_${color.toLowerCase().replace(/\s+/g, '-')}`,
            reference_url: heroUrl,
          }),
        })),
      ];

      const BATCH = 5;
      for (let i = 0; i < remainingJobs.length; i += BATCH) {
        const batch = remainingJobs.slice(i, i + BATCH);
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
            custom_prompt: buildUGCPrompt(product, heroColor) + sceneCtx + ageCtx,
            show_model: true,
            text_overlay: 'none',
            ai_model: aiModel,
            aspect_ratio: aspectRatio,
            audience: audienceCtx,
            reference_url: heroUrl,
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
      console.error('[PhotoStory] Generation failed:', err, err?.stack);
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

            {/* Realistic Beach toggle */}
            <div className="ps-row">
              <div className="ps-section" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="ps-label" style={{ margin: 0 }}>Realistic Beach</label>
                <button onClick={() => setRealisticMode(p => !p)} style={{
                  width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                  background: realisticMode ? 'var(--accent-success, #22c55e)' : 'var(--surface, #333)',
                  position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, background: '#fff',
                    position: 'absolute', top: 3, left: realisticMode ? 20 : 3, transition: 'left 0.2s',
                  }} />
                </button>
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                  {realisticMode ? 'Ultra-real curvy model, standalone prompt' : 'Off — uses standard styles'}
                </span>
              </div>
            </div>

            {/* Audience + Scene */}
            <div className="ps-row">
              {personas.length > 0 && !realisticMode && (
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

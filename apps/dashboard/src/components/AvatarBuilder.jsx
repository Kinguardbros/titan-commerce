import { useState } from 'react';
import { generateAvatar, setAvatarReference } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './AvatarBuilder.css';

const BODY_TYPES = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'];
const EXPRESSIONS = ['Confident', 'Relaxed', 'Smiling', 'Serious'];
const HAIR_COLORS = ['Blonde', 'Brunette', 'Black', 'Auburn', 'Red', 'Gray', 'White'];
const HAIR_LENGTHS = ['Short', 'Medium', 'Long', 'Very long'];
const HAIR_STYLES = ['Straight', 'Wavy', 'Curly', 'Coily', 'Pixie', 'Bob', 'Updo'];
const IMPERFECTIONS = ['Stretch marks', 'Cellulite', 'Scars', 'Freckles', 'Tan lines', 'Visible veins'];
const SKIN_TONES = [
  { label: 'Light ivory', hex: '#FFE0C2' },
  { label: 'Fair beige', hex: '#F5D0A9' },
  { label: 'Medium olive', hex: '#D4A574' },
  { label: 'Warm tan', hex: '#B8804A' },
  { label: 'Deep brown', hex: '#8B5E3C' },
  { label: 'Rich dark', hex: '#5C3A21' },
];

function buildAvatarPrompt(p) {
  const impStr = p.imperfections.length > 0
    ? `Subtle natural body details visible: ${p.imperfections.join(', ')}.`
    : '';

  return `Full body photograph of a real woman, age ${p.age}. Head to knees visible. She is NOT a fashion model — she looks like a real person, a real customer. ${p.bodyType} body type, ${p.skinTone} skin tone. ${p.hairColor} ${p.hairLength} ${p.hairStyle} hair. ${p.expression} expression, looking at camera with warmth. Standing naturally with weight on one hip, arms relaxed at sides. Wearing simple black fitted activewear. Warm inviting studio lighting, clean neutral background, soft shadows. Sun-kissed natural skin texture, age-appropriate face with natural expression lines. No retouching, no airbrushing — real skin, real body. ${impStr} ${p.extraNotes || ''} Shot on 85mm portrait lens, f/2.8, soft bokeh. Photorealistic, authentic, aspirational but achievable.`.replace(/\s{2,}/g, ' ').trim();
}

export default function AvatarBuilder({ storeId, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [age, setAge] = useState(40);
  const [bodyType, setBodyType] = useState('Average');
  const [skinTone, setSkinTone] = useState(SKIN_TONES[2].label);
  const [hairColor, setHairColor] = useState('Brunette');
  const [hairLength, setHairLength] = useState('Long');
  const [hairStyle, setHairStyle] = useState('Wavy');
  const [imperfections, setImperfections] = useState([]);
  const [expression, setExpression] = useState('Relaxed');
  const [extraNotes, setExtraNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState([]);
  const [selectedVariant, setSelectedVariant] = useState(null);

  const toggleImperfection = (imp) => setImperfections(prev =>
    prev.includes(imp) ? prev.filter(i => i !== imp) : [...prev, imp]
  );

  const handleGenerate = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setGenerating(true);
    setVariants([]);
    setSelectedVariant(null);
    try {
      const prompt = buildAvatarPrompt({ age, bodyType, skinTone, hairColor, hairLength, hairStyle, imperfections, expression, extraNotes });
      const result = await generateAvatar(storeId, name.trim(), prompt);
      const urls = (result.variants || []).map(v => typeof v === 'string' ? v : v.url);
      setVariants(urls);
      if (urls.length > 0) setSelectedVariant(urls[0]);
      toast.success(`Generated ${urls.length} variant(s)`);
    } catch (err) {
      console.error('[AvatarBuilder] Generate failed:', { error: err.message });
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedVariant) { toast.error('Select a variant first'); return; }
    setSaving(true);
    try {
      await setAvatarReference(storeId, name.trim(), selectedVariant);
      toast.success(`Avatar "${name}" saved!`);
      onCreated?.();
    } catch (err) {
      console.error('[AvatarBuilder] Save failed:', { error: err.message });
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ab-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ab-modal">
        <div className="ab-modal-header">
          <span className="ab-modal-title">Create New Avatar</span>
          <button className="ab-close" onClick={onClose}>x</button>
        </div>

        <div className="ab-layout">
          {/* Left: Toolbar */}
          <div className="ab-toolbar">
            <div className="ab-field">
              <label className="ab-label">Name</label>
              <input className="ab-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sofia" />
            </div>

            <div className="ab-field">
              <label className="ab-label">Age: {age}</label>
              <input type="range" min={18} max={70} value={age} onChange={e => setAge(Number(e.target.value))} className="ab-slider" />
            </div>

            <div className="ab-field">
              <label className="ab-label">Body type</label>
              <div className="ab-pills">
                {BODY_TYPES.map(bt => (
                  <button key={bt} className={`ab-pill${bodyType === bt ? ' ab-pill--active' : ''}`} onClick={() => setBodyType(bt)}>{bt}</button>
                ))}
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Skin tone</label>
              <div className="ab-swatches">
                {SKIN_TONES.map(st => (
                  <button key={st.label} className={`ab-swatch${skinTone === st.label ? ' ab-swatch--active' : ''}`}
                    style={{ background: st.hex }} title={st.label} onClick={() => setSkinTone(st.label)} />
                ))}
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Hair</label>
              <div className="ab-hair-row">
                <select className="ab-select" value={hairColor} onChange={e => setHairColor(e.target.value)}>
                  {HAIR_COLORS.map(c => <option key={c}>{c}</option>)}
                </select>
                <select className="ab-select" value={hairLength} onChange={e => setHairLength(e.target.value)}>
                  {HAIR_LENGTHS.map(l => <option key={l}>{l}</option>)}
                </select>
                <select className="ab-select" value={hairStyle} onChange={e => setHairStyle(e.target.value)}>
                  {HAIR_STYLES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Imperfections</label>
              <div className="ab-checks">
                {IMPERFECTIONS.map(imp => (
                  <label key={imp} className="ab-check">
                    <input type="checkbox" checked={imperfections.includes(imp)} onChange={() => toggleImperfection(imp)} />
                    <span>{imp}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Expression</label>
              <div className="ab-pills">
                {EXPRESSIONS.map(ex => (
                  <button key={ex} className={`ab-pill${expression === ex ? ' ab-pill--active' : ''}`} onClick={() => setExpression(ex)}>{ex}</button>
                ))}
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Extra notes</label>
              <textarea className="ab-textarea" value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={2} placeholder="Specific details..." />
            </div>

            <div className="ab-toolbar-actions">
              <button className="ab-btn ab-btn--primary" onClick={handleGenerate} disabled={generating || !name.trim()}>
                {generating ? 'Generating...' : 'Generate Preview'}
              </button>
              <button className="ab-btn ab-btn--save" onClick={handleSave} disabled={saving || !selectedVariant}>
                {saving ? 'Saving...' : 'Save Avatar'}
              </button>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="ab-preview-area">
            <div className="ab-preview-main">
              {selectedVariant ? (
                <img src={selectedVariant} alt="Preview" />
              ) : (
                <div className="ab-preview-placeholder">{generating ? 'Generating...' : 'Preview will appear here'}</div>
              )}
            </div>
            {variants.length > 0 && (
              <div className="ab-variants">
                <div className="ab-variants-label">Variants — click to select</div>
                <div className="ab-variants-grid">
                  {variants.map((url, i) => (
                    <div key={i} className={`ab-variant${url === selectedVariant ? ' ab-variant--active' : ''}`} onClick={() => setSelectedVariant(url)}>
                      <img src={url} alt={`v${i + 1}`} />
                      {url === selectedVariant && <div className="ab-variant-check">✓</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

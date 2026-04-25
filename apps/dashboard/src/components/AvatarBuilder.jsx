import { useState } from 'react';
import { generateAvatar, setAvatarReference } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './AvatarBuilder.css';

const BODY_TYPES = ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size'];
const ATTRACTIVENESS = ['Plain', 'Natural', 'Pretty', 'Beautiful'];
const FACE_SHAPES = ['Round', 'Oval', 'Heart', 'Square'];
const NOSE_SIZES = ['Small', 'Medium', 'Large'];
const LIP_FULLNESS = ['Thin', 'Medium', 'Full'];
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

  const age = parseInt(p.age);
  const ageDetails = age >= 50
    ? `Her face shows clear maturity: visible fine lines and crow's feet, some grey hair strands, slightly softer jawline, mature skin texture. Clearly a woman in her 50s or 60s.`
    : age >= 40
    ? `Her face shows mid-life maturity: visible fine lines around eyes and mouth, skin pores, natural skin texture. Clearly a woman in her 40s.`
    : age >= 30
    ? `Her face shows early adult maturity: smooth skin overall, subtle fine lines around eyes. She clearly looks in her 30s, not 40s. No deep wrinkles, no grey hair.`
    : `She has youthful features: smooth skin, even complexion, clearly a young adult.`;

  const weightStr = p.weight ? `She weighs approximately ${p.weight} kg — her body proportions MUST clearly reflect this weight.` : '';
  const heightStr = p.height ? `She is approximately ${p.height} cm tall.` : '';

  // Face detail descriptors
  const attractivenessDesc = {
    'Plain': 'Plain, below-average looking face — very ordinary, unremarkable features, asymmetric, wide nose, thin lips. NOT attractive.',
    'Natural': 'Average everyday face — neither ugly nor pretty, normal proportions, the kind of face you see on the street and forget.',
    'Pretty': 'Attractive but approachable face — girl-next-door pretty, pleasant features, warm and likeable but NOT model-perfect.',
    'Beautiful': 'Classically beautiful face — striking symmetrical features, high cheekbones, clear skin, attractive but still realistic and natural.',
  }[p.attractiveness] || '';

  const faceDesc = `FACE: ${attractivenessDesc} ${p.faceShape} face shape, ${p.noseSize.toLowerCase()} nose, ${p.lipFullness.toLowerCase()} lips.`;

  return `Full body reference photograph of a ${p.age}-year-old woman standing in front of a plain wall at home. Natural amateur photo, not a professional shoot. ${p.bodyType} body type, ${p.skinTone} skin tone. ${p.hairColor} ${p.hairLength} ${p.hairStyle} hair. ${heightStr} ${weightStr} ${faceDesc} FULL BODY shot — head to bare feet fully visible, feet at the bottom of the frame. Do NOT crop at the knees or waist. She is a regular ${p.age}-year-old woman. CLOTHING: She is wearing ONLY a plain BEIGE/NUDE skin-toned bra and BEIGE/NUDE skin-toned underwear briefs — NOT black, NOT white. Bare feet, no shoes. Arms relaxed at sides. ${p.expression} expression. Neutral indoor lighting, plain beige wall background. ${ageDetails} No makeup or minimal natural makeup, no styled hair. Imperfect real skin texture with pores, uneven tone. ${impStr} ${p.extraNotes || ''} Snapshot quality, plain and unremarkable. Do NOT make her look like a model, influencer, or professional photo. FINAL CHECK: age ${p.age}, underwear is BEIGE/NUDE not black.`.replace(/\s{2,}/g, ' ').trim();
}

export default function AvatarBuilder({ storeId, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [age, setAge] = useState(40);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [bodyType, setBodyType] = useState('Average');
  const [attractiveness, setAttractiveness] = useState('Natural');
  const [faceShape, setFaceShape] = useState('Oval');
  const [noseSize, setNoseSize] = useState('Medium');
  const [lipFullness, setLipFullness] = useState('Medium');
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
      const prompt = buildAvatarPrompt({ age, weight, height, bodyType, attractiveness, faceShape, noseSize, lipFullness, skinTone, hairColor, hairLength, hairStyle, imperfections, expression, extraNotes });
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
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ab-label">Height (cm)</label>
                  <input className="ab-input" type="number" value={height} onChange={e => setHeight(e.target.value)} placeholder="e.g. 165" min="140" max="200" />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ab-label">Weight (kg)</label>
                  <input className="ab-input" type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 70" min="40" max="150" />
                </div>
              </div>
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
              <label className="ab-label">Attractiveness</label>
              <div className="ab-pills">
                {ATTRACTIVENESS.map(a => (
                  <button key={a} className={`ab-pill${attractiveness === a ? ' ab-pill--active' : ''}`} onClick={() => setAttractiveness(a)}>{a}</button>
                ))}
              </div>
            </div>

            <div className="ab-field">
              <label className="ab-label">Face</label>
              <div className="ab-hair-row">
                <select className="ab-select" value={faceShape} onChange={e => setFaceShape(e.target.value)}>
                  {FACE_SHAPES.map(f => <option key={f}>{f}</option>)}
                </select>
                <select className="ab-select" value={noseSize} onChange={e => setNoseSize(e.target.value)}>
                  {NOSE_SIZES.map(n => <option key={n}>{n} nose</option>)}
                </select>
                <select className="ab-select" value={lipFullness} onChange={e => setLipFullness(e.target.value)}>
                  {LIP_FULLNESS.map(l => <option key={l}>{l} lips</option>)}
                </select>
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

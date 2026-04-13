import { useState, useRef, useCallback } from 'react';
import { analyzeStyle, createCustomStyle, scrapeStyle, describeStyle } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './StyleBuilder.css';

const MAX_SIZE = 512;
const MAX_IMAGES = 5;
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    const base64 = dataUrl.split(',')[1];
    resolve(base64);
  };
  img.onerror = reject;
  img.src = URL.createObjectURL(file);
});

export default function StyleBuilder({ storeId, storeName, onClose, onCreated }) {
  const toast = useToast();
  const dragCounter = useRef(0);
  const [tab, setTab] = useState('upload');
  const [images, setImages] = useState([]);
  const [url, setUrl] = useState('');
  const [scrapedImages, setScrapedImages] = useState([]);
  const [scraping, setScraping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [styleName, setStyleName] = useState('');
  const [styleDesc, setStyleDesc] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');

  const handleFiles = useCallback(async (files) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const valid = Array.from(files).filter(f => allowed.includes(f.type)).slice(0, MAX_IMAGES - images.length);
    const newImages = [];
    for (const f of valid) {
      const base64 = await resizeAndEncode(f);
      newImages.push({ base64, media_type: 'image/jpeg', preview_url: URL.createObjectURL(f), filename: f.name });
    }
    setImages(prev => [...prev, ...newImages].slice(0, MAX_IMAGES));
  }, [images.length]);

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const imgs = tab === 'upload'
        ? images.map(i => ({ base64: i.base64, media_type: i.media_type }))
        : scrapedImages.filter(i => i.selected).map(i => ({ base64: i.base64, media_type: i.media_type }));
      if (imgs.length < 1) { toast.error('Select at least 1 image'); return; }
      const result = await analyzeStyle(storeId, imgs);
      setAnalysis(result.analysis);
      setStyleName(result.analysis.style_name_suggestion || '');
      setStyleDesc(`${result.analysis.mood || ''} — ${result.analysis.setting || ''}`);
      setPromptTemplate(result.analysis.prompt_template || '');
    } catch (err) {
      console.error('[StyleBuilder] Analyze failed:', { error: err.message });
      toast.error(`Analysis failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleScrape = async () => {
    if (!url) return;
    setScraping(true);
    try {
      const result = await scrapeStyle(url, storeId);
      setScrapedImages((result.images || []).map(i => ({ ...i, selected: true })));
      if (result.analysis) {
        setAnalysis(result.analysis);
        setStyleName(result.analysis.style_name_suggestion || '');
        setStyleDesc(`${result.analysis.mood || ''} — ${result.analysis.setting || ''}`);
        setPromptTemplate(result.analysis.prompt_template || '');
      }
    } catch (err) {
      console.error('[StyleBuilder] Scrape failed:', { error: err.message });
      toast.error(`Scrape failed: ${err.message}`);
    } finally {
      setScraping(false);
    }
  };

  const handleDescribe = async () => {
    if (!description.trim()) return;
    setAnalyzing(true);
    try {
      const result = await describeStyle(storeId, description.trim());
      setAnalysis(result.analysis);
      setStyleName(result.analysis.style_name_suggestion || '');
      setStyleDesc(description.trim());
      setPromptTemplate(result.analysis.prompt_template || '');
    } catch (err) {
      console.error('[StyleBuilder] Describe failed:', { error: err.message });
      toast.error(`Generation failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreate = async () => {
    if (!styleName.trim()) { toast.error('Name is required'); return; }
    setCreating(true);
    try {
      const finalAnalysis = { ...analysis, prompt_template: promptTemplate };
      const result = await createCustomStyle(storeId, styleName.trim(), styleDesc, finalAnalysis, []);
      toast.success(`Style "${styleName}" created!`);
      onCreated?.(result.style_key);
    } catch (err) {
      console.error('[StyleBuilder] Create failed:', { error: err.message });
      toast.error(`Create failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const analyzeReady = tab === 'upload' ? images.length >= 3 : scrapedImages.filter(i => i.selected).length >= 1;

  return (
    <div className="sb-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sb-modal">
        <div className="sb-header">
          <span className="sb-title">Custom Style Builder</span>
          <button className="sb-close" onClick={onClose}>x</button>
        </div>

        {!analysis ? (
          <>
            <div className="sb-tabs">
              <button className={`sb-tab${tab === 'upload' ? ' sb-tab--active' : ''}`} onClick={() => setTab('upload')}>Upload Photos</button>
              <button className={`sb-tab${tab === 'url' ? ' sb-tab--active' : ''}`} onClick={() => setTab('url')}>From URL</button>
              <button className={`sb-tab${tab === 'describe' ? ' sb-tab--active' : ''}`} onClick={() => setTab('describe')}>From Description</button>
            </div>

            {tab === 'upload' && (
              <div className="sb-upload-area">
                <div
                  className={`sb-dropzone${dragging ? ' sb-dropzone--active' : ''}`}
                  onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('sb-file-input').click()}
                >
                  <div className="sb-dropzone-text">{dragging ? 'Drop images here' : 'Drag & drop reference photos (3-5)'}</div>
                  <div className="sb-dropzone-sub">PNG, JPEG, WebP — click to browse</div>
                  <input id="sb-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
                </div>
                {images.length > 0 && (
                  <div className="sb-thumbs">
                    {images.map((img, i) => (
                      <div key={i} className="sb-thumb">
                        <img src={img.preview_url} alt={img.filename} />
                        <button className="sb-thumb-x" onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}>x</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="sb-count">{images.length}/{MAX_IMAGES} images{images.length < 3 && ' (min 3)'}</div>
              </div>
            )}

            {tab === 'url' && (
              <div className="sb-url-area">
                <div className="sb-url-row">
                  <input className="sb-url-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://competitor.com/product/..." />
                  <button className="sb-url-btn" onClick={handleScrape} disabled={!url || scraping}>{scraping ? 'Scraping...' : 'Scrape Images'}</button>
                </div>
                {scrapedImages.length > 0 && (
                  <div className="sb-thumbs">
                    {scrapedImages.map((img, i) => (
                      <div key={i} className={`sb-thumb${img.selected ? ' sb-thumb--selected' : ''}`} onClick={() => setScrapedImages(prev => prev.map((im, j) => j === i ? { ...im, selected: !im.selected } : im))}>
                        <img src={img.url} alt={`ref ${i}`} />
                        <div className="sb-thumb-check">{img.selected ? 'v' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'describe' && (
              <div className="sb-describe-area">
                <label className="sb-label">Describe your style</label>
                <textarea
                  className="sb-textarea sb-textarea--describe"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={8}
                  placeholder={"Describe the visual style you want to create. Be specific about:\n\n• Lighting — studio, natural, golden hour, dramatic...\n• Setting — white background, beach, street, café...\n• Mood — calm, energetic, luxurious, casual...\n• Model direction — posing, expression, body language...\n• Colors — warm tones, muted, high contrast...\n• Camera — close-up, full body, overhead..."}
                />
                <div className="sb-describe-hint">AI will generate a complete style definition with color palette, prompt template, and visual attributes.</div>
              </div>
            )}

            <div className="sb-actions">
              {tab === 'describe' ? (
                <button className="sb-btn sb-btn--primary" onClick={handleDescribe} disabled={!description.trim() || analyzing}>
                  {analyzing ? 'Generating...' : 'Generate Style'}
                </button>
              ) : (
                <button className="sb-btn sb-btn--primary" onClick={handleAnalyze} disabled={!analyzeReady || analyzing}>
                  {analyzing ? 'Analyzing...' : 'Analyze Style'}
                </button>
              )}
              <button className="sb-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="sb-preview">
            <div className="sb-field">
              <label className="sb-label">Style Name</label>
              <input className="sb-input" value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder="e.g. Warm Studio Minimal" />
            </div>
            <div className="sb-field">
              <label className="sb-label">Description</label>
              <textarea className="sb-textarea sb-textarea--sm" value={styleDesc} onChange={(e) => setStyleDesc(e.target.value)} rows={2} />
            </div>
            <div className="sb-palette">
              <span className="sb-label">Palette</span>
              <div className="sb-swatches">
                {(analysis.color_palette || []).map((c, i) => (
                  <div key={i} className="sb-swatch" style={{ background: c }} title={c} />
                ))}
              </div>
            </div>
            <div className="sb-attrs">
              {['lighting', 'composition', 'model_posing', 'setting', 'mood', 'camera_angle'].map(k => (
                <div key={k} className="sb-attr">
                  <span className="sb-attr-key">{k.replace('_', ' ')}</span>
                  <span className="sb-attr-val">{analysis[k]}</span>
                </div>
              ))}
            </div>
            <div className="sb-field">
              <label className="sb-label">Prompt Template</label>
              <textarea className="sb-textarea" value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} rows={6} />
            </div>
            <div className="sb-actions">
              <button className="sb-btn sb-btn--primary" onClick={handleCreate} disabled={creating || !styleName.trim()}>
                {creating ? 'Creating...' : 'Create Style'}
              </button>
              <button className="sb-btn" onClick={() => setAnalysis(null)}>Back</button>
              <button className="sb-btn" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

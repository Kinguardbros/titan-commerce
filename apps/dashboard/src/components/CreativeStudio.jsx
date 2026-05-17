import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { generateCreatives, convertToVideo, getSkills, getProductDetail, getCustomStyles, createCustomStyle, getAvatars } from "../lib/api";
import { useToast } from "../hooks/useToast.jsx";
import StyleBuilder from "./StyleBuilder";

// Map V2 style IDs → backend style keys
const CATALOG_MODELS = [
  { id: 'everyday38', label: 'Model 1 (38) Everyday', prompt: 'A 38-year-old woman, US size 12-14, mid-size natural body with soft curves, real-looking belly and thighs, apple-shaped silhouette with weight carried in the midsection, full bust, soft arms. Shoulder-length warm brunette hair with subtle natural waves and slight golden undertones, slightly windswept. Fair-to-medium skin with a hint of natural warmth, light freckles on cheeks and shoulders, no tattoos. Soft round face with warm brown eyes, soft natural eyebrows, full cheeks, gentle smile lines. Calm warm expression with a soft genuine smile, approachable and grounded, looks like a real mid-30s mom who takes care of herself. Minimal natural makeup, no jewelry. North American or Northern European appearance, evokes the relatable everyday woman, not a model. Confident in her body, comfortable presence.' },
  { id: 'coastal28', label: 'Model 2 (28) Coastal', prompt: 'A 28-year-old woman, US size 4-6, slim athletic build with natural soft curves, not muscular and not skinny, healthy and toned. Long wavy chestnut brown hair with subtle natural highlights, falling past her shoulders, slightly windswept. Warm olive-toned skin with a light natural tan, no visible tattoos, minimal freckles across the nose. Soft oval face with high cheekbones, full natural eyebrows, hazel-green eyes, full lips, straight nose. Warm genuine smile that reaches her eyes, approachable and confident. No makeup or extremely minimal natural makeup. No jewelry. Mediterranean or Southern European appearance, evokes Italian or Spanish coastal beauty. Natural unposed energy, looks like a real woman on vacation, not a professional model.' },
  { id: 'confident48', label: 'Model 3 (48) Confident', prompt: 'A 48-year-old woman, US size 16-18, full plus-size natural body with generous curves, soft fuller belly, fuller hips and thighs, supportive bust, soft upper arms. Shoulder-length dark blonde or warm light-brown hair with subtle natural lowlights and a few silver-grey strands at the temples (showing real age, not aged), softly tousled and slightly windswept. Fair skin with a warm undertone, light sun-kissed glow, soft natural laugh lines around the eyes and mouth, no tattoos. Soft heart-shaped face with warm blue-grey eyes, soft natural eyebrows, full lips with a relaxed natural smile, gentle smile lines that show character not aging. Warm confident expression, secure and self-assured, looks like a real woman in her late 40s who has earned her presence. Minimal natural makeup, no jewelry. North American or Northern European appearance, evokes the confident mature woman who is finally buying for herself. Calm grounded energy.' },
];

const CATALOG_FRAMINGS = [
  { id: 'full', label: 'Full body', prompt: 'FRAMING: Full body shot from head to feet, model fills ~70% of vertical frame.' },
  { id: 'three-quarter', label: '3/4 body', prompt: 'FRAMING: Three-quarter body crop from head to mid-calf. Do NOT show feet. Model fills ~80% of vertical frame.' },
  { id: 'waist-up', label: 'Waist up', prompt: 'FRAMING: Crop from head to waist/hip level. Upper body portrait showing the top/bust area of the garment in detail. Model fills ~90% of vertical frame.' },
  { id: 'detail', label: 'Detail crop', prompt: 'FRAMING: Close-up crop from chest to upper thigh. Focus on the garment midsection — waistband, fabric texture, construction details. No face visible.' },
];

const CATALOG_POSES = [
  { id: 'hero', label: 'Hero Front', prompt: 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.' },
  { id: '34angle', label: '3/4 Angle', prompt: 'POSE: Body turned 30 degrees to the left, one hand resting lightly on hip, other arm relaxed. Looking directly at camera with warm confident expression. Shows side profile of the garment fit.' },
  { id: 'walking', label: 'Walking', prompt: 'POSE: Walking slowly toward camera at slight angle, one foot ahead of other in natural stride, arms swinging gently. Looking slightly past camera to the right as if noticing something. Genuine relaxed smile, wind catching hair slightly.' },
  { id: 'back', label: 'Back View', prompt: 'POSE: Full back view, standing naturally, looking over right shoulder toward camera with soft smile. Arms relaxed at sides. Shows back construction of the garment — straps, seaming, rear coverage.' },
  { id: 'armsup', label: 'Arms Up', prompt: 'POSE: Arms raised above head, hands touching or near hair. Direct eye contact, confident expression. Shows underarm fit, how top moves with body, strap behavior when arms are raised. Demonstrates freedom of movement.' },
  { id: 'profile', label: 'Side Profile', prompt: 'POSE: Full side profile view, body perpendicular to camera. Looking straight ahead or slightly toward camera. Shows silhouette, garment cut from the side, waistband height, leg opening. One foot slightly ahead of other.' },
];

const CATALOG_BEACH_SCENES = [
  { id: 'sunny', label: 'Bright sunny' },
  { id: 'golden', label: 'Golden hour' },
  { id: 'dune', label: 'Dune grass' },
  { id: 'cove', label: 'Rocky cove' },
];

const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "product-catalog-v3": "product_catalog_v3",
  "product-catalog-v4": "product_catalog_v4",
  "product-catalog-v5": "product_catalog_v5",
  "product-catalog-v6": "product_catalog_v6",
  "product-catalog-v7": "product_catalog_v7",
  "product-catalog-v8": "product_catalog_v8",
  "realistic-beach": "realistic_beach",
  "ad-creative": "ad_creative",
  "product-shot": "product_shot",
  "beach-photo": "product_photo_beach",
  "lifestyle": "lifestyle",
  "review-ugc": "review_ugc",
  "clean-minimal": "static_clean",
  "split-screen": "static_split",
  "urgency-sale": "static_urgency",
  "flat-lay": "product_shot",
  "summer-vibes": "lifestyle",
  "autumn-warm": "lifestyle",
  "winter-holiday": "lifestyle",
  "spring-fresh": "lifestyle",
  "ig-story": "ad_creative",
  "ig-feed": "ad_creative",
  "meta-ad": "ad_creative",
  "pinterest-pin": "lifestyle",
};

// Map V2 model IDs → backend model keys
const MODEL_MAP = {
  "flux2-edit": "fal_flux2_edit",
  "flux2-pro-edit": "fal_flux2_pro_edit",
  "ideogram-bg": "fal_ideogram_bg",
  "ideogram-edit": "fal_ideogram_edit",
  "flux-kontext": "fal_flux_kontext",
  "nano-banana": "fal_nano_banana",
  "nano-banana-pro": "fal_nano_banana_pro",
};

// Per-model cost estimate ($/image)
const MODEL_COST = {
  "flux2-edit": 0.012,
  "flux2-pro-edit": 0.03,
  "ideogram-bg": 0.03,
  "ideogram-edit": 0.03,
  "flux-kontext": 0.04,
  "nano-banana": 0.08,
  "nano-banana-pro": 0.15,
};

const NEON = "#E2A832";
const NEON_LIGHT = "#F0C45C";
const NEON_HOT = "#FFD666";
const NEON_DIM = "rgba(226,168,50,0.10)";
const NEON_BORDER = "rgba(226,168,50,0.5)";
const NEON_GLOW_SM = "0 0 6px rgba(226,168,50,0.3)";
const NEON_GLOW_MD = "0 0 12px rgba(226,168,50,0.35), 0 0 3px rgba(226,168,50,0.2)";
const NEON_GLOW_BTN = "0 0 18px rgba(226,168,50,0.3), 0 0 40px rgba(226,168,50,0.1)";
const CYAN = "#4EEADD";
const CYAN_DIM = "rgba(78,234,221,0.10)";
const CYAN_BORDER = "rgba(78,234,221,0.45)";
const CYAN_GLOW_SM = "0 0 6px rgba(78,234,221,0.3)";

const BG_DEEP = "#0c0c10";
const BG_CARD = "rgba(255,255,255,0.02)";
const BG_SURFACE = "rgba(255,255,255,0.025)";
const BORDER_DIM = "rgba(255,255,255,0.05)";
const BORDER_DEFAULT = "rgba(255,255,255,0.07)";
const TEXT_DIM = "rgba(255,255,255,0.25)";
const TEXT_MID = "rgba(255,255,255,0.45)";
const TEXT_BRIGHT = "rgba(255,255,255,0.7)";

// ─── SCENE MAP — which styles show scene picker ───
const SCENE_STYLES = new Set(["ad-creative", "beach-photo", "lifestyle", "review-ugc", "summer-vibes", "autumn-warm", "spring-fresh"]);
const SCENES = ["Auto", "Studio", "Beach", "Park", "Café", "Street", "Home interior", "Rooftop", "Garden"];

const STYLE_CATEGORIES = [
  {
    id: "product-photos", label: "Product photos", icon: "◉",
    styles: [
      { id: "product-catalog", title: "Product Catalog", desc: "Pro e-commerce, bright beach, editorial", icon: "📸" },
      { id: "product-catalog-v2", title: "Product Catalog v2", desc: "Golden hour, subject pops, simple controls", icon: "🌅" },
      { id: "product-catalog-v3", title: "Product Catalog v3", desc: "Studio shot → beach background (2-step)", icon: "🎬" },
      { id: "product-catalog-v4", title: "Product Catalog v4", desc: "Editorial strobe + on-location beach (Andie Swim aesthetic)", icon: "📷" },
      { id: "product-catalog-v5", title: "Product Catalog v5", desc: "Editorial strobe + warm afterglow (sun below horizon, product pops)", icon: "🌇" },
      { id: "product-catalog-v6", title: "Product Catalog v6", desc: "Editorial strobe + bright daylight beach (vivid turquoise ocean, blue sky)", icon: "☀️" },
      { id: "product-catalog-v7", title: "Product Catalog v7", desc: "Soft warm afterglow + balanced exposure (visible warm tones, natural look)", icon: "🌤" },
      { id: "product-catalog-v8", title: "Product Catalog v8", desc: "Color-aware lighting — auto-detected fill for dark and solid color fabrics", icon: "🎨" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
      { id: "product-shot", title: "Product shot", desc: "Clean white bg, detail focus", icon: "◉" },
      { id: "beach-photo", title: "Beach photo", desc: "Warm golden, ocean bokeh", icon: "◐" },
      { id: "clean-minimal", title: "Clean minimal", desc: "White bg, Apple-style", icon: "□" },
      { id: "flat-lay", title: "Flat lay", desc: "Top-down arrangement, props", icon: "▤" },
    ],
  },
  {
    id: "custom", label: "Custom scenes", icon: "✦",
    styles: [],
  },
  {
    id: "ad-creatives", label: "Images", icon: "✦",
    styles: [
      { id: "ad-creative", title: "Ad creative", desc: "Studio lighting, gold tones", icon: "✦" },
      { id: "lifestyle", title: "Lifestyle", desc: "Real setting, natural light", icon: "▣" },
      { id: "review-ugc", title: "Review / UGC", desc: "Mirror selfie, authentic", icon: "◫" },
      { id: "split-screen", title: "Split screen", desc: "Model left + product right", icon: "▥" },
      { id: "urgency-sale", title: "Urgency / sale", desc: "Bold gradient, flash energy", icon: "◆" },
    ],
  },
  {
    id: "seasonal", label: "Seasonal", icon: "❋",
    styles: [
      { id: "summer-vibes", title: "Summer vibes", desc: "Bright sun, poolside energy", icon: "◑" },
      { id: "autumn-warm", title: "Autumn warm", desc: "Golden leaves, cozy tones", icon: "◕" },
      { id: "winter-holiday", title: "Winter holiday", desc: "Snow, festive, gift wrap", icon: "❄" },
      { id: "spring-fresh", title: "Spring fresh", desc: "Flowers, pastels, garden", icon: "❀" },
    ],
  },
  {
    id: "platform", label: "Platform-optimized", icon: "⬡",
    styles: [
      { id: "ig-story", title: "IG story", desc: "9:16, bold text, swipe-up", icon: "▯" },
      { id: "ig-feed", title: "IG feed", desc: "1:1, curated aesthetic", icon: "▣" },
      { id: "meta-ad", title: "Meta ad", desc: "Primary text + CTA overlay", icon: "⬡" },
      { id: "pinterest-pin", title: "Pinterest pin", desc: "2:3, lifestyle editorial", icon: "▯" },
    ],
  },
];

const IMG_MODELS = [
  { id: "nano-banana-pro", label: "Nano Banana Pro", detail: "Best identity preserve — $0.15" },
  { id: "nano-banana", label: "Nano Banana 2", detail: "Reference editing — $0.08" },
  { id: "flux2-edit", label: "FLUX.2 Edit", detail: "Best value — $0.012" },
  { id: "flux2-pro-edit", label: "FLUX.2 Pro Edit", detail: "Best quality — $0.03" },
  { id: "ideogram-bg", label: "Ideogram BG Swap", detail: "Replace background — $0.03" },
  { id: "ideogram-edit", label: "Ideogram Edit", detail: "Smart editing — $0.03" },
  { id: "flux-kontext", label: "FLUX Kontext Pro", detail: "Identity preserve — $0.04" },
];
// Subset of IMG_MODELS allowed for Product Catalog v1-v5 styles. Catalog flows use
// the [avatar, productPhoto, avatar] sandwich pattern + need strong identity lock,
// so only Nano Banana variants are allowed for now. ChatGPT Image planned later.
const CATALOG_AI_MODELS = [
  { id: "nano-banana-pro", label: "Nano Banana Pro", detail: "Best identity preserve — $0.15/img" },
  { id: "nano-banana", label: "Nano Banana 2", detail: "Cheaper, slightly weaker identity — $0.08/img" },
];
// FUTURE: backdrop tint picker pro v5 (warm afterglow color override). Zakomentováno —
// uživatel místo toho chtěl PRODUCT color selector (Shopify variants). Backdrop selector
// může mít budoucnost (viz commit 25111a6), uchováváme.
// const V5_BACKDROP_COLORS = [
//   { id: 'peach', label: 'Soft peach' },
//   { id: 'rose', label: 'Dusty rose' },
//   { id: 'cream', label: 'Warm cream' },
//   { id: 'beige', label: 'Soft beige' },
//   { id: 'sage', label: 'Sage green' },
//   { id: 'lavender', label: 'Soft lavender' },
//   { id: 'taupe', label: 'Warm taupe' },
// ];
const VID_PROVIDERS = ["fal.ai", "Replicate", "RunwayML"];
const VID_MODELS = [
  { id: "kling-v3", label: "Kling V3 Pro", detail: "Best" },
  { id: "kling-v2", label: "Kling V2", detail: "Standard" },
  { id: "wan-21", label: "Wan 2.1", detail: "Fast" },
  { id: "ltx", label: "LTX Video", detail: "Budget" },
];
const QUALITIES = ["Draft", "Standard", "High"];
const DURATIONS = ["5s", "10s", "15s", "30s"];
const CAMERAS = ["Auto", "Static", "Pan left", "Pan right", "Zoom in", "Orbit"];
const POSES = ["Standing", "Sitting", "Walking", "Leaning", "Dynamic / action", "Close-up"];
const BODY_TYPES = ["Auto", "Slim", "Athletic", "Average", "Curvy", "Plus-size"];
const FRAMINGS = ["Full body", "Cropped with head", "Head crop"];
const IMG_RATIOS = [
  { label: "1:1", w: 40, h: 40 },
  { label: "4:5", w: 36, h: 45 },
  { label: "9:16", w: 28, h: 50 },
  { label: "16:9", w: 50, h: 28 },
];
// Output resolution (Nano Banana models only — others ignore it)
const IMG_RESOLUTIONS = ["1K", "2K", "4K"];
const VID_RATIOS = [
  { label: "16:9", w: 50, h: 28 },
  { label: "9:16", w: 28, h: 50 },
  { label: "1:1", w: 40, h: 40 },
];
const ICON_OPTIONS = ["✦","◉","◐","▣","◫","□","▥","◆","▤","◑","◕","❋","⬡","▯","❀","★","◇","△","○","▲"];

// ─── SHARED COMPONENTS ───

function Pill({ active, onClick, children, accent, disabled }) {
  const isAlt = accent === "cyan";
  const border = active ? (isAlt ? CYAN_BORDER : NEON_BORDER) : BORDER_DEFAULT;
  const bg = active ? (isAlt ? CYAN_DIM : NEON_DIM) : "transparent";
  const color = active ? (isAlt ? CYAN : NEON_LIGHT) : TEXT_MID;
  const glow = active ? (isAlt ? CYAN_GLOW_SM : NEON_GLOW_SM) : "none";
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      padding: "7px 16px", borderRadius: 999, fontSize: 13,
      fontFamily: "'DM Sans', sans-serif", cursor: disabled ? "not-allowed" : "pointer",
      whiteSpace: "nowrap", fontWeight: active ? 500 : 400,
      border: `1.5px solid ${border}`, color, background: bg,
      boxShadow: glow, transition: "all 0.25s",
      opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}

function NumBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 40, height: 40, borderRadius: "50%",
      border: `1.5px solid ${active ? NEON_BORDER : BORDER_DEFAULT}`,
      background: active ? NEON : "transparent",
      color: active ? BG_DEEP : TEXT_MID,
      fontSize: 14, fontWeight: 600, cursor: "pointer",
      transition: "all 0.25s", fontFamily: "'DM Sans', sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: active ? NEON_GLOW_MD : "none",
    }}>{children}</button>
  );
}

function RatioBox({ label, w, h, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: w, height: h,
      border: `1.5px solid ${active ? NEON_BORDER : BORDER_DEFAULT}`,
      borderRadius: 4, background: active ? NEON_DIM : "transparent",
      color: active ? NEON_LIGHT : "rgba(255,255,255,0.3)",
      fontSize: 10, fontFamily: "'DM Mono', monospace",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.25s", boxShadow: active ? NEON_GLOW_SM : "none",
    }}>{label}</button>
  );
}

function Select({ value, onChange, options, renderOption }) {
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: "100%", padding: "10px 36px 10px 14px",
        border: `1.5px solid ${BORDER_DEFAULT}`, borderRadius: 10,
        background: BG_SURFACE, color: "#fff", fontSize: 13,
        fontFamily: "'DM Sans', sans-serif", appearance: "none",
        cursor: "pointer", outline: "none", transition: "all 0.2s",
      }}>
        {options.map((opt, i) => (
          <option key={i} value={typeof opt === "string" ? opt : opt.id} style={{ background: "#111" }}>
            {renderOption ? renderOption(opt) : opt}
          </option>
        ))}
      </select>
      <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "rgba(255,255,255,0.25)", fontSize: 10 }}>▼</div>
    </div>
  );
}

function SectionLabel({ children, style: s }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
      textTransform: "uppercase", color: "rgba(255,255,255,0.28)",
      margin: "1.5rem 0 0.5rem", fontFamily: "'DM Mono', monospace", ...s,
    }}>{children}</div>
  );
}

function StyleCard({ style, selected, onClick, favorited, onToggleFav }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 14px", width: "100%",
      border: `1.5px solid ${selected ? NEON_BORDER : BORDER_DIM}`,
      borderRadius: 12, cursor: "pointer",
      background: selected ? NEON_DIM : BG_CARD,
      transition: "all 0.25s", textAlign: "left",
      display: "flex", alignItems: "flex-start", gap: 10,
      boxShadow: selected ? NEON_GLOW_SM : "none",
    }}>
      <span style={{
        fontSize: 15, opacity: selected ? 1 : 0.25, marginTop: 1, flexShrink: 0,
        transition: "all 0.25s", textShadow: selected ? `0 0 8px ${NEON}` : "none",
      }}>{style.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: selected ? NEON_LIGHT : TEXT_BRIGHT, fontFamily: "'DM Sans', sans-serif" }}>{style.title}</div>
        <div style={{ fontSize: 11, color: selected ? "rgba(255,255,255,0.45)" : TEXT_DIM, marginTop: 1, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{style.desc}</div>
      </div>
      <span onClick={(e) => { e.stopPropagation(); onToggleFav(); }} style={{
        fontSize: 12, cursor: "pointer", flexShrink: 0, marginTop: 2,
        opacity: favorited ? 1 : 0.15, transition: "all 0.2s",
        color: favorited ? NEON_HOT : "#fff",
        textShadow: favorited ? `0 0 6px ${NEON}` : "none",
      }}>★</span>
    </button>
  );
}

function CategorySection({ category, selectedStyle, onSelectStyle, favorites, onToggleFav, collapsed, onToggle, customStyles }) {
  const styles = category.id === "custom" ? [...category.styles, ...customStyles] : category.styles;
  return (
    <div style={{ marginBottom: 6 }}>
      <button onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "9px 4px", background: "transparent", border: "none",
        cursor: "pointer", fontSize: 11, fontWeight: 600,
        letterSpacing: "0.1em", textTransform: "uppercase",
        fontFamily: "'DM Mono', monospace", color: "rgba(255,255,255,0.4)",
      }}>
        <span style={{ display: "inline-block", transition: "transform 0.25s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", fontSize: 8 }}>▼</span>
        <span style={{ fontSize: 12 }}>{category.icon}</span>
        <span>{category.label}</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", fontWeight: 400, marginLeft: "auto" }}>{styles.length}</span>
      </button>
      {!collapsed && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "4px 0 8px" }}>
          {styles.map((s) => (
            <StyleCard key={s.id} style={s} selected={selectedStyle === s.id} onClick={() => onSelectStyle(s.id)}
              favorited={favorites.has(s.id)} onToggleFav={() => onToggleFav(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// StyleBuilderModal removed — replaced by StyleBuilder.jsx component

// ─── A/B VARIANT PANEL ───

function ABVariantPanel({ label, accent, pose, onPoseChange, scene, onSceneChange, showScene, style: styleId, onStyleChange, allStyles }) {
  const borderCol = accent === "cyan" ? CYAN_BORDER : NEON_BORDER;
  const bgCol = accent === "cyan" ? CYAN_DIM : NEON_DIM;
  const labelCol = accent === "cyan" ? CYAN : NEON_LIGHT;
  const glowCol = accent === "cyan" ? CYAN_GLOW_SM : NEON_GLOW_SM;
  return (
    <div style={{
      flex: 1, padding: "14px 16px", borderRadius: 14,
      border: `1.5px solid ${borderCol}`, background: bgCol,
      boxShadow: glowCol,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: labelCol, fontFamily: "'DM Mono', monospace", marginBottom: 10 }}>
        {label}
      </div>
      <SectionLabel style={{ marginTop: 0 }}>Style</SectionLabel>
      <Select value={styleId} onChange={onStyleChange} options={allStyles} renderOption={(s) => `${s.icon} ${s.title}`} />
      <SectionLabel>Pose</SectionLabel>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {POSES.map((p) => (
          <Pill key={p} active={pose === p} onClick={() => onPoseChange(p)} accent={accent}>{p}</Pill>
        ))}
      </div>
      {showScene && (
        <>
          <SectionLabel>Scene</SectionLabel>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {SCENES.map((s) => (
              <Pill key={s} active={scene === s} onClick={() => onSceneChange(s)} accent={accent}>{s}</Pill>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── MAIN ───

export default function CreativeStudio({ product, storeId, creatives = [], onGenerated, onClose }) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [completed, setCompleted] = useState(0);

  // Load colors from product variants
  const [colors, setColors] = useState([]);
  const [selectedColor, setSelectedColor] = useState("All colors");
  const [colorToImage, setColorToImage] = useState({});
  const [personas, setPersonas] = useState([]);
  const [audience, setAudience] = useState("auto");
  const [useAudience, setUseAudience] = useState(true);

  useEffect(() => {
    const sid = storeId;
    if (!sid || !product?.id) return;
    getProductDetail(sid, product.id).then((data) => {
      if (!data?.product?.variants) return;
      const sizes = new Set(["S","M","L","XL","XXL","2XL","3XL","XS","OS","One Size"]);
      const colorSet = new Set();
      const imageById = new Map((data.product.images || []).map((img) => [img.id, img.src]));
      const mapping = {};
      for (const v of data.product.variants) {
        for (const opt of [v.option1, v.option2, v.option3]) {
          if (!opt || sizes.has(opt)) continue;
          colorSet.add(opt);
          if (v.image_id && !mapping[opt]) {
            const url = imageById.get(v.image_id);
            if (url) mapping[opt] = url;
          }
        }
      }
      if (colorSet.size > 0) setColors(["All colors", ...colorSet]);
      setColorToImage(mapping);
    }).catch(() => {});
    Promise.all([
      getSkills(sid),
      getAvatars(sid),
    ]).then(([skillsData, avatarData]) => {
      const parsed = [];
      const as = (skillsData.skills || []).find((s) => s.skill_type === "audience-personas");
      if (as?.content) {
        // Format 1: "Name (Age) — Label"
        const rx1 = /(?:###?\s*|(?:\*\*))?\s*(\w+)\s*\((\d+)\)\s*(?:\*\*)?\s*[—–-]\s*(.+?)(?:\n|$)/g;
        let m; while ((m = rx1.exec(as.content)) !== null) parsed.push({ name: m[1], age: m[2], label: m[3].trim().replace(/\*+$/, "") });
        // Format 2: "### Persona N: Name "Label"\n- **Age**: N"
        if (!parsed.length) {
          const rx2 = /###\s*Persona\s*\d+:\s*(\w+)\s*"([^"]+)"\s*\n[^]*?(?:\*\*Age\*\*|Age):\s*(\d+)/g;
          while ((m = rx2.exec(as.content)) !== null) parsed.push({ name: m[1], age: m[3], label: m[2].trim() });
        }
      }
      // Attach avatar metadata (reference photo + active flag) to skill-derived personas by name
      const avByName = new Map((avatarData || []).map((av) => [av.persona_name, av]));
      for (const p of parsed) {
        const av = avByName.get(p.name);
        if (av) { p.reference_url = av.reference_url || null; p.is_active = av.is_active !== false; }
        else { p.is_active = true; }
      }
      // Add custom avatars not in audience-personas skill
      const skillNames = new Set(parsed.map((p) => p.name));
      for (const av of avatarData || []) {
        if (!skillNames.has(av.persona_name) && av.reference_url) {
          parsed.push({ name: av.persona_name, age: '', label: av.description || 'Custom avatar', reference_url: av.reference_url, is_active: av.is_active !== false });
        }
      }
      if (parsed.length) setPersonas(parsed.filter((p) => p.is_active !== false));
    }).catch(() => {});
  }, [storeId, product?.id]);
  const [tab, setTab] = useState("image");
  // Image config
  const [imgStyle, setImgStyle] = useState("ad-creative");
  const [imgModel, setImgModel] = useState("nano-banana-pro");
  // Catalog-only AI model picker (separate from imgModel because catalog flows force a Nano Banana variant)
  const [catalogAiModel, setCatalogAiModel] = useState("nano-banana-pro");
  // FUTURE: backdrop tint state pro v5 — zakomentováno společně s V5_BACKDROP_COLORS výše. Viz commit 25111a6.
  // const [v5BackdropColor, setV5BackdropColor] = useState("peach");
  const [subject, setSubject] = useState("On model");
  const [textMode, setTextMode] = useState("No text");
  const [customText, setCustomText] = useState("");
  const [imgCount, setImgCount] = useState(2);
  const [imgRatio, setImgRatio] = useState("1:1");
  const [imgResolution, setImgResolution] = useState("2K");
  const [imgInstructions, setImgInstructions] = useState("");
  const [modelPose, setModelPose] = useState("Standing");
  const [bodyType, setBodyType] = useState("Auto");
  const [framing, setFraming] = useState("Full body");
  const [scene, setScene] = useState("Auto");
  const [negPrompt, setNegPrompt] = useState("");
  const [catalogPose, setCatalogPose] = useState("hero");
  const [catalogModel, setCatalogModel] = useState("everyday38");
  const [catalogFraming, setCatalogFraming] = useState("three-quarter");
  const [catalogAvatar, setCatalogAvatar] = useState(null); // persona name, or null = use text preset
  const [catalogBeach, setCatalogBeach] = useState("sunny"); // Product Catalog v3 step-2 beach scene
  const [v8FillIntensity, setV8FillIntensity] = useState("medium"); // Product Catalog v8 off-axis fill strength
  const [showNegPrompt, setShowNegPrompt] = useState(false);
  // A/B test
  const [abMode, setAbMode] = useState(false);
  const [abPose, setAbPose] = useState("Walking");
  const [abScene, setAbScene] = useState("Auto");
  const [abStyle, setAbStyle] = useState("lifestyle");
  // Video config
  const [vidPrompt, setVidPrompt] = useState("");
  const [vidProvider, setVidProvider] = useState("fal.ai");
  const [vidModel, setVidModel] = useState("kling-v3");
  const [quality, setQuality] = useState("Standard");
  const [duration, setDuration] = useState("5s");
  const [vidRatio, setVidRatio] = useState("16:9");
  const [camera, setCamera] = useState("Auto");
  const [cfg, setCfg] = useState(7);
  // Style management
  const [favorites, setFavorites] = useState(() => {
    try { const s = localStorage.getItem('cs_favorites'); return s ? new Set(JSON.parse(s)) : new Set(["ad-creative"]); } catch { return new Set(["ad-creative"]); }
  });
  const [collapsedCats, setCollapsedCats] = useState(new Set());
  const [showBuilder, setShowBuilder] = useState(false);
  const [customStyles, setCustomStyles] = useState([]);
  const [showFavsOnly, setShowFavsOnly] = useState(false);

  // Load custom styles from backend
  useEffect(() => {
    if (!storeId) return;
    getCustomStyles(storeId).then(data => {
      setCustomStyles((data || []).map(cs => ({
        id: cs.style_key, title: cs.name, desc: cs.color_palette?.slice(0, 3).join(', ') || 'Custom',
        thumb: cs.reference_images?.[0] || null,
      })));
    }).catch(() => {});
  }, [storeId]);

  const toggleFav = useCallback((id) => {
    setFavorites((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); localStorage.setItem('cs_favorites', JSON.stringify([...n])); return n; });
  }, []);
  const toggleCat = useCallback((catId) => {
    setCollapsedCats((p) => { const n = new Set(p); n.has(catId) ? n.delete(catId) : n.add(catId); return n; });
  }, []);
  const handleSaveCustomStyle = useCallback(async (style) => {
    try {
      const result = await createCustomStyle(storeId, style.title || style.id, style.desc || '', style.analysis || {}, style.referenceImages || []);
      setCustomStyles(prev => [...prev, { id: result.style_key, title: style.title || style.id, desc: style.desc || '' }]);
      setImgStyle(result.style_key);
    } catch (err) {
      console.error('[CreativeStudio] Save custom style failed:', { error: err.message });
    }
    setShowBuilder(false);
  }, [storeId]);

  const allStyles = useMemo(() => {
    const all = [];
    STYLE_CATEGORIES.forEach((cat) => { all.push(...(cat.id === "custom" ? [...cat.styles, ...customStyles] : cat.styles)); });
    return all;
  }, [customStyles]);

  const styleName = allStyles.find((s) => s.id === imgStyle)?.title || "image";
  const showSceneForStyle = SCENE_STYLES.has(imgStyle);
  const showSceneForAb = SCENE_STYLES.has(abStyle);
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isProductCatalogV4Style = imgStyle === "product-catalog-v4";
  const isProductCatalogV5Style = imgStyle === "product-catalog-v5";
  const isProductCatalogV6Style = imgStyle === "product-catalog-v6";
  const isProductCatalogV7Style = imgStyle === "product-catalog-v7";
  const isProductCatalogV8Style = imgStyle === "product-catalog-v8";
  const isProductCatalogV1Style = imgStyle === "product-catalog";
  const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style || isProductCatalogV4Style || isProductCatalogV5Style || isProductCatalogV6Style || isProductCatalogV7Style || isProductCatalogV8Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";

  const imgCost = useMemo(() => {
    // For catalog styles use the catalog model picker; otherwise the general imgModel
    const activeModel = isAnyCatalogStyle ? catalogAiModel : imgModel;
    const perImage = MODEL_COST[activeModel] || 0.03;
    const base = imgCount * perImage;
    return abMode ? (base * 2).toFixed(2) : base.toFixed(2);
  }, [imgCount, abMode, imgModel, isAnyCatalogStyle, catalogAiModel]);

  const vidCost = useMemo(() => {
    const dur = parseInt(duration);
    const qMult = quality === "Draft" ? 0.6 : quality === "High" ? 2.0 : 1.0;
    return (0.28 * (dur / 5) * qMult).toFixed(2);
  }, [duration, quality]);

  const buildMsg = useCallback((styleId, pose, scn) => {
    const model = IMG_MODELS.find((m) => m.id === imgModel)?.label || imgModel;
    const sObj = allStyles.find((s) => s.id === styleId);
    const sName = sObj?.title || "image";
    let msg = `Generate ${imgCount} ${sName.toLowerCase()}(s), ${subject}, ${imgRatio}, model: ${model}`;
    if (imgModel.startsWith("nano-banana")) msg += `, ${imgResolution}`;
    if (styleId === "product-catalog" && catalogAvatar) msg += `, avatar: ${catalogAvatar}`;
    if (subject === "On model") msg += `, pose: ${pose}`;
    if (SCENE_STYLES.has(styleId) && scn !== "Auto") msg += `, scene: ${scn}`;
    if (sObj?.prompt) msg += `, style prompt: ${sObj.prompt}`;
    if (imgInstructions) msg += `, instructions: ${imgInstructions}`;
    if (textMode === "Custom" && customText) msg += `, text overlay: "${customText}"`;
    if (negPrompt.trim()) msg += `, negative: ${negPrompt.trim()}`;
    return msg;
  }, [imgModel, imgCount, subject, imgRatio, imgResolution, catalogAvatar, imgInstructions, textMode, customText, negPrompt, allStyles]);

  const handleGenImage = useCallback(async () => {
    if (!product?.id || generating) return;
    if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3' || imgStyle === 'product-catalog-v4' || imgStyle === 'product-catalog-v5' || imgStyle === 'product-catalog-v6' || imgStyle === 'product-catalog-v7' || imgStyle === 'product-catalog-v8') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
    setGenerating(true); setCompleted(0);
    toast.info("Generating...");

    const backendStyle = imgStyle.startsWith('cs_') ? imgStyle : (STYLE_MAP[imgStyle] || "ad_creative");
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
    const isProductCatalogV4 = imgStyle === 'product-catalog-v4';
    const isProductCatalogV5 = imgStyle === 'product-catalog-v5';
    const isProductCatalogV6 = imgStyle === 'product-catalog-v6';
    const isProductCatalogV7 = imgStyle === 'product-catalog-v7';
    const isProductCatalogV8 = imgStyle === 'product-catalog-v8';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8;
    // Catalog styles hide the model picker — force Nano Banana Pro (best identity preservation)
    const backendModel = isAnyCatalog ? (MODEL_MAP[catalogAiModel] || "fal_nano_banana_pro") : (MODEL_MAP[imgModel] || "fal_nano_banana");
    const colorRef = selectedColor !== "All colors" ? (colorToImage[selectedColor] || null) : null;
    const colorPrefix = selectedColor !== "All colors" ? `Product color: ${selectedColor}. ` : "";
    const poseHint = subject === "On model" && modelPose !== "Standing" ? `Model pose: ${modelPose}. ` : "";
    const bodyHint = subject === "On model" && bodyType !== "Auto" ? `Model body type: ${bodyType}. ` : "";
    const framingHint = subject === "On model" ? (
      framing === "Head crop" ? `Framing: crop from chest up, do NOT show full head — cut off the top of the head above the eyes. Focus on the product, not the face. `
      : framing === "Cropped with head" ? `Framing: crop from waist/hip up, show full head and face. Upper body portrait with the product clearly visible. `
      : `Framing: full body shot, show the model head to toe. `
    ) : "";
    const sceneHint = SCENE_STYLES.has(imgStyle) && scene !== "Auto" ? `Scene: ${scene}. ` : "";
    const negHint = negPrompt.trim() ? `\nNegative: ${negPrompt.trim()}` : "";
    const isProductCatalogStyle = imgStyle === 'product-catalog';
    const catalogPosePrompt = isAnyCatalog ? (CATALOG_POSES.find(p => p.id === catalogPose)?.prompt || '') : '';
    const catalogModelPrompt = isAnyCatalog ? (CATALOG_MODELS.find(m => m.id === catalogModel)?.prompt || '') : '';
    const catalogFramingPrompt = isProductCatalogStyle ? (CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.prompt || '') : '';
    const catalogModelLabel = catalogAvatar || (CATALOG_MODELS.find(m => m.id === catalogModel)?.label || '');
    const catalogPoseLabel = CATALOG_POSES.find(p => p.id === catalogPose)?.label || '';
    const catalogFramingLabel = CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.label || '';
    // v1: when an avatar is chosen, the model comes from the avatar reference (sent via `audience`),
    // so leave the model description out of custom_prompt.
    const catalogModelBlock = isProductCatalogStyle && !catalogAvatar ? `${catalogModelPrompt}\n\n` : '';
    const customInstr = isProductCatalogV8
      ? '' // v8: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV7
      ? '' // v7: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV6
      ? '' // v6: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV5
      ? '' // v5: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV4
      ? '' // v4: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV3
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();

    const stylesToGen = abMode ? [imgStyle, abStyle] : [imgStyle];
    const jobs = [];
    for (const sId of stylesToGen) {
      const bs = sId.startsWith('cs_') ? sId : (STYLE_MAP[sId] || "ad_creative");
      for (let i = 0; i < imgCount; i++) {
        jobs.push(
          generateCreatives({
            product_id: product.id, store_id: storeId, style: bs, ai_model: backendModel,
            custom_prompt: customInstr,
            show_model: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle) ? true : subject === "On model",
            text_overlay: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle) ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle) ? "" : (textMode === "Custom" ? customText : ""),
            audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle) ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogV5 || isProductCatalogV6 || isProductCatalogV7 || isProductCatalogV8Style || isProductCatalogStyle) ? undefined : colorRef,
            product_color: (isAnyCatalog && selectedColor && selectedColor !== "All colors") ? selectedColor : undefined,
            // Variant image — when user picks a color variant, send the variant's product image so
            // backend can use IT as the garment reference (instead of the default featured image,
            // which is typically the wrong color). The visual signal beats any text override.
            variant_image_url: (isAnyCatalog && selectedColor && selectedColor !== "All colors" && colorRef) ? colorRef : undefined,
            v8_fill_intensity: isProductCatalogV8Style ? v8FillIntensity : undefined,
          }).then(() => setCompleted((p) => p + 1))
            .catch((err) => toast.error(`Failed: ${err.message}`))
        );
      }
    }
    await Promise.all(jobs);
    setGenerating(false);
    toast.success(`Generated!`);
    if (onGenerated) onGenerated();
  }, [product, storeId, imgStyle, imgModel, catalogAiModel, imgCount, subject, modelPose, scene, imgInstructions, textMode, customText, negPrompt, imgResolution, catalogAvatar, catalogModel, catalogPose, catalogFraming, catalogBeach, v8FillIntensity, abMode, abStyle, selectedColor, colorToImage, audience, useAudience, generating, onGenerated, toast]);

  const handleGenVideo = useCallback(async () => {
    if (generating) return;
    const sourceImages = creatives.filter((c) => c.format === "image" && c.status === "approved" && c.file_url);
    if (sourceImages.length === 0) { toast.error("No approved images to convert"); return; }
    setGenerating(true);
    toast.info("Converting to video...");
    try {
      await convertToVideo(sourceImages[0].id);
      toast.success("Video generated!");
      if (onGenerated) onGenerated();
    } catch (err) { toast.error(`Video failed: ${err.message}`); }
    setGenerating(false);
  }, [creatives, generating, onGenerated, toast]);

  const filteredCategories = useMemo(() => {
    if (!showFavsOnly) return STYLE_CATEGORIES;
    return STYLE_CATEGORIES.map((cat) => {
      const styles = (cat.id === "custom" ? [...cat.styles, ...customStyles] : cat.styles).filter((s) => favorites.has(s.id));
      return { ...cat, styles };
    }).filter((cat) => cat.styles.length > 0);
  }, [showFavsOnly, favorites, customStyles]);

  const inputStyle = {
    width: "100%", padding: "10px 14px", border: `1.5px solid ${BORDER_DEFAULT}`,
    borderRadius: 10, background: BG_SURFACE, color: "#fff",
    fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box",
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(8,8,11,0.85)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.2s ease",
    }}>
    <div style={{
      maxWidth: 760, width: "95vw", maxHeight: "90vh", overflowY: "auto",
      padding: "2rem 1.5rem",
      fontFamily: "'DM Sans', sans-serif", color: "#fff",
      background: BG_DEEP, borderRadius: 16, position: "relative",
      animation: "fadeIn 0.3s cubic-bezier(.22,1,.36,1)",
      border: `1px solid ${BORDER_DEFAULT}`,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Close button */}
      {onClose && (
        <button onClick={onClose} style={{
          position: "absolute", top: 14, right: 14, zIndex: 2,
          background: BG_SURFACE, border: `1px solid ${BORDER_DEFAULT}`,
          color: TEXT_MID, width: 32, height: 32, borderRadius: 8,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, transition: "all 0.25s",
        }}
        onMouseEnter={(e) => { e.target.style.borderColor = NEON; e.target.style.color = NEON; }}
        onMouseLeave={(e) => { e.target.style.borderColor = BORDER_DEFAULT; e.target.style.color = TEXT_MID; }}
        >✕</button>
      )}

      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: NEON }} />
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: NEON, fontFamily: "'DM Mono', monospace" }}>Creative studio</span>
          <span style={{ fontSize: 10, color: TEXT_DIM, fontFamily: "'DM Mono', monospace", marginLeft: "auto" }}>v2</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "8px 0 0", letterSpacing: "-0.02em", color: "#fff" }}>Generate visuals</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: "1.75rem", background: BG_SURFACE, borderRadius: 12, padding: 3, border: `1px solid rgba(255,255,255,0.03)` }}>
        {["image", "video"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "11px 0",
            border: tab === t ? `1px solid ${NEON_BORDER}` : "1px solid transparent",
            background: tab === t ? NEON_DIM : "transparent",
            color: tab === t ? NEON_LIGHT : "rgba(255,255,255,0.3)",
            fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
            cursor: "pointer", borderRadius: 10, transition: "all 0.25s",
            boxShadow: tab === t ? NEON_GLOW_SM : "none",
          }}>{t === "image" ? "◉ Image" : "▶ Video"}</button>
        ))}
      </div>

      {/* ═══ IMAGE TAB ═══ */}
      {tab === "image" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>

          {/* Product info */}
          {product && (
            <div style={{ padding: "10px 14px", borderRadius: 12, border: `1px solid ${BORDER_DIM}`, background: BG_CARD, marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10 }}>
              {product.image_url && <img src={product.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{product.title}</div>
                {product.price && <div style={{ fontSize: 11, color: NEON, fontFamily: "'DM Mono', monospace" }}>${product.price}</div>}
              </div>
            </div>
          )}

          {/* Styles header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <SectionLabel style={{ margin: 0, flex: 1 }}>Styles</SectionLabel>
            <button onClick={() => setShowFavsOnly((p) => !p)} style={{
              padding: "4px 10px", borderRadius: 999, fontSize: 11, fontFamily: "'DM Mono', monospace",
              border: `1px solid ${showFavsOnly ? NEON_BORDER : BORDER_DIM}`,
              background: showFavsOnly ? NEON_DIM : "transparent",
              color: showFavsOnly ? NEON_LIGHT : TEXT_MID, cursor: "pointer",
              boxShadow: showFavsOnly ? NEON_GLOW_SM : "none", transition: "all 0.2s",
            }}>★ Favorites</button>
            <button onClick={() => setShowBuilder(true)} style={{
              padding: "4px 10px", borderRadius: 999, fontSize: 11, fontFamily: "'DM Mono', monospace",
              border: `1px solid ${BORDER_DIM}`, background: "transparent",
              color: TEXT_MID, cursor: "pointer",
            }}>+ New style</button>
          </div>

          {/* Style categories */}
          <div style={{ background: BG_SURFACE, borderRadius: 14, border: `1px solid rgba(255,255,255,0.03)`, padding: "8px 12px", marginBottom: "1rem" }}>
            {filteredCategories.map((cat) => (
              <CategorySection key={cat.id} category={cat} selectedStyle={imgStyle} onSelectStyle={setImgStyle}
                favorites={favorites} onToggleFav={toggleFav} collapsed={collapsedCats.has(cat.id)}
                onToggle={() => toggleCat(cat.id)} customStyles={cat.id === "custom" && !showFavsOnly ? customStyles : []} />
            ))}
            {filteredCategories.length === 0 && (
              <div style={{ padding: "24px 0", textAlign: "center", color: TEXT_MID, fontSize: 13 }}>No favorites yet — star a style to add it here</div>
            )}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "1rem 0" }} />

          {/* Model + Subject — hidden for catalog styles */}
          {!isAnyCatalogStyle && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <SectionLabel style={{ marginTop: 0 }}>Model</SectionLabel>
                <Select value={imgModel} onChange={setImgModel} options={IMG_MODELS} renderOption={(m) => `${m.label} — ${m.detail}`} />
              </div>
              <div>
                <SectionLabel style={{ marginTop: 0 }}>Subject</SectionLabel>
                <div style={{ display: "flex", gap: 6 }}>
                  {["On model", "Product only"].map((s) => (
                    <Pill key={s} active={subject === s} onClick={() => setSubject(s)}>{s}</Pill>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Color — visible for both catalog and non-catalog flows when product has variant colors */}
          {colors.length > 1 && (
            <div>
              <SectionLabel style={{ marginTop: "0.75rem" }}>Color</SectionLabel>
              <Select value={selectedColor} onChange={setSelectedColor} options={colors} />
            </div>
          )}

          {/* Audience switch — hidden for catalog styles (catalog má vlastní Reference model dropdown) */}
          {!isAnyCatalogStyle && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {personas.length > 0 && subject === "On model" && imgStyle !== "realistic-beach" && !isAnyCatalogStyle && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "0.75rem" }}>
                  <button onClick={() => setUseAudience(!useAudience)} style={{
                    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                    background: useAudience ? NEON : "rgba(255,255,255,0.08)", position: "relative", transition: "background 0.2s",
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 8, background: "#fff",
                      position: "absolute", top: 2, left: useAudience ? 18 : 2, transition: "left 0.2s",
                    }} />
                  </button>
                  <SectionLabel style={{ margin: 0 }}>Audience targeting</SectionLabel>
                  <div className="cs-audience-tip" style={{ position: "relative", display: "inline-flex" }}>
                    <span style={{ width: 16, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER_DIM}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: TEXT_MID, cursor: "help" }}>?</span>
                    <div className="cs-audience-tooltip" style={{
                      display: "none", position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                      background: "#1a1a22", border: `1px solid ${BORDER_DEFAULT}`, borderRadius: 10, padding: "12px 14px",
                      width: 260, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Audience Targeting</div>
                      <div style={{ fontSize: 10, color: TEXT_MID, lineHeight: 1.5, marginBottom: 8 }}>
                        When enabled, the AI model on the photo will match your target audience persona — age, body type, expression, and energy.
                      </div>
                      {personas.length > 0 && (
                        <div style={{ fontSize: 9, color: TEXT_DIM, borderTop: `1px solid ${BORDER_DIM}`, paddingTop: 6 }}>
                          {personas.map((p, i) => (
                            <div key={i} style={{ marginBottom: 3 }}><span style={{ color: NEON_LIGHT }}>{p.name}</span> ({p.age}) — {p.label}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {useAudience && (
                  <Select value={audience} onChange={setAudience} options={["auto", ...personas.map((p) => p.name)]} renderOption={(opt) => opt === "auto" ? "Auto — best match" : `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || ""}`} />
                )}
              </div>
            )}
          </div>}

          {/* Model pose — conditional */}
          {subject === "On model" && !abMode && imgStyle !== "realistic-beach" && !isAnyCatalogStyle && (
            <div>
              <SectionLabel>Model pose</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {POSES.map((p) => (
                  <Pill key={p} active={modelPose === p} onClick={() => setModelPose(p)}>{p}</Pill>
                ))}
              </div>
            </div>
          )}

          {/* Body type — hidden for realistic-beach (hardcoded in prompt) */}
          {subject === "On model" && !abMode && imgStyle !== "realistic-beach" && !isAnyCatalogStyle && (
            <div>
              <SectionLabel>Body type</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {BODY_TYPES.map((b) => (
                  <Pill key={b} active={bodyType === b} onClick={() => setBodyType(b)}>{b}</Pill>
                ))}
              </div>
            </div>
          )}

          {/* Framing — hidden for realistic-beach */}
          {subject === "On model" && !abMode && imgStyle !== "realistic-beach" && !isAnyCatalogStyle && (
            <div>
              <SectionLabel>Framing</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FRAMINGS.map((f) => (
                  <Pill key={f} active={framing === f} onClick={() => setFraming(f)}>{f}</Pill>
                ))}
              </div>
            </div>
          )}

          {/* Shared AI model picker for all Product Catalog styles (v1-v5) — Nano Banana variants only (sandwich-friendly + identity-preserve). */}
          {isAnyCatalogStyle && (
            <div>
              <SectionLabel>AI model</SectionLabel>
              <Select
                value={catalogAiModel}
                onChange={setCatalogAiModel}
                options={CATALOG_AI_MODELS}
                renderOption={(m) => `${m.label} — ${m.detail}`}
              />
            </div>
          )}

          {/* Catalog v1 controls — Reference model (avatar, required) + Pose; framing/aspect/model preset/beach scene removed, post-process always crops to 3/4, beach is hardcoded sunny in the backend */}
          {imgStyle === "product-catalog" && (
            <>
              <div>
                <SectionLabel>Reference model</SectionLabel>
                {personas.filter((p) => p.reference_url).length > 0 ? (
                  <Select
                    value={catalogAvatar || ""}
                    onChange={setCatalogAvatar}
                    options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                    renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                    No persona avatars yet — create one in the Avatars tab to use this style.
                  </div>
                )}
              </div>
              <div>
                <SectionLabel>Pose</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_POSES.map((p) => (
                    <Pill key={p.id} active={catalogPose === p.id} onClick={() => setCatalogPose(p.id)}>{p.label}</Pill>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Catalog v2 controls — only Reference model (avatar, required) + Pose; everything else hardcoded in the v2 prompt */}
          {imgStyle === "product-catalog-v2" && (
            <>
              <div>
                <SectionLabel>Reference model</SectionLabel>
                {personas.filter((p) => p.reference_url).length > 0 ? (
                  <Select
                    value={catalogAvatar || ""}
                    onChange={setCatalogAvatar}
                    options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                    renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                    No persona avatars yet — create one in the Avatars tab to use this style.
                  </div>
                )}
              </div>
              <div>
                <SectionLabel>Pose</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_POSES.map((p) => (
                    <Pill key={p.id} active={catalogPose === p.id} onClick={() => setCatalogPose(p.id)}>{p.label}</Pill>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Catalog v3 controls — Reference model (avatar, required) + Pose + Beach scene; step 1 is a clean studio shot, step 2 swaps in the beach */}
          {imgStyle === "product-catalog-v3" && (
            <>
              <div>
                <SectionLabel>Reference model</SectionLabel>
                {personas.filter((p) => p.reference_url).length > 0 ? (
                  <Select
                    value={catalogAvatar || ""}
                    onChange={setCatalogAvatar}
                    options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                    renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                    No persona avatars yet — create one in the Avatars tab to use this style.
                  </div>
                )}
              </div>
              <div>
                <SectionLabel>Pose</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_POSES.map((p) => (
                    <Pill key={p.id} active={catalogPose === p.id} onClick={() => setCatalogPose(p.id)}>{p.label}</Pill>
                  ))}
                </div>
              </div>
              <div>
                <SectionLabel>Beach scene</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_BEACH_SCENES.map((s) => (
                    <Pill key={s.id} active={catalogBeach === s.id} onClick={() => setCatalogBeach(s.id)}>{s.label}</Pill>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Catalog v4 controls — Reference model only (everything else is hardcoded server-side) */}
          {imgStyle === "product-catalog-v4" && (
            <div>
              <SectionLabel>Reference model</SectionLabel>
              {personas.filter((p) => p.reference_url).length > 0 ? (
                <Select
                  value={catalogAvatar || ""}
                  onChange={setCatalogAvatar}
                  options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                  renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
              ) : (
                <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                  No persona avatars yet — create one in the Avatars tab to use this style.
                </div>
              )}
            </div>
          )}

          {/* Catalog v5 controls — Reference model only (everything else is hardcoded server-side). Backdrop color picker zakomentován, viz commit 25111a6. */}
          {imgStyle === "product-catalog-v5" && (
            <div>
              <SectionLabel>Reference model</SectionLabel>
              {personas.filter((p) => p.reference_url).length > 0 ? (
                <Select
                  value={catalogAvatar || ""}
                  onChange={setCatalogAvatar}
                  options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                  renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
              ) : (
                <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                  No persona avatars yet — create one in the Avatars tab to use this style.
                </div>
              )}
            </div>
          )}

          {/* Catalog v6 controls — Reference model only (everything else is hardcoded server-side). Bright midday daylight + vivid background. */}
          {imgStyle === "product-catalog-v6" && (
            <div>
              <SectionLabel>Reference model</SectionLabel>
              {personas.filter((p) => p.reference_url).length > 0 ? (
                <Select
                  value={catalogAvatar || ""}
                  onChange={setCatalogAvatar}
                  options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                  renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
              ) : (
                <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                  No persona avatars yet — create one in the Avatars tab to use this style.
                </div>
              )}
            </div>
          )}

          {/* Catalog v7 controls — Reference model only (everything else is hardcoded server-side). Soft warm afterglow + balanced exposure. */}
          {imgStyle === "product-catalog-v7" && (
            <div>
              <SectionLabel>Reference model</SectionLabel>
              {personas.filter((p) => p.reference_url).length > 0 ? (
                <Select
                  value={catalogAvatar || ""}
                  onChange={setCatalogAvatar}
                  options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                  renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
              ) : (
                <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                  No persona avatars yet — create one in the Avatars tab to use this style.
                </div>
              )}
            </div>
          )}

          {/* Catalog v8 controls — Reference model + Fill intensity (color-aware lighting). Color class is auto-detected from product variant / title; user controls only the off-axis fill strength. */}
          {imgStyle === "product-catalog-v8" && (
            <div>
              <SectionLabel>Reference model</SectionLabel>
              {personas.filter((p) => p.reference_url).length > 0 ? (
                <Select
                  value={catalogAvatar || ""}
                  onChange={setCatalogAvatar}
                  options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                  renderOption={(opt) => `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
              ) : (
                <div style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>
                  No persona avatars yet — create one in the Avatars tab to use this style.
                </div>
              )}
              <SectionLabel style={{ marginTop: "0.75rem" }}>Fill intensity</SectionLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["light", "medium", "strong"].map((lvl) => (
                  <Pill key={lvl} active={v8FillIntensity === lvl} onClick={() => setV8FillIntensity(lvl)}>
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </Pill>
                ))}
              </div>
              <div style={{ fontSize: 11, color: TEXT_MID, marginTop: 6 }}>
                Off-axis fill strength for dark / solid color fabrics. Print/patterned products ignore this (flat lighting).
              </div>
            </div>
          )}

          {/* Scene — conditional on style, hidden for catalog styles */}
          {showSceneForStyle && !abMode && !isAnyCatalogStyle && (
            <div>
              <SectionLabel>Scene / environment</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SCENES.map((s) => (
                  <Pill key={s} active={scene === s} onClick={() => setScene(s)}>{s}</Pill>
                ))}
              </div>
            </div>
          )}

          {!isAnyCatalogStyle && (<>
          {/* ─── A/B TEST MODE ─── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "1.25rem" }}>
            <SectionLabel style={{ margin: 0, flex: 1 }}>A/B test mode</SectionLabel>
            <button onClick={() => setAbMode((p) => !p)} style={{
              width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
              background: abMode ? NEON : "rgba(255,255,255,0.1)",
              position: "relative", transition: "background 0.25s",
              boxShadow: abMode ? NEON_GLOW_SM : "none",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 3,
                left: abMode ? 23 : 3, transition: "left 0.25s cubic-bezier(0.4,0,0.2,1)",
              }} />
            </button>
          </div>

          {abMode && subject === "On model" && (
            <div style={{ display: "flex", gap: 12, marginTop: "1rem" }}>
              <ABVariantPanel
                label="Variant A" accent="neon"
                pose={modelPose} onPoseChange={setModelPose}
                scene={scene} onSceneChange={setScene}
                showScene={showSceneForStyle}
                style={imgStyle} onStyleChange={setImgStyle}
                allStyles={allStyles}
              />
              <ABVariantPanel
                label="Variant B" accent="cyan"
                pose={abPose} onPoseChange={setAbPose}
                scene={abScene} onSceneChange={setAbScene}
                showScene={showSceneForAb}
                style={abStyle} onStyleChange={setAbStyle}
                allStyles={allStyles}
              />
            </div>
          )}
          {abMode && subject !== "On model" && (
            <div style={{ padding: "16px", marginTop: "0.75rem", background: BG_SURFACE, borderRadius: 12, border: `1px solid rgba(255,255,255,0.03)`, color: TEXT_MID, fontSize: 13 }}>
              A/B test mode works with "On model" — switch subject to configure variants.
            </div>
          )}

          {/* Text + Count */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "end" }}>
            <div>
              <SectionLabel>Text in image</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["No text", "Auto", "Custom"].map((t) => (
                  <Pill key={t} active={textMode === t} onClick={() => setTextMode(t)}>{t}</Pill>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Count</SectionLabel>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4].map((n) => (
                  <NumBtn key={n} active={imgCount === n} onClick={() => setImgCount(n)}>{n}</NumBtn>
                ))}
              </div>
            </div>
          </div>

          {textMode === "Custom" && (
            <div style={{ marginTop: "0.75rem" }}>
              <input type="text" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Enter text overlay..." style={inputStyle} />
            </div>
          )}

          {/* Ratio */}
          <SectionLabel>Aspect ratio</SectionLabel>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            {IMG_RATIOS.map((r) => (
              <RatioBox key={r.label} {...r} active={imgRatio === r.label} onClick={() => setImgRatio(r.label)} />
            ))}
          </div>

          {/* Output resolution — Nano Banana models only */}
          {imgModel.startsWith("nano-banana") && (
            <>
              <SectionLabel>Resolution</SectionLabel>
              <div style={{ display: "flex", gap: 6 }}>
                {IMG_RESOLUTIONS.map((r) => (
                  <Pill key={r} active={imgResolution === r} onClick={() => setImgResolution(r)}>{r}</Pill>
                ))}
              </div>
            </>
          )}

          {/* Instructions */}
          <SectionLabel>Custom instructions</SectionLabel>
          <textarea value={imgInstructions} onChange={(e) => setImgInstructions(e.target.value)}
            placeholder="e.g. 'Show her walking in a park, autumn colors'"
            style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} />

          {/* Negative prompt — collapsible */}
          <button onClick={() => setShowNegPrompt((p) => !p)} style={{
            display: "flex", alignItems: "center", gap: 6, background: "transparent",
            border: "none", cursor: "pointer", padding: "0.5rem 0", marginTop: "0.25rem",
            color: showNegPrompt ? NEON_LIGHT : TEXT_MID, fontSize: 11, fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace",
            transition: "color 0.2s",
          }}>
            <span style={{ fontSize: 8, transform: showNegPrompt ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
            Negative prompt
            {negPrompt.trim() && !showNegPrompt && (
              <span style={{ fontSize: 10, color: NEON, fontWeight: 400, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>
                (active)
              </span>
            )}
          </button>
          {showNegPrompt && (
            <textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)}
              placeholder="e.g. 'no text, no watermark, no busy background, no hands cut off'"
              style={{ ...inputStyle, minHeight: 56, resize: "vertical", marginTop: 4 }} />
          )}
          </>)}

          {/* Count + (Ratio for v1 only) + Resolution for catalog styles (the big block above is hidden) */}
          {isAnyCatalogStyle && (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "end", marginTop: "1rem", flexWrap: "wrap" }}>
                <div>
                  <SectionLabel>Count</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <NumBtn key={n} active={imgCount === n} onClick={() => setImgCount(n)}>{n}</NumBtn>
                    ))}
                  </div>
                </div>
                {!isAnyCatalogStyle && (
                  <div>
                    <SectionLabel>Aspect ratio</SectionLabel>
                    <div style={{ display: "flex", gap: 10 }}>
                      {IMG_RATIOS.map((r) => (
                        <RatioBox key={r.label} {...r} active={imgRatio === r.label} onClick={() => setImgRatio(r.label)} />
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <SectionLabel>Resolution</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {IMG_RESOLUTIONS.map((r) => (
                      <Pill key={r} active={imgResolution === r} onClick={() => setImgResolution(r)}>{r}</Pill>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Cost + Generate */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: "1.25rem", padding: "14px 18px", background: BG_SURFACE,
            borderRadius: 12, border: `1px solid rgba(255,255,255,0.03)`,
          }}>
            <span style={{ fontSize: 13, color: TEXT_MID, fontFamily: "'DM Mono', monospace" }}>Est. cost</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {abMode && <span style={{ fontSize: 11, color: CYAN, fontFamily: "'DM Mono', monospace" }}>A/B ×2</span>}
              <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>${imgCost}</span>
            </div>
          </div>
          {isAnyCatalogStyle && !catalogAvatar && (
            <div style={{ fontSize: 11, color: TEXT_MID, marginTop: "1rem" }}>Select a reference model above to generate.</div>
          )}
          <button onClick={handleGenImage} disabled={generating || (isAnyCatalogStyle && !catalogAvatar)} style={{
            width: "100%", marginTop: (isAnyCatalogStyle && !catalogAvatar) ? "0.5rem" : "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: (isAnyCatalogStyle && !catalogAvatar)
              ? "rgba(255,255,255,0.08)"
              : abMode
              ? `linear-gradient(135deg, ${NEON} 0%, ${CYAN} 100%)`
              : `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: (isAnyCatalogStyle && !catalogAvatar) ? TEXT_MID : BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: (isAnyCatalogStyle && !catalogAvatar) ? "not-allowed" : "pointer", transition: "all 0.25s",
            boxShadow: (isAnyCatalogStyle && !catalogAvatar) ? "none" : NEON_GLOW_BTN,
          }}>
            {generating ? `Generating... ${completed}/${abMode ? imgCount * 2 : imgCount}` : abMode ? `Generate A/B test (${imgCount}× each)` : `Generate ${imgCount} ${styleName.toLowerCase()}${imgCount > 1 ? "s" : ""}`}
            <span style={{ marginLeft: 8, opacity: 0.5 }}>↗</span>
          </button>
        </div>
      )}

      {/* ═══ VIDEO TAB ═══ */}
      {tab === "video" && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          <SectionLabel style={{ marginTop: 0 }}>Prompt</SectionLabel>
          <textarea value={vidPrompt} onChange={(e) => setVidPrompt(e.target.value)}
            placeholder="A drone shot flying over a misty mountain range at sunrise, cinematic, 4K quality..."
            style={{ ...inputStyle, minHeight: 90, resize: "vertical", lineHeight: 1.6 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 16 }}>
            <div><SectionLabel>Provider</SectionLabel><Select value={vidProvider} onChange={setVidProvider} options={VID_PROVIDERS} /></div>
            <div><SectionLabel>Model</SectionLabel><Select value={vidModel} onChange={setVidModel} options={VID_MODELS} renderOption={(m) => `${m.label} — ${m.detail}`} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div><SectionLabel>Quality</SectionLabel><div style={{ display: "flex", gap: 6 }}>{QUALITIES.map((q) => (<Pill key={q} active={quality === q} onClick={() => setQuality(q)}>{q}</Pill>))}</div></div>
            <div><SectionLabel>Duration</SectionLabel><div style={{ display: "flex", gap: 6 }}>{DURATIONS.map((d) => (<Pill key={d} active={duration === d} onClick={() => setDuration(d)}>{d}</Pill>))}</div></div>
          </div>
          <SectionLabel>Aspect ratio</SectionLabel>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            {VID_RATIOS.map((r) => (<RatioBox key={r.label} {...r} active={vidRatio === r.label} onClick={() => setVidRatio(r.label)} />))}
          </div>
          <SectionLabel>Camera motion</SectionLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CAMERAS.map((c) => (<Pill key={c} active={camera === c} onClick={() => setCamera(c)}>{c}</Pill>))}
          </div>
          <SectionLabel>Guidance strength</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <input type="range" min={1} max={20} step={1} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} style={{ flex: 1, accentColor: NEON, height: 4 }} />
            <span style={{ minWidth: 28, textAlign: "right", fontSize: 15, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#fff" }}>{cfg}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.25rem", padding: "14px 18px", background: BG_SURFACE, borderRadius: 12, border: `1px solid rgba(255,255,255,0.03)` }}>
            <span style={{ fontSize: 13, color: TEXT_MID, fontFamily: "'DM Mono', monospace" }}>Est. cost</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>${vidCost}</span>
          </div>
          <button onClick={handleGenVideo} style={{
            width: "100%", marginTop: "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: "pointer", boxShadow: NEON_GLOW_BTN,
          }}>Generate video<span style={{ marginLeft: 8, opacity: 0.5 }}>↗</span></button>
        </div>
      )}

      {/* Summary chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "1.25rem" }}>
        {(tab === "image"
          ? [
              styleName,
              subject,
              ...(subject === "On model" ? [modelPose] : []),
              ...(showSceneForStyle && scene !== "Auto" ? [scene] : []),
              imgRatio,
              `${imgCount}×`,
              IMG_MODELS.find((m) => m.id === imgModel)?.label,
              ...(abMode ? ["A/B"] : []),
              ...(negPrompt.trim() ? ["neg. prompt"] : []),
            ]
          : [VID_MODELS.find((m) => m.id === vidModel)?.label, quality, duration, vidRatio, camera]
        ).filter(Boolean).map((chip, i) => (
          <span key={i} style={{
            padding: "4px 12px", background: chip === "A/B" ? CYAN_DIM : "rgba(255,255,255,0.03)",
            borderRadius: 999, fontSize: 12,
            color: chip === "A/B" ? CYAN : TEXT_MID,
            fontFamily: "'DM Mono', monospace",
            border: `1px solid ${chip === "A/B" ? CYAN_BORDER : "rgba(255,255,255,0.04)"}`,
            boxShadow: chip === "A/B" ? CYAN_GLOW_SM : "none",
          }}>{chip}</span>
        ))}
      </div>

      {showBuilder && <StyleBuilder storeId={storeId} onClose={() => setShowBuilder(false)} onCreated={(styleKey) => handleSaveCustomStyle({ id: styleKey, title: styleKey })} />}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        textarea:focus, input[type="text"]:focus, select:focus {
          border-color: ${NEON_BORDER} !important;
          box-shadow: ${NEON_GLOW_SM} !important;
          outline: none;
        }
        input[type="range"] {
          -webkit-appearance: none;
          background: rgba(255,255,255,0.06);
          border-radius: 4px; height: 4px; outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px; border-radius: 50%;
          background: ${NEON}; cursor: pointer;
          border: 2px solid ${BG_DEEP};
          box-shadow: ${NEON_GLOW_SM};
        }
        ::placeholder { color: rgba(255,255,255,0.18); }
        .cs-audience-tip:hover .cs-audience-tooltip { display: block !important; }
      `}</style>
    </div>
    </div>
  );
}

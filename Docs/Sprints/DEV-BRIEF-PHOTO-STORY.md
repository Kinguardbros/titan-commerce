# DEV BRIEF — Full Product Photo Story

> **Projekt:** Titan Commerce (multi-store SaaS dashboard)
> **Datum:** 2026-04-13
> **Prerekvizita:** Přečti si `CLAUDE.md` + `Docs/Architecture/ISOLA-MASTER-PROMPT-SYSTEM.md`

---

## Kontext

Máme detailní prompt system pro generování kompletní sady produktových fotek — "photo story". Místo generování fotek po jedné, uživatel klikne jedno tlačítko a systém vygeneruje celou sadu (7-8 fotek + color varianty) s konzistentním stylem.

**Prompt system definuje 8 typů fotek:**

| # | Typ | Účel | Priorita |
|---|-----|------|----------|
| 1 | Hero Shot | Thumbnail, první dojem | Must |
| 2 | Feature Callout | Infografický záběr (⏸️ nízká priorita) | Skip v1 |
| 3 | Lifestyle | Emocionální hook | Must |
| 4 | Detail / Focus | Tummy control důkaz | Must |
| 5 | Back View | Zadní pohled | Must |
| 6 | Side Profile | Silueta, shaping | Must |
| 7 | Material Close-up | Kvalita materiálu | Must |
| 8 | Before/After | Transformace (2 fotky) | Should |
| 9+ | Color Variants | Stejná póza jako Hero, jiná barva | Per color |
| Bonus | UGC | iPhone candid | Could |

**Klíčový princip:** Image 1 (Hero) je ANCHOR — definuje lighting, prostředí, model. Všechny ostatní fotky MUSÍ být konzistentní s Image 1.

---

## KRITICKÉ PRAVIDLO

**`lib/higgsfield.js` prompt logika je SACRED.** Nový feature MUSÍ používat existující `buildStyledPrompt()` / generovací pipeline — NE obcházet ho. Každá fotka v story se generuje jako samostatný API call s vlastním promptem, ale přes stejný `generateCreatives()` endpoint.

---

## Implementace

### 1. Backend — nová akce `generate_photo_story` v `lib/actions/creatives.js`

**POST Input:**
```json
{
  "store_id": "uuid",
  "product_id": "uuid",
  "hero_color": "rich midnight navy",
  "variant_colors": ["forest green", "dusty rose"],
  "ai_model": "fal_nano_banana",
  "aspect_ratio": "4:5",
  "include_ugc": false,
  "include_before_after": true,
  "skip_feature_callout": true
}
```

**Logika:**
1. Načíst produkt z DB (title, images, description, variants)
2. Načíst store brand knowledge (přes existující skill chain)
3. Sestavit pole promptů — každý typ fotky má svůj prompt template z `ISOLA-MASTER-PROMPT-SYSTEM.md`
4. Pro každý prompt zavolat existující generovací pipeline (`generateCreatives` API nebo přímý fal.ai call)
5. Vrátit pole job IDs / creative IDs

**Prompt templates** — uložit jako konstanty v novém souboru `lib/photo-story-prompts.js`:

```js
export const STORY_SHOTS = [
  {
    key: 'hero',
    label: 'Hero Shot',
    order: 1,
    buildPrompt: (product, heroColor) => `Three-quarter angle full body shot. Model positioned at 30-degree angle to camera, facing slightly left. Weight on right hip, creating natural S-curve silhouette. Arms relaxed at sides...
    
Swimsuit: ${product.title} in ${heroColor}.
${product.description ? `Product details: ${product.description}` : ''}

This is the ANCHOR image. All subsequent images must match this lighting exactly.`,
  },
  {
    key: 'lifestyle',
    label: 'Lifestyle',
    order: 3,
    buildPrompt: (product, heroColor) => `Full body shot, slightly wider framing. Model walking slowly toward camera at slight angle, one foot ahead of other, natural stride...

Swimsuit: ${product.title} in ${heroColor}.`,
  },
  // ... etc pro každý typ
];

export const COLOR_VARIANT_PROMPT = (product, color) => `Three-quarter angle full body shot. IDENTICAL POSE to Hero Shot — 30-degree angle to left, weight on right hip, relaxed arms. Model fills 70% of frame.

Swimsuit: ${product.title} in ${color}.
This image MUST look like it was shot in the same session as the Hero image.`;

export const UGC_PROMPT = (product, color) => `STYLE OVERRIDE — this image intentionally breaks the polished look:
Shot on iPhone 15 Pro. Slightly warm color cast. Natural daylight, not styled...

Swimsuit: ${product.title} in ${color}.`;
```

**DŮLEŽITÉ:** Prompt templates se NEPŘIDÁVAJÍ do `lib/higgsfield.js`. Zůstávají v separátním souboru. Generování probíhá přes existující API endpoint (`/api/creatives/generate`) — každá fotka je samostatný request s `custom_prompt` obsahujícím story prompt + `style: 'product_shot'` nebo `'lifestyle'` dle typu.

### 2. Frontend — `components/PhotoStoryModal.jsx` (~250 řádků) + CSS

Modal spouštěný z ProductWorkspace (tlačítko "📸 Full Photo Story").

**UI flow:**
```
┌─────────────────────────────────────────────┐
│  Full Product Photo Story              ✕    │
│  Generate a complete set of product photos  │
│                                             │
│  Hero color: [dropdown z variant barev]     │
│                                             │
│  Shots to generate:                         │
│  ✓ Hero Shot          ✓ Lifestyle           │
│  ✓ Detail / Focus     ✓ Back View           │
│  ✓ Side Profile       ✓ Material Close-up   │
│  ☐ Before/After       ☐ UGC                 │
│  ☐ Feature Callout (low priority)           │
│                                             │
│  Color variants: (additional hero per color)│
│  ✓ Forest Green       ✓ Dusty Rose          │
│  ☐ White                                    │
│                                             │
│  Model: [Nano Banana 2 ▼]                   │
│  Aspect ratio: [4:5]                        │
│                                             │
│  Total: 9 images  ~$1.26                    │
│                                             │
│  [Generate Full Story]                      │
│  [Cancel]                                   │
└─────────────────────────────────────────────┘
```

**Po spuštění:** Progress bar — "Generating 1/9: Hero Shot..."

**State:**
```js
const [heroColor, setHeroColor] = useState('');
const [variantColors, setVariantColors] = useState([]);
const [selectedShots, setSelectedShots] = useState(new Set(['hero', 'lifestyle', 'detail', 'back', 'profile', 'material']));
const [aiModel, setAiModel] = useState('fal_nano_banana');
const [aspectRatio, setAspectRatio] = useState('4:5');
const [generating, setGenerating] = useState(false);
const [progress, setProgress] = useState({ current: 0, total: 0, currentLabel: '' });
```

### 3. Frontend — integrace do ProductWorkspace.jsx

Přidat tlačítko vedle existujících [+ Image] a [▶ Video]:

```jsx
<button onClick={() => setShowPhotoStory(true)}>📸 Full Photo Story</button>
{showPhotoStory && (
  <PhotoStoryModal
    product={product}
    storeId={storeId}
    onClose={() => setShowPhotoStory(false)}
    onCompleted={() => { setShowPhotoStory(false); refreshCreatives(); }}
  />
)}
```

### 4. Frontend — API funkce v `lib/api.js`

```js
export function generatePhotoStory(storeId, productId, heroColor, variantColors, shots, aiModel, aspectRatio) {
  return fetchJSON('/api/system?action=generate_photo_story', {
    method: 'POST',
    body: JSON.stringify({
      store_id: storeId,
      product_id: productId,
      hero_color: heroColor,
      variant_colors: variantColors,
      shots,
      ai_model: aiModel,
      aspect_ratio: aspectRatio,
    }),
  });
}
```

### 5. Jak generovat fotky — 2 přístupy

**Přístup A: Sekvenční (doporučený pro v1)**
Backend `generate_photo_story` postupně volá `generateCreatives()` pro každou fotku. Vrací progress přes polling nebo WebSocket (Supabase Realtime na `creatives` tabulku — frontend už naslouchá).

```js
// V lib/actions/creatives.js:
export async function generate_photo_story(req, res) {
  const { store_id, product_id, hero_color, variant_colors = [], shots = [], ai_model, aspect_ratio } = req.body;
  
  // Load product
  const { data: product } = await supabase.from('products').select('*').eq('id', product_id).single();
  
  // Build shot list
  const shotList = STORY_SHOTS.filter(s => shots.includes(s.key));
  
  // Generate each shot
  const results = [];
  for (const shot of shotList) {
    const prompt = shot.buildPrompt(product, hero_color);
    // Call existing generate endpoint logic
    const creative = await generateSingleCreative({
      product_id, store_id, style: shot.suggestedStyle || 'product_shot',
      custom_prompt: prompt, ai_model, aspect_ratio, show_model: true,
    });
    results.push({ shot: shot.key, creative_id: creative.id });
  }
  
  // Color variants
  for (const color of variant_colors) {
    const prompt = COLOR_VARIANT_PROMPT(product, color);
    const creative = await generateSingleCreative({ ... });
    results.push({ shot: 'color_variant', color, creative_id: creative.id });
  }
  
  return res.status(200).json({ results, total: results.length });
}
```

**Přístup B: Fire-and-forget (pro budoucí optimalizaci)**
Backend spustí všechny generace paralelně a vrátí job IDs. Frontend sleduje přes Supabase Realtime.

**Pro v1 jdi s přístupem A** — jednodušší, spolehlivější, Vercel 60s timeout stačí na 2-3 fotky (zbytek přes polling).

### 6. Vercel timeout problém

60s timeout = max 2-3 generace per request. Řešení pro v1:

Frontend volá `generate_photo_story` s celým seznamem, ale backend generuje **jednu fotku** a vrací se. Frontend pak poluje stav a volá znovu pro další fotku:

```js
// Frontend polling pattern:
for (const shot of selectedShots) {
  setProgress({ current: i, total, currentLabel: shot.label });
  await generatePhotoStory(storeId, productId, heroColor, [], [shot.key], aiModel, aspectRatio);
  i++;
}
```

Nebo jednodušeji: frontend volá existující `generateCreatives()` pro každou fotku zvlášť s custom_prompt z photo story promptu. Žádná nová backend akce potřeba — jen frontend orchestrace.

---

## Doporučený přístup (nejjednodušší)

**Žádná nová backend akce.** Frontend orchestruje:

1. `PhotoStoryModal` sestaví seznam fotek k generování
2. Pro každou fotku zavolá existující `generateCreatives()` s:
   - `style: 'product_shot'` (nebo `'lifestyle'` pro lifestyle shot)
   - `custom_prompt`: prompt z `STORY_SHOTS[key].buildPrompt(product, heroColor)`
   - `show_model: true`
3. Frontend trackuje progress a zobrazuje "Generating 3/9: Back View..."
4. Supabase Realtime (už funguje) aktualizuje galerii

**Prompt templates** zůstanou jako JS konstanty v `PhotoStoryModal.jsx` nebo v separátním `lib/photo-story-prompts.js`.

---

## Soubory

| Soubor | Typ | Řádků |
|--------|-----|-------|
| `lib/photo-story-prompts.js` | Nový — prompt templates | ~200 |
| `components/PhotoStoryModal.jsx` | Nový — modal UI | ~250 |
| `components/PhotoStoryModal.css` | Nový — styly | ~80 |
| `pages/ProductWorkspace.jsx` | Upravit — přidat tlačítko + modal | ~10 |
| `lib/api.js` | Neměnit — použít existující `generateCreatives()` |  |

---

## Pořadí práce

1. `lib/photo-story-prompts.js` — extrahovat prompt templates z ISOLA-MASTER-PROMPT-SYSTEM.md
2. `PhotoStoryModal.jsx` + CSS — UI s výběrem shotů, barev, progress
3. Integrace do `ProductWorkspace.jsx` — tlačítko + modal
4. Test: vybrat produkt → Full Photo Story → generovat 3 fotky → ověřit konzistenci

---

## Definition of Done

- [ ] Tlačítko "📸 Full Photo Story" v ProductWorkspace
- [ ] Modal: výběr hero barvy z variant produktu
- [ ] Modal: checkboxy pro typy fotek (6 default ON, 3 optional)
- [ ] Modal: checkboxy pro color varianty
- [ ] Modal: model + aspect ratio výběr
- [ ] Modal: počet fotek + estimated cost
- [ ] Generování: sekvenční, s progress barem
- [ ] Každá fotka se uloží jako creative v DB (viditelná v galerii)
- [ ] Prompt templates obsahují `{product.title}` a `{heroColor}` substituce
- [ ] Existující generování (single photo) funguje beze změny
- [ ] `npm run build` projde

---

## Pravidla

- `lib/higgsfield.js` — NEDOTÝKAT SE. Prompty jdou přes `custom_prompt` parametr existujícího `generateCreatives()`
- Max 300 řádků per soubor
- Prompt templates z `ISOLA-MASTER-PROMPT-SYSTEM.md` — přepsat do JS, ne kopírovat raw markdown
- Barvy produktu parsovat z variant (existující pattern v CreativeStudio.jsx ř. 340-352)

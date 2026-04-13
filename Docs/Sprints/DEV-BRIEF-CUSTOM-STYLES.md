# DEV BRIEF — Custom Style Builder

> **Projekt:** Titan Commerce (multi-store SaaS dashboard)
> **Datum:** 2026-04-12
> **Prerekvizita:** Přečti si `CLAUDE.md` v rootu projektu — kompletní architektura, konvence, pravidla.

---

## Kontext

Uživatel chce vytvářet nové kreativní styly z referenčních fotek. Dnes existuje 8 pevných stylů (ad_creative, lifestyle, beach_photo...). Nový feature umožní:

1. Drag & drop referenční fotky (3-8 ks) NEBO paste URL konkurenta
2. Claude Vision analyzuje vizuální styl (lighting, composition, colors, posing, mood)
3. Vytvoří se nový "custom style" s prompt template
4. Style se objeví ve Studiu vedle existujících 8 stylů
5. Uživatel generuje kreativy pomocí custom stylu

**Nejedná se o nový produkt/brand** — jde o vizuální styl/scénu pro fotky (jako je dnes "Beach Photo" nebo "Clean Minimal").

---

## KRITICKÉ PRAVIDLO

**`lib/higgsfield.js` prompt logika je SACRED.** Existující styly a `buildStyledPrompt()` funkce se NESMÍ měnit. Povolena je POUZE chirurgická přidávací změna — early return pro custom style prefix `cs_` PŘED existujícím `STYLE_PROMPTS[style]` lookup na řádku 415. Diff ukázat vlastníkovi PŘED aplikací.

**`agents/scraper.md` se NEMĚNÍ.** Scraper je pro URL stránky. Pro vizuální analýzu fotek vytvoříme nový agent spec.

---

## Existující kód k využití

### Zárodek v CreativeStudio.jsx (řádky 453-474)
V `CreativeStudio.jsx` už existuje:
- `customStyles` state inicializovaný z localStorage (ř. 454-456)
- `showBuilder` state pro builder modal (ř. 453)
- `handleSaveCustomStyle()` callback (ř. 465-468)
- Custom styles se přidávají do "custom" kategorie v `STYLE_CATEGORIES` (ř. 470-474)

**Cíl:** Nahradit localStorage za Supabase backend. Stávající UI pattern zachovat a rozšířit.

### Drag & drop pattern (DocsBrowser.jsx)
- `fileToBase64()` (ř. 133-141) — FileReader → base64 encoding
- `handleDrop()` + `onDragOver` + visual feedback (ř. 218-222)
- Upload přes `uploadStoreDoc()` s base64 payload

### Claude Vision pattern (system.js, parse_size_chart_image akce)
- Base64 image → Claude Vision → structured output
- `{ type: 'image', source: { type: 'base64', media_type, data } }` message format
- Model: `claude-sonnet-4-20250514`

### Skill system (store_skills tabulka)
- `skill_type` + `store_id` + `content` (markdown) + `product_name` (null = store-level)
- `upsertSkill()` funkce v system.js (ř. 18-47) pro merge/create
- `loadSkillChain()` v higgsfield.js (ř. 301-326) pro načtení skillu + dependencies

### Scraper (lib/scraper-utils.js)
- `scrapeProduct(url)` → vrací `image_urls[]` (až 5 obrázků z product page)
- Parsuje: og:image, JSON-LD, Shopify CDN img tagy

---

## Implementace

### 1. SQL migration — `sql/add-custom-style-metadata.sql`

```sql
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS metadata JSONB;
```

Nový sloupec pro strukturovaná data (reference images, color palette) bez zahlcení `content` textového pole. Spustit v Supabase SQL Editor.

---

### 2. Agent spec — `agents/style-analyzer.md` (NOVÝ soubor)

Nový agent spec pro vizuální analýzu referenčních fotek. Formát jako existující `agents/scraper.md` (YAML frontmatter + markdown).

Obsah:
- **Role:** Analyzuje referenční fotky a extrahuje vizuální styl
- **Inputs:** 3-8 obrázků (base64 nebo URL)
- **Outputs:** JSON s `color_palette`, `lighting`, `composition`, `posing`, `setting`, `mood`, `camera_angle`, `prompt_template`
- **Rules:** Analyzovat kolektivně (ne per-photo), prompt template musí obsahovat `{product_name}` a `{price}` placeholders
- **Pipeline:** Nezávislý na SCRAPER pipeline. Feeds into Studio custom styles.

---

### 3. Backend — 5 nových akcí v `api/system.js`

Všechny akce přidat na konec GET/POST bloků v `handler()`. Celkem ~170 řádků.

#### 3a. `analyze_style` (POST)

**Input:**
```json
{
  "store_id": "uuid",
  "images": [{ "base64": "...", "media_type": "image/jpeg" }],
  "urls": ["https://..."]
}
```

**Logika:**
1. Pokud `urls` — fetch každou URL, převést na base64
2. Limit na 8 obrázků max, resize na max 1024px šířka (pokud možné)
3. Odeslat všechny obrázky do Claude Vision v jednom multi-image requestu:

```js
const imageBlocks = images.map(img => ({
  type: 'image',
  source: { type: 'base64', media_type: img.media_type, data: img.base64 }
}));

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2000,
  messages: [{
    role: 'user',
    content: [
      ...imageBlocks,
      {
        type: 'text',
        text: `Analyze these ${images.length} reference photos collectively and extract a unified visual style.

Return ONLY valid JSON:
{
  "style_name_suggestion": "short descriptive name (2-4 words)",
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "lighting": "description of lighting style",
  "composition": "how shots are composed, camera framing",
  "model_posing": "how models pose, body language, expression",
  "setting": "where photos are taken, background elements",
  "mood": "emotional feel, energy level",
  "camera_angle": "typical camera angle and distance",
  "distinguishing_features": "what makes this style unique vs generic fashion photography",
  "prompt_template": "A complete image generation prompt that would reproduce this exact visual style. Use {product_name} and {price} as placeholders. Be very specific about lighting, colors, composition, setting, model direction. The prompt should be 8-15 sentences long."
}`
      }
    ]
  }]
});
```

4. Parsovat JSON response, vrátit klientovi

**Output:**
```json
{
  "analysis": { ... parsed JSON },
  "image_count": 5
}
```

#### 3b. `create_custom_style` (POST)

**Input:**
```json
{
  "store_id": "uuid",
  "name": "Minimal Studio",
  "description": "Clean studio shots with soft shadows",
  "analysis": { ... z analyze_style },
  "reference_images": [{ "base64": "...", "media_type": "image/jpeg", "filename": "ref1.jpg" }]
}
```

**Logika:**
1. Generovat slug: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)`
2. Style key: `cs_${slug}`
3. Upload reference images do Supabase Storage:
   - Cesta: `{storeName}/Styles/{slug}/ref_{i}.jpg`
   - Buffer z base64, upsert: true
4. Získat public URLs uploadovaných obrázků
5. Build skill content:

```markdown
# Custom Style: {name}

{description}

## VISUAL ANALYSIS
- **Color palette:** {color_palette jako hex kódy}
- **Lighting:** {lighting}
- **Composition:** {composition}
- **Model direction:** {model_posing}
- **Setting:** {setting}
- **Mood:** {mood}
- **Camera:** {camera_angle}
- **Unique:** {distinguishing_features}

## PROMPT TEMPLATE
{prompt_template z analýzy}

## REFERENCE IMAGES
{bullet list of public URLs}
```

6. Upsert do `store_skills`:
   - `store_id`, `skill_type: 'custom-style-{slug}'`, `title: name`, `product_name: null`
   - `content`: markdown výše
   - `metadata`: `{ reference_images: [...urls], color_palette: [...], style_key: 'cs_{slug}' }`
7. Pipeline log: agent `STYLE_GEN`, message `"Created custom style: {name}"`, level `success`
8. Vrátit: `{ style_key: 'cs_{slug}', skill_id: uuid }`

#### 3c. `custom_styles` (GET)

**Input:** `?store_id=uuid`

**Logika:**
```js
const { data } = await supabase.from('store_skills')
  .select('id, skill_type, title, metadata, generated_at')
  .eq('store_id', storeId)
  .like('skill_type', 'custom-style-%')
  .is('product_name', null)
  .order('generated_at', { ascending: false });

return data.map(s => ({
  style_key: s.metadata?.style_key || `cs_${s.skill_type.replace('custom-style-', '')}`,
  name: s.title,
  color_palette: s.metadata?.color_palette || [],
  reference_images: s.metadata?.reference_images || [],
  created_at: s.generated_at,
}));
```

#### 3d. `delete_custom_style` (POST)

**Input:** `{ store_id, style_key }`

**Logika:**
1. Validovat `style_key.startsWith('cs_')`
2. Slug z `style_key.slice(3)`
3. Smazat ze `store_skills` where `skill_type = 'custom-style-{slug}'` and `store_id`
4. Smazat reference images z Storage: `{storeName}/Styles/{slug}/`
5. Pipeline log: agent `STYLE_GEN`, level `info`

#### 3e. `scrape_style` (POST)

**Input:** `{ url, store_id }`

**Logika:**
1. Zavolat existující `scrapeProduct(url)` z `lib/scraper-utils.js`
2. Získat `image_urls` z výsledku (max 8)
3. Fetch každou URL, převést na base64
4. Zavolat stejnou Claude Vision analýzu jako `analyze_style`
5. Vrátit: `{ analysis, images: [{ url, base64, media_type }] }`

---

### 4. Backend — chirurgická změna `lib/higgsfield.js` (~15 řádků)

**POZOR: Tato změna se dotýká sacred file. Ukázat diff vlastníkovi PŘED aplikací.**

#### Změna 1: Před řádek 415 (před `const builder = STYLE_PROMPTS[style]`)

Přidat early return pro custom styles:

```js
  // ─── Custom style: load prompt template from DB ───
  if (style.startsWith('cs_') && storeId) {
    const csSlug = style.slice(3);
    const { data: csSkill } = await supabaseHF.from('store_skills')
      .select('content, metadata')
      .eq('store_id', storeId)
      .eq('skill_type', `custom-style-${csSlug}`)
      .is('product_name', null)
      .single();
    if (csSkill?.content) {
      const tmplMatch = csSkill.content.match(/## PROMPT TEMPLATE\n([\s\S]*?)(?=\n## |$)/);
      const csTemplate = tmplMatch?.[1]?.trim();
      if (csTemplate) {
        let prompt = csTemplate
          .replace(/\{product_name\}/g, product_name)
          .replace(/\{price\}/g, price || '');
        if (custom_prompt) prompt += `\nAdditional instructions: ${custom_prompt}`;
        // Apply same post-processing as built-in styles (lines 418-441)
        if (!showModel) prompt += '\n\nIMPORTANT: Show ONLY the product itself. No person, no model, no mannequin. Clean product-only shot — the garment laid flat, on a hanger, or styled without a body.';
        if (textOverlay === 'none') prompt += '\n\nCRITICAL: Do NOT add ANY text, words, letters, numbers, watermarks, logos, branding, brand names, labels, badges, medallions, gold/bronze emblems, crests, decorative metal elements, hang tags, price tags, or typography anywhere in the image — not on the product, not on the background, not floating, not as accessories. The product must have ZERO visible branding or decorative elements that are not part of the original design. Absolutely NO badges or emblems of any kind. The image must be completely clean.';
        else if (textOverlay === 'custom' && overlayText) prompt += `\n\nADD TEXT OVERLAY on the image: "${overlayText}". Use clean, modern sans-serif font. White or gold text with subtle drop shadow for readability. Place the text in a visually balanced position.`;
        else if (textOverlay === 'auto') prompt += '\n\nADD a short, punchy advertising headline text overlay on the image. Generate a compelling 2-5 word headline. Use clean, modern sans-serif font, white or gold color with subtle drop shadow.';
        if (feedback) prompt += `\n${feedback}`;
        prompt = `PRODUCT REFERENCE: The attached image(s) show the EXACT product to recreate. Match precisely: same fabric pattern, same colors, same cut, same construction details, same ties/straps/buttons. This is the real product — do NOT invent a new design.\n\n${prompt}\n\nREMINDER: The product on the model/in the scene MUST be identical to the reference image(s). Same garment, same look, same details. If in doubt, prioritize product accuracy over scene aesthetics.`;
        return prompt;
      }
    }
  }
```

**Proč early return:** Custom style handler MUSÍ vrátit prompt PŘED řádkem 415, kde fallback `STYLE_PROMPTS[style] || STYLE_PROMPTS.ad_creative` by custom style key nerozpoznal a použil by default `ad_creative`.

**Proč duplikace post-processingu:** Post-processing (showModel, textOverlay, feedback, fidelity wrapper) je v řádcích 418-441 a aplikuje se na `prompt` proměnnou. Custom style handler musí aplikovat stejnou logiku, protože returnuje dříve. Alternativa (sdílená funkce) by vyžadovala refactor stávajícího kódu — to nechceme.

#### Změna 2: V skill chain loading (cca řádek 335)

V bloku kde se načítá `STYLE_TO_SKILL[style]` — přidat branch pro `cs_`:

```js
// Custom style skill chain
if (style.startsWith('cs_') && storeId) {
  const csSlug = style.slice(3);
  const chainContent = await loadSkillChain(storeId, `custom-style-${csSlug}`);
  if (chainContent) parts.push(chainContent);
}
```

---

### 5. Frontend — `components/StyleBuilder.jsx` (NOVÝ, ~250 řádků) + `StyleBuilder.css`

Modal komponent se dvěma taby.

#### Tab 1: Upload Photos
- Drag & drop zóna (pattern z DocsBrowser.jsx: `onDragOver`, `onDrop`, `handleDragEnter/Leave`)
- Accepts: `image/png, image/jpeg, image/webp`
- `fileToBase64()` pro každý soubor
- Thumbnaily nahraných obrázků (grid, max 8)
- Odstranění jednotlivých fotek (X button)
- "Analyze Style" button (disabled pokud < 3 fotek)

#### Tab 2: From URL
- Input field pro URL
- "Scrape Images" button → volá `scrapeStyle(url, storeId)`
- Zobrazí scraped obrázky s checkboxy (select/deselect)
- "Analyze Style" button

#### Po analýze — Preview Panel
- **Name:** text input (pre-filled z `analysis.style_name_suggestion`)
- **Description:** textarea (auto-generated summary, editovatelný)
- **Color palette:** inline swatche (kruhové boxy s hex barvami)
- **Atributy:** read-only grid: Lighting, Composition, Posing, Setting, Mood, Camera
- **Prompt template:** textarea (editovatelný, pre-filled z `analysis.prompt_template`)
- **Reference images:** thumbnail strip
- **"Create Style"** button → volá `createCustomStyle()` → `onCreated(styleKey)` callback
- **"Cancel"** button

#### State:
```js
const [tab, setTab] = useState('upload');
const [images, setImages] = useState([]);          // { base64, media_type, preview_url, filename }
const [url, setUrl] = useState('');
const [scrapedImages, setScrapedImages] = useState([]);
const [analyzing, setAnalyzing] = useState(false);
const [analysis, setAnalysis] = useState(null);
const [styleName, setStyleName] = useState('');
const [styleDesc, setStyleDesc] = useState('');
const [promptTemplate, setPromptTemplate] = useState('');
const [creating, setCreating] = useState(false);
```

---

### 6. Frontend — integrace do `GeneratePanel.jsx` (~30 řádků)

Přidat load custom styles a appendnout do STYLES array:

```js
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
```

V renderingu přidat třetí skupinu `'Custom Styles'` vedle `'Custom'` a `'Static Templates'`.

Důležité: `STYLES_WITH_MODEL` (řádek 5) — custom styles by default MĚLY ukazovat model. Přidat:
```js
const stylesWithModel = useMemo(() => [
  ...STYLES_WITH_MODEL,
  ...customStyles.map(cs => cs.style_key),
], [customStyles]);
```

---

### 7. Frontend — integrace do `Studio.jsx` (~15 řádků)

Přidat `STYLE_OPTIONS` rozšíření o custom styles (pro filter bar):
```js
const [customStyles, setCustomStyles] = useState([]);
useEffect(() => {
  if (!storeId) return;
  getCustomStyles(storeId).then(setCustomStyles).catch(() => {});
}, [storeId]);

const allStyleOptions = useMemo(() => [
  ...STYLE_OPTIONS,
  ...customStyles.map(cs => ({ key: cs.style_key, label: cs.name })),
], [customStyles]);
```

Přidat "+ Custom Style" button + `StyleBuilder` modal mount:
```jsx
<button onClick={() => setShowStyleBuilder(true)}>+ Custom Style</button>
{showStyleBuilder && (
  <StyleBuilder storeId={storeId} storeName={store?.name}
    onClose={() => setShowStyleBuilder(false)}
    onCreated={() => { setShowStyleBuilder(false); toast.success('Style created!'); /* refresh */ }}
  />
)}
```

---

### 8. Frontend — integrace do `CreativeStudio.jsx` (~15 řádků)

Nahradit localStorage za backend:
- Řádek 454-456: místo `localStorage.getItem('cs_custom_styles')` → `getCustomStyles(storeId)`
- Řádek 465-468: `handleSaveCustomStyle` → volat `createCustomStyle()` API, pak refresh

---

### 9. Frontend — API funkce v `lib/api.js` (~25 řádků)

```js
export function analyzeStyle(storeId, images = [], urls = []) {
  return fetchJSON('/api/system?action=analyze_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, images, urls }),
  });
}

export function createCustomStyle(storeId, name, description, analysis, referenceImages = []) {
  return fetchJSON('/api/system?action=create_custom_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, name, description, analysis, reference_images: referenceImages }),
  });
}

export function getCustomStyles(storeId) {
  return fetchJSON(`/api/system?action=custom_styles&store_id=${storeId}`);
}

export function deleteCustomStyle(storeId, styleKey) {
  return fetchJSON('/api/system?action=delete_custom_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, style_key: styleKey }),
  });
}

export function scrapeStyle(url, storeId) {
  return fetchJSON('/api/system?action=scrape_style', {
    method: 'POST',
    body: JSON.stringify({ url, store_id: storeId }),
  });
}
```

---

## Pořadí práce (doporučené)

1. **SQL migration** — `ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS metadata JSONB` (5 min)
2. **`agents/style-analyzer.md`** — nový agent spec (30 min)
3. **`lib/api.js`** — 5 nových API funkcí (15 min)
4. **`api/system.js`** — backend akce: `analyze_style`, `create_custom_style`, `custom_styles`, `delete_custom_style`, `scrape_style` (1 den)
5. **`lib/higgsfield.js`** — custom style loader, **UKÁZAT DIFF VLASTNÍKOVI** (1-2 hod)
6. **`StyleBuilder.jsx` + CSS** — nový komponent (1 den)
7. **`GeneratePanel.jsx`** — custom styles integrace (2-3 hod)
8. **`Studio.jsx`** — button + modal + filter (1 hod)
9. **`CreativeStudio.jsx`** — nahradit localStorage za backend (30 min)
10. **E2E test** — upload fotek → analyze → create → generovat kreativu s custom stylem

---

## Definition of Done

- [ ] Upload 5 referenčních fotek → Claude Vision vrátí analýzu s prompt template
- [ ] Uživatel pojmenuje styl a vidí preview (palette, atributy, prompt)
- [ ] Custom style se uloží do `store_skills` s `skill_type='custom-style-{slug}'`
- [ ] Reference images se uloží do Supabase Storage `{storeName}/Styles/{slug}/`
- [ ] Custom style se objeví v GeneratePanel vedle existujících 8 stylů
- [ ] Custom style se objeví ve Studio STYLE_OPTIONS filtru
- [ ] Generování kreativy s custom stylem produkuje vizuálně odpovídající výstup
- [ ] **Existujících 8 stylů funguje BEZE ZMĚNY** (regression test)
- [ ] Mathilda + Elara speciální prompty fungují beze změny
- [ ] Scrape URL → analyze style flow funguje
- [ ] Smazání custom stylu odstraní skill + reference images
- [ ] Custom styles jsou per-store (Isola nevidí Elegance House styles)
- [ ] `npm run build` projde
- [ ] `npm test` projde

---

## Pravidla (z CLAUDE.md)

- Max 300 řádků per soubor — `StyleBuilder.jsx` může být max 300, případně extrahovat sub-komponenty
- `catch (e) {}` zakázáno — vždy loguj
- `npm install` vždy s `--legacy-peer-deps`
- Structured logging: `console.error('[Module] Description:', { key: value })`
- Po dokončení aktualizuj CLAUDE.md (nový komponent, nové akce, nový agent)
- `agents/scraper.md` se NEMĚNÍ

---

## Rizika

- **higgsfield.js:** Early return pro `cs_` prefix je chirurgický zásah (~15 řádků). Post-processing (showModel, textOverlay, feedback, fidelity) se musí zduplikovat v custom style bloku, protože return je před řádkem 418. Ukázat diff Danovi.
- **Claude Vision s 8 obrázky:** Pomalé (15-30s), drahé (~$0.50-1.00). Mitigace: resize na 1024px, progress indicator, cache analýzy v metadata JSONB.
- **Prompt template kvalita:** AI-generovaný template nemusí být perfektní. Proto je editovatelný v UI — uživatel může upravit před uložením.
- **system.js roste:** +170 řádků → ~1770 celkem. Modularizace je plánovaná ve Sprint 2.
- **CreativeStudio.jsx (989 ř.):** Přidáváme jen ~15 řádků (nahrazení localStorage). Velký refactor je plánovaný později.

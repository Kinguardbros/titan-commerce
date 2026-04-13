# DEV BRIEF — Photo Story Reference-based Model Consistency

> **Projekt:** Titan Commerce
> **Datum:** 2026-04-13
> **Prerekvizita:** Přečti si `CLAUDE.md`

---

## Kontext

Photo Story generuje 7+ fotek paralelně, ale AI generátor nemá memory mezi requesty → každý shot má jinou ženu. Prompt instrukce "SAME MODEL" pomáhají ale nejsou spolehlivé.

**Řešení:** Vygenerovat hero shot PRVNÍ → jeho output URL předat jako reference image do všech dalších shotů. fal.ai Nano Banana a Flux Kontext už podporují reference images — hero shot se stane vizuální "kotva" pro konzistenci modelu.

**Cena:** Beze změny — reference image je parametr, ne extra generace.
**Rychlost:** Hero sekvenční (první), zbytek paralelní. +15-20s.

---

## Implementace

### 1. Backend — `api/creatives/generate.js`

**Přidat `reference_url` parametr (3 řádky):**

Řádek 48 — přidat do destructuringu:
```js
const { ..., reference_url } = req.body;
```

Řádek 65 — po parsování product images, přidat reference na ZAČÁTEK:
```js
let images = JSON.parse(product.images || '[]');
if (reference_url) {
  images = [reference_url, ...images];
}
```

Tím hero shot URL bude PRVNÍ reference image pro fal.ai. Model na hero shotu definuje jak žena vypadá → fal.ai ji přenese do dalších shotů.

### 2. Frontend — `apps/dashboard/src/lib/api.js`

Řádek 78 — přidat `reference_url` do params:
```js
export function generateCreatives({ ..., reference_url }) {
  return fetchJSON('/api/creatives/generate', {
    method: 'POST',
    body: JSON.stringify({ ..., reference_url }),
  });
}
```

### 3. Frontend — `apps/dashboard/src/components/PhotoStoryModal.jsx`

Změnit generovací flow z "vše paralelně" na "hero first → zbytek paralelně s referencí":

```js
// 1. Hero shot FIRST (sequential)
const heroShot = shots.find(s => s.key === 'hero');
const otherShots = shots.filter(s => s.key !== 'hero');
let heroUrl = null;

if (heroShot) {
  setProgress({ current: 0, total, label: 'Hero Shot (anchor)...' });
  try {
    const result = await generateCreatives({
      product_id: product.id, store_id: storeId, style: heroShot.suggestedStyle,
      custom_prompt: heroShot.buildPrompt(product, heroColor) + sceneCtx,
      show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
      audience: audienceCtx, story_id: storyId, story_shot: 'hero',
    });
    heroUrl = result?.file_url || null;
    completed++;
  } catch (err) {
    console.error('[PhotoStory] Hero failed:', err);
    toast.error('Hero shot failed');
  }
}

// 2. Remaining shots PARALLEL with hero reference
const remainingJobs = [
  ...otherShots.map(shot => ({
    label: shot.label,
    fn: () => generateCreatives({
      product_id: product.id, store_id: storeId, style: shot.suggestedStyle,
      custom_prompt: shot.buildPrompt(product, heroColor) + sceneCtx,
      show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
      audience: audienceCtx, story_id: storyId, story_shot: shot.key,
      reference_url: heroUrl,  // ← hero as reference
    }),
  })),
  ...[...variantColors].map(color => ({
    label: `Color: ${color}`,
    fn: () => generateCreatives({
      product_id: product.id, store_id: storeId, style: 'product_shot',
      custom_prompt: buildColorVariantPrompt(product, color) + sceneCtx,
      show_model: true, text_overlay: 'none', ai_model: aiModel, aspect_ratio: aspectRatio,
      audience: audienceCtx, story_id: storyId, story_shot: `color_${color.toLowerCase().replace(/\s+/g, '-')}`,
      reference_url: heroUrl,
    }),
  })),
];

// Batch parallel (max 5)
for (let i = 0; i < remainingJobs.length; i += BATCH) {
  const batch = remainingJobs.slice(i, i + BATCH);
  setProgress({ current: completed, total, label: batch.map(j => j.label).join(', ') });
  const results = await Promise.allSettled(batch.map(j => j.fn()));
  // ... error handling same as before
  completed += batch.length;
}
```

### 4. Frontend — `apps/dashboard/src/lib/photo-story-prompts.js`

Přidat do `MODEL_CONSISTENCY` konstanty reference instrukci:

```js
const MODEL_CONSISTENCY = `\n\nCRITICAL MODEL CONSISTENCY: The FIRST reference image shows the EXACT model to use — match her face, hair color and style, skin tone, body type, and age PRECISELY. She must be recognizable as the same person. Do NOT change the model.`;
```

---

## Pořadí práce

1. `api/creatives/generate.js` — přidat `reference_url` (3 řádky)
2. `lib/api.js` — přidat `reference_url` do params (1 řádek)
3. `photo-story-prompts.js` — update MODEL_CONSISTENCY (1 řádek)
4. `PhotoStoryModal.jsx` — hero-first flow (přepsat generovací blok)
5. Test: vygenerovat story, ověřit že hero jde první a zbytek má referenci

---

## Definition of Done

- [ ] Hero shot se generuje PRVNÍ (sekvenčně, progress: "Hero Shot (anchor)...")
- [ ] Po hero: `file_url` z response se předá jako `reference_url` dalším shotům
- [ ] Další shoty generovány paralelně (batch 5) s `reference_url`
- [ ] Backend: `reference_url` se přidá na začátek images array
- [ ] Model na dalších shotech vizuálně odpovídá hero (tvář, vlasy, postava)
- [ ] `npm run build` projde
- [ ] Fallback: pokud hero selže, zbytek se generuje bez reference (graceful degradation)

---

## Pravidla

- `lib/higgsfield.js` — NEDOTÝKAT SE
- `api/creatives/generate.js` — jen přidat `reference_url` handling, neměnit existující logiku
- Pokud hero shot nemá `file_url` v response (error), pokračovat bez reference (ne blokovat celou story)

# BRIEF: Product Catalog v3 — Beach Background Presets (sjednocené pozadí)

> **Status:** Příprava / brief, ne k okamžité implementaci · **Datum:** 2026-05-13

## Context

Stávající v3 step 2 generuje pozadí pláže přes `fal-ai/ideogram/v3/replace-background` z textového promptu (`buildV3BeachPrompt(sceneKey)` v `lib/v3-beach-scenes.js`). Důsledek: každá generace s "Bright sunny" presetem dostane **jinou** pláž — Ideogram pozadí pokaždé vygeneruje znovu z textu, takže výsledky nejsou vizuálně konzistentní napříč generacemi ani napříč produkty. To rozbíjí "katalogový" pocit (e-commerce katalog má mít sjednocené prostředí).

**Cíl:** Pro každou ze 4 scén (sunny / golden / dune / cove) vygenerovat **jednu master plážovou fotku** uloženou v DB + Supabase Storage. Tu master pláž pak step 2 použije jako referenční obrázek a Nano Banana **složí** modelku z kroku 1 (studiovka) s tím fixním pozadím přes sandwich pattern `[master_bg, studio_shot, master_bg]`. Výsledek: stejná pláž pokaždé pro daný preset → konzistence napříč produkty. Bonus: ve Studiu vidíme **thumbnail** každého presetu, takže uživatel ví, co dostane.

## Rozhodnutí (z brainstormingu)

- **Mechanika step 2:** Nano Banana Pro sandwich `[master_bg, studio_shot, master_bg]` (osvědčený pattern, používáme u avatarů ve v1/v2). NE Ideogram replace-background (ten neumí 2 image inputs + dělá pokaždé jinou pláž z textu).
- **Generace master pláží:** admin tlačítko v UI "Generate beach presets" (ne CLI skript, ne on-demand) — uživatel je může kdykoli regenerovat, pokud chce jiný vzhled.
- **UI:** pod každou Beach scene pilou ve Studiu thumbnail master pláže (~60×60 px). Když uživatel klikne na presetu, vidí ji.
- **Per-store:** každý store má vlastní 4 master pláže (Isola může chtít jiné pláže než jiný store) — řízeno přes `store_id` FK, jako `persona_avatars`.

## Komponenty (co bude potřeba postavit)

### 1. Databáze — nová tabulka `v3_beach_presets`

Analogie `persona_avatars` (sql/add-persona-avatars.sql). Nová migrace `sql/add-v3-beach-presets.sql`:

```sql
CREATE TABLE IF NOT EXISTS v3_beach_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  scene_key TEXT NOT NULL,  -- 'sunny' | 'golden' | 'dune' | 'cove'
  label TEXT,                -- 'Bright sunny' etc.
  preview_url TEXT NOT NULL, -- malý thumbnail (~256px) pro UI
  full_url TEXT NOT NULL,    -- plné rozlišení (4:5, 2K) pro sandwich
  generated_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}',  -- fal.ai request_id, prompt použitý při generaci, atd.
  UNIQUE(store_id, scene_key)
);
CREATE INDEX IF NOT EXISTS idx_v3_beach_presets_store ON v3_beach_presets(store_id);
```

### 2. Nový soubor `lib/v3-beach-scenes.js` — rozšířit o standalone prompty

Vedle stávajícího `buildV3BeachPrompt(sceneKey)` (= prompt pro Ideogram BG, který má v textu "model stays exactly as she is" — pro generaci master pláže bez modelky se nehodí) přidat:

```js
export function buildStandaloneBeachPrompt(sceneKey) {
  // Plážová scéna BEZ modelky — pro generaci master backgroundu jednou,
  // později se na ni přes sandwich slepí modelka z kroku 1.
  const STANDALONE = {
    sunny: 'Empty sandy beach landscape, no people: ocean with gentle waves, soft dry sand with a few dune grasses, low dune line, bright blue sky with a few soft white clouds, light haze at the horizon. Bright natural daylight from the front. Photographic, 4:5 vertical, ultra-sharp, 8K, true-to-life colors, full tonal range, NOT blown out, NOT washed out. NEGATIVE: people, person, model, woman, figure, silhouette, text, watermark.',
    golden: '...',  // analogicky
    dune: '...',
    cove: '...',
  };
  return STANDALONE[sceneKey] || STANDALONE.sunny;
}

export function buildV3SandwichPrompt(sceneKey) {
  // Prompt pro Nano Banana sandwich [master_bg, studio_shot, master_bg]:
  // "vezmi modelku z prostředního obrázku a umísti ji na pláž z 1. a 3."
  return `Reference images: image 1 AND the last image = THE BEACH BACKGROUND (the SAME scene, twice). The middle image = THE MODEL (a woman in a swimsuit standing in a clean studio). TASK: Composite the model from the middle image onto the beach background from images 1 and 3. Keep her EXACTLY as she is — her face, hair, body, pose, the swimsuit, and the lighting on her are unchanged. Only the background changes from studio to beach. The model stays tack sharp; the beach background is softly out of focus (shallow depth of field). The compositing must be photographic and natural — match the model's existing studio lighting to the beach scene, but do NOT relight her or change her exposure. Vertical 4:5. NEGATIVE: changed face, changed pose, changed swimsuit, changed lighting on the model, harsh shadow on the model, side-lit shadow, dark side of body, model relight, overexposed model, blown-out model, doubled model, two women, text, watermark.`;
}
```

### 3. Nový backend action `generate_beach_preset` v `lib/actions/v3-beach-presets.js`

Mirror `generate_avatar` v `lib/actions/avatars.js`. Vstup: `{ store_id, scene_key }`. Tělo:
1. Validace `store_id`, `scene_key ∈ {sunny,golden,dune,cove}`.
2. Vygenerovat plážovou fotku přes `submitFalJob({ model: 'fal-ai/nano-banana-2', prompt: buildStandaloneBeachPrompt(scene_key), imageUrl: [], numImages: 1, aspectRatio: '4:5', resolution: '2K' })`. (Pozn.: model bez `/edit` — text-to-image pro pure generaci. Jestli `fal-ai/nano-banana-2` netokuje bez reference, alternativa `fal-ai/flux/schnell` nebo `fal-ai/ideogram/v3` text-to-image.) Polling 55s sync (přes `generateFal` ne `submitFalJob` — pro single-shot generaci nepotřebujeme fire-and-forget).
3. Download z fal.ai → upload do `creatives` Storage bucketu: cesta `v3-beach-presets/<store_slug>/master_<scene>_<timestamp>.jpg`. Plus zmenšená preview verze (~256px) cesta `v3-beach-presets/<store_slug>/preview_<scene>_<timestamp>.jpg`. (Použít `sharp` — už máme z avatar-crop.)
4. `getPublicUrl` pro oba.
5. Upsert do `v3_beach_presets`: `UPSERT (store_id, scene_key) → preview_url, full_url, metadata: {request_id, prompt, generated_at}`.
6. `pipeline_log` insert: agent `BEACH_PRESETS`, "Generated beach preset {scene_key} for store {storeName}".
7. Return `{ scene_key, preview_url, full_url }`.

Druhá akce — `list_beach_presets` (GET): vrátí všechny presety pro `store_id` (pole 4 objektů). Frontend UI a backend chain to čtou.

### 4. Registrace v `api/system.js`

```js
import { generate_beach_preset, list_beach_presets } from '../lib/actions/v3-beach-presets.js';
// GET_ACTIONS: ..., list_beach_presets
// POST_ACTIONS: ..., generate_beach_preset
```

### 5. Frontend API v `apps/dashboard/src/lib/api.js`

```js
export function getBeachPresets(storeId) {
  return fetchJSON(`/api/system?action=list_beach_presets&store_id=${storeId}`);
}
export function generateBeachPreset(storeId, sceneKey) {
  return fetchJSON('/api/system?action=generate_beach_preset', {
    method: 'POST', body: JSON.stringify({ store_id: storeId, scene_key: sceneKey }),
  });
}
```

### 6. Frontend UI v `CreativeStudio.jsx`

**A. State + load**: `useState(beachPresets, setBeachPresets) = []`. V `useEffect` na změnu `storeId` → `getBeachPresets(storeId)` → setState. Mapa scene_key → preview_url + full_url.

**B. Thumbnaily pod Beach scene pily** (~ř. 958-965): rozšířit map o `<img>` nad/pod každou pilou. Když preset chybí v DB pro daný `scene_key` → ukázat placeholder (šedý box "Not generated yet").

**C. Tlačítko "Manage presets"** — collapsible panel hned nad/vedle Beach scene pily (jen pro v3): seznam 4 scén s thumbnaily + tlačítko `[Generate]` / `[Regenerate]` u každé. Klik → `generateBeachPreset(storeId, sceneKey)` → progress indicator → po dokončení reload `beachPresets`. Generace ~30-60s na scénu.

**D. v3 customInstr** beze změny — pořád posílá `[catalog_beach:${catalogBeach}]`.

### 7. Backend chain v `lib/actions/creatives.js` (`poll_generations`) — přepsat step 2

Stávající (~ř. 268-286, `if (c.style === 'product_catalog_v3' && meta.stage === 'studio' && !meta.v3_failed)`):
```js
const bgPrompt = buildV3BeachPrompt(meta.v3_beach_scene);
const job2 = await submitFalJob({ model: 'fal-ai/ideogram/v3/replace-background', prompt: bgPrompt, imageUrl: [result.url], aspectRatio: meta.v3_aspect || '4:5' });
```

Nově:
```js
// Look up the master beach preset for this store + scene.
const { data: preset } = await supabase.from('v3_beach_presets')
  .select('full_url')
  .eq('store_id', c.store_id).eq('scene_key', meta.v3_beach_scene)
  .single();
if (!preset?.full_url) {
  // No preset for this store yet → fall back to keeping the studio shot
  console.warn('[poll_generations] v3 no beach preset for', c.store_id, meta.v3_beach_scene, '— keeping studio shot');
  await supabase.from('creatives').update({ status: 'pending', file_url: result.url, ..., metadata: { ...meta, v3_error: 'no beach preset configured', v3_failed: true } }).eq('id', c.id);
  completed++; continue;
}
const sandwichPrompt = buildV3SandwichPrompt(meta.v3_beach_scene);
const job2 = await submitFalJob({
  model: 'fal-ai/nano-banana-pro/edit',
  prompt: sandwichPrompt,
  imageUrl: [preset.full_url, result.url, preset.full_url],  // sandwich
  aspectRatio: meta.v3_aspect || '4:5',
  resolution: '2K',
});
await supabase.from('creatives').update({
  hf_job_id: job2.requestId,
  metadata: { ...meta, stage: 'beach', poll_base: job2.pollBase, submitted_at: new Date().toISOString(), model: 'fal-ai/nano-banana-pro/edit', studio_url: result.url, beach_preset_url: preset.full_url, retry_count: 0 },
}).eq('id', c.id);
```

Plus fallback "no beach preset configured" → studiovka jako výsledek (jako u Ideogram failure dnes).

### 8. Jak vyřadit Ideogram BG cestu (cleanup)

Po implementaci sandwiche přes Nano Banana můžeme:
- **(a)** `lib/v3-beach-scenes.js` `buildV3BeachPrompt` (ten staré Ideogram-style prompt) ponechat zachycený, ale nevolaný — neuškodí.
- **(b)** Smazat `buildV3BeachPrompt`, `lib/fal.js` `pollBase` regex pro Ideogram (`/^fal-ai\/(nano-banana|flux)/` zůstává, `replace-background` už není relevantní), `FAL_MODEL_MAP[fal_ideogram_bg]` zůstává v `generate.js` pro případ že chce uživatel "BG Swap" ručně přes Studio model picker — to není v3 fíčura.
- Doporučuju **(a)** v prvním kole, **(b)** v druhém po ověření.

## Kritické soubory (přehled)

- Nový: `sql/add-v3-beach-presets.sql`
- Nový: `lib/actions/v3-beach-presets.js`
- Mod: `lib/v3-beach-scenes.js` (přidat `buildStandaloneBeachPrompt`, `buildV3SandwichPrompt`)
- Mod: `lib/actions/creatives.js` (přepsat v3 chain step 2)
- Mod: `api/system.js` (registrace 2 nových akcí)
- Mod: `apps/dashboard/src/lib/api.js` (`getBeachPresets`, `generateBeachPreset`)
- Mod: `apps/dashboard/src/components/CreativeStudio.jsx` (thumbnaily, "Manage presets" panel, beachPresets state)

## Verifikace (po implementaci)

1. `node --check` na všech upravených JS souborech → exit 0
2. `npm test` → 27/27 pass
3. `cd apps/dashboard && npm run build` → projde
4. SQL migrace: `psql ... -f sql/add-v3-beach-presets.sql` (nebo Supabase SQL editor) → tabulka existuje
5. Manuální (po deployi):
   - Studio → vybrat Isola produkt → Product Catalog v3 → expand "Manage presets" → klik [Generate] u "Bright sunny" → po ~30-60s vidět thumbnail. Opakovat pro Golden / Dune / Cove.
   - Pak normální generace v3 s Bright sunny → výstup má **stejnou pláž** jako master, modelka složena přes sandwich, identita drží, produkt na rovnoměrném studio světle (krok 1) + ta pláž (krok 2). 4:5.
   - Druhá generace stejného presetu → opět stejná pláž (deterministické).
   - Kontrola DB: `SELECT scene_key, preview_url, full_url FROM v3_beach_presets WHERE store_id = ...;` → 4 řádky.

## Riziková místa / nevyřešené detaily

- **Nano Banana sandwich s plážovým pozadím** — funguje s avatarem (modelka × produkt), ale neoznámené pro "pozadí × subjekt". Pokud Nano Banana model neudělá kompozici dobře (např. relightne subjekt, nepřeloží světlo přirozeně), fallback: zkusit `fal-ai/flux-2/edit` se 2 image inputs (umí víc image inputs) + prompt. Doladění až po prvních testech.
- **Standalone generation modelu** — `fal-ai/nano-banana-2` bez `/edit` může nevyžadovat reference, ale neověřeno. Alternativa: `fal-ai/ideogram/v3` (bez `/replace-background`) jako čistá text-to-image, nebo `fal-ai/flux/schnell` (rychlé, levné).
- **Per-store seeding** — když uživatel poprvé otevře Studio v3 v storu bez presetů, UI musí ukázat hláčku "Generate beach presets first". Nebo auto-trigger generace (UX otázka, ne nutně nutné).
- **Thumbnaily rozměr** — sharp resize na 256×256 / 256×320? Ladění UX.

## Log

- **2026-05-13:** Brief sepsán po brainstormu (mechanika step 2 = Nano Banana sandwich, generace = admin UI tlačítko, UI = thumbnail pod každou pilou, per-store presety). Není zatím k implementaci — sjednoceno jako příprava. Aktuální stav v3 step 2 = Ideogram replace-background z text promptu (variabilní pozadí každou generaci) zůstává funkční, brief popisuje cílový stav.

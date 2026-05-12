# Spec: Product Catalog v3 — "double pipeline" (clean studio shot → beach background)

> Datum: 2026-05-12 · Status: schváleno k implementaci · Scope: `api/creatives/generate.js` + `lib/actions/creatives.js` (`poll_generations` chain) + `apps/dashboard/src/components/CreativeStudio.jsx` + nový `lib/v3-beach-scenes.js` · NEsahá na v1, v2, Realistic Beach, PhotoStory

## Context — proč to děláme

v1 a v2 generují plážovou fotku **v jednom kroku** — model Nano Banana musí současně vyřešit produkt + slunce + stíny + pláž, a opakovaně to vede k tmavému / přepálenému produktu nebo bočnímu stínu (12+ iterací). **Pilíř V3:** vygenerovat produkt nejdřív v **kontrolovaném studiu** — bílé seamless pozadí, ploché rovnoměrné softbox světlo ze všech stran, žádná scéna → model nemá žádné konkurující signály a produkt je nasvícený dokonale a rovnoměrně. **Pak** se na tu hotovou studiovku přes `fal-ai/ideogram/v3/replace-background` nasadí pláž — mění se JEN pozadí, produkt/póza/modelka/nasvícení produktu zůstávají beze změny.

**Cíl:** Nový styl "Product Catalog v3" ve Studiu. Uživatel klikne jednou "Generate" → backend udělá krok 1 (studiovka, Nano Banana Pro), `poll_generations` po dokončení automaticky submitne krok 2 (Ideogram BG, beach scene jako bg prompt), uživatel vidí jen **finální plážovou fotku** (studiovka je interní mezikrok). Když krok 2 selže → creative zůstane na studiovce (aspoň čistá studiovka). UI v3: Reference model (avatar, povinný) / Pose / Beach scene / Resolution / Count. v1, v2, Realistic Beach, PhotoStory beze změny.

## Rozhodnutí (z brainstormingu)
- **Plně automatický 2-krokový pipeline**, jeden styl "Product Catalog v3", jedna creative row po celou dobu (`status='generating'` napříč oběma kroky → po kroku 2 flip na `pending` s finální fotkou).
- **Modelka z persona avatara** (jako v2) — povinný; bez něj Generate disabled.
- **UI v3** = jako v2 + "Beach scene" pily (Bright sunny / Golden hour / Dune grass / Rocky cove).
- **Krok 2 failure** → creative zůstane na studiovce (`status='pending'`, `file_url`=studiovka, `metadata.v3_error`), NE `failed`.
- **Krok 2 model**: `fal-ai/ideogram/v3/replace-background` (už je v `FAL_MODEL_MAP` jako `fal_ideogram_bg`). Pokud se ukáže, že moc mění subjekt → fallback zkusit `fal_flux2_edit` (doladění po testech, mimo scope této spec).
- **Finální v3 obrázek**: žádný post-process crop/brightness (`processCatalogImage` zůstává `c.style === 'product_catalog'` jen).
- Žádné nové npm závislosti, žádná DB/schema změna.

## Mechanika chainu (klíčové)

`poll_generations` zpracovává jen řádky `status='generating'` AND `hf_job_id != null`. **Jedna creative row po celou dobu:**

1. `generate.js` (`style==='product_catalog_v3'`) → vygeneruje **studiový prompt** (white studio, avatar sandwich `[avatar, produkt, avatar]`, póza), submitne na Nano Banana Pro, vytvoří creative row `status='generating'` + `metadata`: `{ ..., stage: 'studio', v3_beach_scene: '<scene key>', v3_aspect: outAspectRatio, poll_base, submitted_at, model: 'fal-ai/nano-banana-pro/edit' }`.
2. `poll_generations` 1. cyklus: studio job `completed` → **NEpřepne na `pending`**. Místo toho: vezme `result.url` (studiovka, fal.ai temp URL ~1h TTL), submitne **Ideogram BG job** (`submitFalJob({ model: 'fal-ai/ideogram/v3/replace-background', prompt: buildV3BeachPrompt(meta.v3_beach_scene), imageUrl: [result.url], aspectRatio: meta.v3_aspect })`), updatne row: `hf_job_id`=nový requestId, `status` zůstává `'generating'`, `metadata`: `{ ...meta, stage: 'beach', poll_base: <nový pollBase>, submitted_at: now, model: 'fal-ai/ideogram/v3/replace-background', studio_url: result.url, retry_count: 0 }`. `continue;` (neprovede flip-to-pending).
3. `poll_generations` další cyklus: beach job `completed` → **teď** flip na `status='pending'` s finální plážovou fotkou (`result.url`), background download + upload do Storage (jako u ostatních; žádný `processCatalogImage`).
4. Beach job `failed` / timeout (a `retry_count >= 1`): pokud `meta.stage === 'beach'` → místo `status='failed'` udělat `status='pending', file_url: meta.studio_url, metadata: { ...meta, v3_error: 'bg replace failed', v3_failed: true }`. (Studiovka jako výsledek.) Auto-retry (8 min) funguje pro oba kroky stejně (používá `meta.model`, `meta.poll_base` — ty se po chainu aktualizovaly).
5. **Detekce v `poll_generations`**: celý chain je `if (c.style === 'product_catalog_v3' && meta.stage === 'studio' && !meta.v3_failed) { ...chain to step 2... continue; }` umístěné v `if (result.status === 'completed' && result.url)` bloku PŘED stávající flip-to-pending. Žádný zásah do v1/v2/ostatních cest.

Studiovka se trvale nikam neukládá (jen fal.ai temp URL, použitá v kroku 2 do pár sekund). Pokud krok 2 uspěje, `studio_url` v metadatech vyprší za ~1h — nevadí, finální obrázek je ve Storage.

## Změny

### Nový soubor: `lib/v3-beach-scenes.js`

```js
// Beach-background prompts for Product Catalog v3 step 2 (Ideogram v3 replace-background).
// The model gets a finished clean-studio shot of the model in the swimsuit; this prompt tells
// it to swap ONLY the background — keep the subject, pose, garment, and the lighting on her
// exactly as they are. Keys match the CATALOG_BEACH_SCENES ids in CreativeStudio.jsx.
const SCENES = {
  sunny: 'Replace the plain studio background with a real sandy beach: ocean with gentle waves on one side, soft dry sand with a few dune grasses and a low dune line, bright blue sky with a few soft white clouds, light haze at the horizon. Bright natural daylight from the front, matching the studio lighting already on the model. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright. The background holds full detail — NOT blown out to white, NOT washed out, NOT a hazy bright wash.',
  golden: 'Replace the plain studio background with a real beach at golden hour: a warm low sun behind the camera, soft golden light, calm sea, dry sand with dune grass catching the warm light, soft warm sky. The warm light gently grades the scene — keep it natural, not a heavy orange filter, not overexposed. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright.',
  dune: 'Replace the plain studio background with a real beach behind a sand dune: tall beach grass on both sides framing the model, soft dry sand, glimpses of ocean and a bright sky beyond, bright midday daylight from the front. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright; the background holds full detail, not blown out.',
  cove: 'Replace the plain studio background with a quiet rocky cove: turquoise water, smooth pebbles and sand, a soft cliff face in the bokeh, bright natural daylight from the front. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright; the background holds full detail, not blown out.',
};
export function buildV3BeachPrompt(sceneKey) {
  return SCENES[sceneKey] || SCENES.sunny;
}
```

### Soubor: `api/creatives/generate.js`

1. `const isProductCatalogV3 = style === 'product_catalog_v3';` (poblíž `isProductCatalogV2`).
2. Image filter (~ř. 113): `if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3) { ... }`.
3. Avatar auto-lookup (~ř. 59): `product_catalog_v3` tím projde (není `realistic_beach`) → beze změny.
4. Parsovat z `custom_prompt` v3 tagy: `[catalog_beach:<key>]` (vedle `[catalog_model:...]`, `[catalog_pose:...]`). `const v3BeachMatch = (custom_prompt||'').match(/\[catalog_beach:([^\]]+)\]/); const v3BeachKey = v3BeachMatch?.[1]?.trim() || 'sunny';`
5. Nová prompt větev `else if (isProductCatalogV3)` (po `isProductCatalogV2`, před `isRealisticBeach`):
   - `const v3HasAvatar = !!reference_url;`
   - `const v3Custom = (custom_prompt||'').replace(/\[catalog_[^\]]+\]/g,'').trim();`
   - `const v3PoseText = v3Custom.includes('POSE:') ? v3Custom.slice(v3Custom.indexOf('POSE:')).trim() : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';`
   - `const v3ModelDesc = (v3Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1]||'').trim() || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';`
   - `const v3ModelLine = v3HasAvatar ? 'Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.' : 'Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — generate exactly this woman: ' + v3ModelDesc;`
   - `const v3GarmentLine = v3HasAvatar ? 'REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, twice). Any image in between = THE GARMENT — recreate this swimsuit faithfully (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage); do NOT let the garment images influence the model\'s face.' : 'Use the swimsuit shown in the attached image as the exact reference garment — recreate it faithfully (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage). Do not redesign or reinterpret it.';`
   - `prompt = \`${v3GarmentLine}\n\n${v3ModelLine}\n\nBACKGROUND: a CLEAN, SEAMLESS white-to-light-grey studio backdrop — NOTHING else: no props, no furniture, no floor line, no horizon, no shadows on the wall, no gradient, no colored background. Just a clean studio sweep behind her.\n\nLIGHTING (this is the whole point — get it perfect): FLAT, EVEN, SOFT studio lighting — a big softbox on the model from the front plus fill light on BOTH sides, so the swimsuit is lit FULLY AND EVENLY FROM ALL SIDES. ZERO harsh shadows, ZERO side-lit shadow, ZERO directional shadow. Every part of the swimsuit is crisp and bright — fabric texture, color, pattern, ribbing/pleating, trims, stitching, seams, waistband all clearly readable. Black fabric reads as a clean dark grey-black with ALL the texture visible — NOT crushed to a flat black silhouette. Bright, clean, true-to-life exposure — NOT dim, NOT overexposed, NOT washed out. The model's skin is evenly lit, natural, true to life.\n\nProduct: ${product.title}\n\n${v3PoseText}\n\nGARMENT RULES (non-negotiable): for two-piece swimsuits the bikini bottoms must be high-waisted, sit well above the belly button, and fully cover the navel; moderate leg opening, not high-cut, full coverage across the hips and upper thighs. For one-piece swimsuits: full coverage from bust to upper hip, moderate leg opening.\n\nFACE QUALITY (critical): sharp detailed features, visible skin pores, individual eyebrow hairs, realistic catchlight in the eyes, visible iris detail, individual eyelashes, natural lip texture. Face tack sharp, no AI smoothing, no uncanny valley, no doll-like skin. If the face looks AI-generated, blurry, or plastic — the image is WRONG.\n\nCAMERA: shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below. Her proportions are natural and undistorted. Hyperrealistic, photographic, editorial swimwear catalog quality, 85mm lens at f/2.8, Canon R5 look, 8K, ultra-sharp. ${aspect_ratio || '4:5'} format.\n\nNEGATIVE: beach, ocean, sand, water, sky, outdoor, nature, sunset, golden hour, props, furniture, floor line, horizon line, gradient backdrop, colored background, dark background, shadow on the wall, harsh shadow, hard cast shadow, side lighting, directional shadow, dark side of the body, dim, dark photo, underexposed, overexposed, blown-out highlights, washed out, hazy bright wash, crushed blacks, garment crushed to pure black, deep shadows on the swimsuit, dark areas on the garment, visible belly button, exposed navel, low-rise bottoms, mid-rise bottoms, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, low-angle shot, shot from below, distorted perspective, text, watermarks.\`.trim();`
6. `refImages` (~ř. 437): `(isProductCatalog || isProductCatalogV2 || isProductCatalogV3) ? (avatarRef ? [avatarRef, ...images.slice(0,1), avatarRef] : images.slice(0,1)) : ...` — přidat v3.
7. `outAspectRatio`: `isProductCatalogV3 ? (aspect_ratio || '4:5') : (isProductCatalogV2 ? '4:5' : aspect_ratio)`.
8. `falPrompt` (~ř. 459): `(isProductCatalog || isProductCatalogV2 || isProductCatalogV3) ? prompt : ...`.
9. `configMeta`: pro v3 přidat `stage: 'studio'`, `v3_beach_scene: v3BeachKey`, `v3_aspect: outAspectRatio`. (`catalog_model`/`pose` se vytáhnou z tagů jako u v2 — funguje.) `framing_crop` se NEnastaví pro v3.

### Soubor: `lib/actions/creatives.js` (`poll_generations` chain)

1. Import: `import { buildV3BeachPrompt } from '../v3-beach-scenes.js';`
2. V `poll_generations`, v `if (result.status === 'completed' && result.url)` bloku — **PŘED** stávající `await supabase.from('creatives').update({ status: 'pending', ... })` — vložit:
   ```js
   // Product Catalog v3 — step 1 (studio) done → kick off step 2 (Ideogram bg replace), keep row 'generating'
   if (c.style === 'product_catalog_v3' && meta.stage === 'studio' && !meta.v3_failed) {
     try {
       const bgPrompt = buildV3BeachPrompt(meta.v3_beach_scene);
       const job2 = await submitFalJob({ model: 'fal-ai/ideogram/v3/replace-background', prompt: bgPrompt, imageUrl: [result.url], aspectRatio: meta.v3_aspect || '4:5' });
       await supabase.from('creatives').update({
         hf_job_id: job2.requestId,
         metadata: { ...meta, stage: 'beach', poll_base: job2.pollBase, submitted_at: new Date().toISOString(), model: 'fal-ai/ideogram/v3/replace-background', studio_url: result.url, retry_count: 0 },
       }).eq('id', c.id);
       console.log('[poll_generations] v3 step 1 done, submitted step 2 (bg replace) for', c.id);
       continue;
     } catch (v3Err) {
       console.error('[poll_generations] v3 step 2 submit failed for', c.id, v3Err.message, '— keeping studio shot as result');
       await supabase.from('creatives').update({ status: 'pending', file_url: result.url, storage_path: c.storage_path || `creatives/poll_${c.id}_${Date.now()}.png`, metadata: { ...meta, v3_error: `bg replace submit failed: ${v3Err.message}`, v3_failed: true } }).eq('id', c.id);
       completed++;
       continue;
     }
   }
   ```
3. V `else if (result.status === 'failed')` bloku — pokud `c.style === 'product_catalog_v3' && meta.stage === 'beach'` (a retry vyčerpán nebo nemožný): místo `status='failed'` udělat `status='pending', file_url: meta.studio_url, metadata: { ...meta, v3_error: result.error, v3_failed: true }, completed++` (ne `failed++`). Stejně v timeout bloku (`if ((Date.now() - submittedAt) > MAX_JOB_AGE_MS)`) — pokud `v3 && stage==='beach'` a retry vyčerpán → fallback na `studio_url` místo `status='failed'`.
4. Background download/upload blok (~ř. 264-284) — beze změny; pro v3 finální obrázek (z Ideogram BG) se uploadne do Storage stejně jako každý jiný; `processCatalogImage` se NEvolá (`c.style === 'product_catalog'` jen — v3 to nesplňuje).

### Soubor: `apps/dashboard/src/components/CreativeStudio.jsx`

1. `STYLE_MAP`: `"product-catalog-v3": "product_catalog_v3"`.
2. `STYLE_CATEGORIES` "product-photos": `{ id: "product-catalog-v3", title: "Product Catalog v3", desc: "Studio shot → beach background (2-step)", icon: "🎬" }`.
3. Nový `CATALOG_BEACH_SCENES` array: `[{id:'sunny',label:'Bright sunny'},{id:'golden',label:'Golden hour'},{id:'dune',label:'Dune grass'},{id:'cove',label:'Rocky cove'}]`. Nový state `catalogBeach` default `'sunny'`.
4. Render-scope: `isProductCatalogV3Style = imgStyle === "product-catalog-v3"`; rozšířit `isAnyCatalogStyle` na v1 || v2 || v3. handleGenImage-scope: `isProductCatalogV3 = imgStyle === 'product-catalog-v3'`; rozšířit `isAnyCatalog` na v1 || v2 || v3.
5. `backendModel`: pro v3 (jako v1/v2) = `"fal_nano_banana_pro"` (krok 1).
6. Nový v3 UI blok (vedle v2 bloku): `{imgStyle === "product-catalog-v3" && (<> Reference model (avatar Select, bez __preset__, prázdný-stav hláška — identicky jako v2) + Pose pily (CATALOG_POSES) + Beach scene pily (CATALOG_BEACH_SCENES, active=catalogBeach) </>)}`.
7. `customInstr` pro v3: `\`[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}\`` (rozšířit `customInstr` ternár o v3 větev; `catalogPosePrompt` se už počítá pro `isAnyCatalog`).
8. `generateCreatives` pro v3: `style: 'product_catalog_v3'`, `ai_model: 'fal_nano_banana_pro'`, `audience: catalogAvatar || undefined`, `aspect_ratio: '4:5'`, `resolution: imgResolution`, `show_model: true`, `text_overlay: 'none'`, `overlay_text: ''`, `reference_url: undefined`. (Rozšířit existující v2 ternáry: `audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? (catalogAvatar || undefined) : ...`; `aspect_ratio: (isProductCatalogV2 || isProductCatalogV3) ? '4:5' : imgRatio`; `show_model: (isProductCatalogV2 || isProductCatalogV3) ? true : subject === "On model"`; analogicky `text_overlay`/`overlay_text`/`reference_url`.)
9. Generate button disabled: rozšířit `(isProductCatalogV2Style && !catalogAvatar)` → `((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar)` (button styling + hint). Early-return guard v `handleGenImage`: rozšířit `imgStyle === 'product-catalog-v2'` → `(imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3')`.
10. Catalog Count/Resolution řádek: gating `isAnyCatalogStyle` (už pokrývá v3 po kroku 4); Aspect ratio jen pro v1 (`imgStyle === "product-catalog"` — už tak je).

## Co se NEmění
- v1 "Product Catalog", v2 "Product Catalog v2" — beze změny
- `processCatalogImage` / `lib/avatar-crop.js` — beze změny (v3 finální obrázek bez post-processu)
- Realistic Beach, PhotoStory, ostatní styly — beze změny
- `apps/dashboard/src/lib/api.js` — beze změny
- Žádné nové npm závislosti, žádná DB/schema změna (`product_catalog_v3` volný text v `creatives.style`; `metadata.stage`/`v3_*` volné JSONB klíče)

## Verifikace
1. `node --check api/creatives/generate.js && node --check lib/actions/creatives.js && node --check lib/v3-beach-scenes.js` → exit 0
2. `npm test` → 27/27 pass
3. `cd apps/dashboard && npm run build` → projde (jen pre-existující ESLint noise)
4. Manuální (po deployi): Studio → Product Catalog v3 → ověřit UI: **Reference model** (avatar dropdown) / **Pose** pily / **Beach scene** pily / **Resolution** / **Count**, nic víc. Bez avatara → Generate disabled + hláška. → vybrat avatara + pózu + scénu (Bright sunny) + Count → Generate → sledovat: creative "generating" → ~1-3 min (krok 1 studiovka) → pořád "generating" → ~30s-1 min (krok 2 bg replace) → finální **plážová fotka** (modelka z avatara, swimsuit z produktu **rovnoměrně nasvícený** = ověřit ten pilíř, žádný boční stín, žádné přepálení, žádný crushed black, pupek skrytý; pláž dle scény, modelka tack sharp, pozadí měkce rozostřené, ne přepálené). Vercel log: `[poll_generations] v3 step 1 done, submitted step 2`. → zkusit "Golden hour" scénu → výstup teplejší pozadí, modelka stejně nasvícená. Vygenerovat 2-3×.
5. Edge: kdyby Ideogram BG selhal (sleduj `[poll_generations]` log) → výstup = ta čistá studiovka (`status='pending'`, `metadata.v3_error`).
6. Regrese: v1 "Product Catalog" a v2 "Product Catalog v2" pořád fungují beze změny (UI, generace).
7. Pošli v3 výsledek kolegovi na porovnání s referenčkou + s v1/v2.

## Pozn. / rizika
- Nejkomplexnější z v-stylů — přidává orchestraci do `poll_generations` (CLAUDE.md ho flaguje jako fragile). Mitigace: celý chain je izolovaný `if (c.style === 'product_catalog_v3' && meta.stage === 'studio') {...}` blok; v1/v2/ostatní cesty nedotčené; auto-retry a timeout logika funguje pro oba kroky stejně (přes `meta.model`/`meta.poll_base`).
- Cena ~2× za finální obrázek (studiovka Nano Banana Pro ~$0.15 + Ideogram BG ~$0.03 ≈ $0.18 vs. ~$0.15 single-step v1/v2).
- Studiovka se trvale neukládá (jen fal.ai temp URL, použitá v kroku 2 do pár sekund). Když krok 2 uspěje, `metadata.studio_url` vyprší za ~1h — nevadí (finální obrázek je ve Storage).
- Pokud Ideogram BG moc mění subjekt (přesvítí okraje, posune pózu) → fallback zkusit `fal-ai/flux-2/edit` (drží subjekt víc) — doladění po prvních testech, mimo scope této spec.
- `metadata.v3_aspect` — Ideogram v3 replace-background bere `aspect_ratio`; uložíme ho v kroku 1 a předáme v kroku 2, aby finální obrázek byl 4:5.

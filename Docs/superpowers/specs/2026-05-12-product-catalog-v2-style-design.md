# Spec: Nový styl "Product Catalog v2" (golden hour) + minimální Studio UI

> Datum: 2026-05-12 · Status: schváleno k implementaci · Scope: `apps/dashboard/src/components/CreativeStudio.jsx` + `api/creatives/generate.js` (nová paralelní větev) · NEsahá na stávající Product Catalog (v1)

## Context — proč to děláme

Uživatel poslal hotový prompt (golden-hour swimwear katalog) a chce z něj **nový creative styl vedle stávajícího "Product Catalog"** — ne náhradu, ne refactor v1. Stávající Product Catalog (v1) byl iterativně laděn na "bright frontal sun, bez bočního stínu, post-process brightness lift, framing crop" a má bohaté UI (avatar picker, Model/Pose/Framing pily, Count/Aspect/Resolution). Nový styl v2 je jednodušší: prompt je z velké části verbatim (golden hour, "subject pops forward / background one stop darker", garment rules vč. "high-waisted bottoms, navel fully covered", 4:5 framing), uživatel chce minimální UI — **jen Pose, Model, Resolution, Count**, nic víc.

**Cíl:** Ve Studiu přibude pil "Product Catalog v2" v kategorii "Product photos". Po jeho výběru se ukáže jen: Pose pily (6×, sdílí stávající `CATALOG_POSES`), Model pily (3×, sdílí stávající `CATALOG_MODELS`), Resolution pily, Count (1-4). Nic jiného — žádný avatar picker, žádné Framing pily, žádné Aspect ratio (4:5 hardcoded v promptu), žádná custom instructions textarea, žádný On model/Product only toggle. AI model = vždy Nano Banana Pro (skrytý). Backend dostane nový `style === 'product_catalog_v2'` s vlastní paralelní větví; v1 zůstává nedotčený.

## Rozhodnutí (z brainstormingu)
- **Nový styl vedle v1** — oba viditelné. v1 beze změny.
- **"Modelka" = výběr osoby** (3 presety, sdílí `CATALOG_MODELS`) → nahradí hardcoded řádek "Mid-size woman, US size 12-14..." v promptu popisem zvoleného presetu. **"Poza"** (6 presetů, sdílí `CATALOG_POSES`) → nahradí `POSE: [INSERT POSE VARIANT FROM BELOW]`. Vše ostatní v promptu verbatim. Žádné nové preset arrays.
- **UI v2: jen Pose / Model / Resolution / Count.** Žádný avatar, framing, aspect ratio, textarea, on-model toggle.
- **Post-process (`processCatalogImage`): NE pro v2.** v2 prompt řídí expozici sám (golden hour, subject brightest, background −1 stop) — brightness lift +12% by to rozhodil. v2 výstup jde do Storage bez úprav (a bez cropu — nemá framing).
- **Naming:** frontend id `product-catalog-v2`, label "Product Catalog v2", `STYLE_MAP` → `product_catalog_v2`.
- **Jeden feature → jeden commit** (frontend + backend nová větev).

## Referenční prompt (verbatim, s dvěma substitucemi)

Backend větev pro v2 vygeneruje tento prompt, kde `${modelDesc}` nahradí řádek "Mid-size woman..." a `${poseText}` nahradí "POSE: [INSERT POSE VARIANT FROM BELOW]" (ostatní verbatim):

```
Use the swimsuit shown in the attached image as the exact reference garment. Recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign, restyle, or reinterpret the swimsuit. The garment in the attached image is the product, replicate it exactly.

Professional e-commerce swimwear product photography. ${modelDesc}

She is barefoot on a quiet beach at golden hour, ocean and sky softly out of focus in the background.

LIGHTING (critical, do not alter):
- Warm directional golden-hour sunlight hitting the model from the front or front-three-quarter angle, illuminating her face, décolletage, and the front of the garment directly
- The model's skin and the garment must be the brightest, most exposed elements in the frame
- Background (ocean, sky, sand) is exposed approximately one stop darker than the model, slightly desaturated, slightly cooler in tone, so the subject pops forward
- No flat side-lighting, no overcast diffusion, no backlit silhouette
- Subtle warm rim light along her hair and shoulder for separation from background

COMPOSITION:
- Vertical 4:5 framing
- Full body or three-quarter body crop, model centered, framing emphasizes the torso and the garment construction
- Shallow depth of field, background softly out of focus
- Sharp focus on the garment fabric, fit, seaming, and texture
- Dry sand under her feet, clean uncluttered foreground

GARMENT RULES (non-negotiable):
- For one-piece swimsuits: full coverage from bust to upper hip, moderate leg opening (not high-cut), the suit covers the body as designed in the reference image
- For two-piece swimsuits: bikini bottoms must be high-waisted, sit well above the belly button, and fully cover the navel
- Bikini bottoms must have moderate leg opening, not high-cut, with full coverage across the hips and upper thighs
- Repeat: high-waisted bottoms, navel fully covered, moderate leg cut
- Garment fabric texture, color, and structural details must match the attached reference exactly

${poseText}

Hyperrealistic, photographic, editorial swimwear catalog quality, shot on 85mm lens at f/2.8, Canon R5 look, true-to-life skin texture and fabric texture.
```

- `${modelDesc}` default (když parser nenajde tag/POSE): `Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.`
- `${poseText}` default: první položka `CATALOG_POSES` (`POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.`)
- `${poseText}` z UI presetu už obsahuje prefix "POSE: " (`CATALOG_POSES[].prompt` začíná "POSE: ...").

## Změny

### Soubor: `apps/dashboard/src/components/CreativeStudio.jsx`

1. **`STYLE_MAP`** (~ř. 29): přidat `"product-catalog-v2": "product_catalog_v2",`
2. **`STYLE_CATEGORIES`** "product-photos" (~ř. 99-143): přidat `{ id: "product-catalog-v2", label: "Product Catalog v2" }` (vedle stávajícího "product-catalog").
3. **Nová proměnná** (poblíž `isProductCatalogStyle` ~ř. 558): `const isProductCatalogV2 = imgStyle === 'product-catalog-v2';` a `const isAnyCatalog = isProductCatalogStyle || isProductCatalogV2;`
4. **`backendModel`** (~ř. 546): `const backendModel = isAnyCatalog ? "fal_nano_banana_pro" : (MODEL_MAP[imgModel] || "fal_nano_banana");`
5. **UI gating** — všechna místa `imgStyle !== "product-catalog"` (~ř. 732, 750, 757, 799, 811, 823, 881, 892, 937-980) → změnit na `!isAnyCatalog` (schová stejné věci pro oba). Hide pro oba: AI model picker, hlavní Subject/Pose/Body/Framing/Scene/customInstr controls, hlavní Count/Ratio/Resolution.
6. **Separátní Count/Resolution řádek** (~ř. 1012, dnes `imgStyle === "product-catalog" && ...`) → změnit na `isAnyCatalog && ...`, a uvnitř **Aspect ratio zobrazit jen pro v1** (`imgStyle === "product-catalog"`); pro v2 jen Count + Resolution.
7. **Stávající Product Catalog UI blok** (~ř. 835, `imgStyle === "product-catalog" && (<>...avatar picker + Model + Pose + Framing...</>)`) → beze změny (zůstává jen pro v1).
8. **Nový UI blok pro v2** (vedle něj): `{isProductCatalogV2 && (<><SectionLabel>Model preset</SectionLabel> {CATALOG_MODELS pily, active=catalogModel} <SectionLabel>Pose</SectionLabel> {CATALOG_POSES pily, active=catalogPose}</>)}` — žádný avatar picker, žádné Framing pily. Reuse `catalogModel` / `catalogPose` state.
9. **`customInstr`** (~ř. 568): rozšířit ternár — `isProductCatalogV2 ? \`[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogModelPrompt}\n\n${catalogPosePrompt}\` : (isProductCatalogStyle ? \`...v1...\` : \`...obecný...\`)`. (`catalogModelLabel` / `catalogPoseLabel` / `catalogModelPrompt` / `catalogPosePrompt` se už počítají pro `isProductCatalogStyle` — rozšířit jejich podmínku na `isAnyCatalog`.)
10. **`generateCreatives` call** (~ř. 578) — pro v2: `style: 'product_catalog_v2'`, `ai_model: 'fal_nano_banana_pro'`, `custom_prompt: customInstr`, `audience: undefined`, `aspect_ratio: '4:5'`, `resolution: imgResolution`, `reference_url: colorRef || undefined`, `show_model: true`, `text_overlay: 'none'`, `overlay_text: ''`. (Existující ternár pro `audience` rozšířit: `isProductCatalogV2 ? undefined : (isProductCatalogStyle ? (catalogAvatar || undefined) : ...)`. Pro `aspect_ratio`: `isProductCatalogV2 ? '4:5' : imgRatio`.)

### Soubor: `api/creatives/generate.js`

1. **`const isProductCatalogV2 = style === 'product_catalog_v2';`** (poblíž ř. 93).
2. **Avatar auto-injection** (~ř. 59): podmínka `if (audience && !reference_url && store_id && style !== 'realistic_beach')` — v2 neposílá `audience`, takže se nespustí; pro čitelnost přidat `&& !isProductCatalogV2` není nutné, **ponechat beze změny** (audience undefined to ošetří).
3. **Image filtering** (~ř. 113): `if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2) { ... AI_FILENAME filter + images.slice(0,2) ... }` — přidat `|| isProductCatalogV2`.
4. **Nová větev** v `if/else` řetězci stylů (po `if (isProductCatalog) {...}` a `else if (isRealisticBeach) {...}`): `else if (isProductCatalogV2) { ... }`. Uvnitř:
   - Parsovat z `custom_prompt`: `catalogCustom = (custom_prompt||'').replace(/\[catalog_[^\]]+\]/g,'').trim()`; `modelDesc` = vše před `POSE:` (trim), fallback = hardcoded mid-size řádek (viz výše); `poseText` = vše od `POSE:` (trim), fallback = první `CATALOG_POSES` (`POSE: Standing facing camera...`).
   - `prompt = \`<verbatim prompt výše, s ${modelDesc} a ${poseText}>\``.trim()
   - **NEpoužívat** `framingBlock`/`framingNegative`/`catalogHighWaist`/`catalogFramingKey` (v1-only).
5. **`refImages`** (~ř. 399): přidat v2 — `isProductCatalogV2 ? images.slice(0, 2) : (isProductCatalog ? ... : ...)`. (Jen produktové fotky, žádný avatar sandwich.)
6. **`outAspectRatio`** (kde se počítá ~ř. 380-420): pro v2 vždy `'4:5'`.
7. **`configMeta`** (~ř. 506-536): `catalog_model` / `pose` se vytáhnou z tagů — stejná logika jako v1 (`catalogModelMatch`, `catalogPoseMatch`), funguje pro v2 taky. `framing_crop` se NEnastaví pro v2 (nemá framing) → `poll_generations` crop nezavolá. Pro jistotu: `catalogFramingKey` zůstává `isProductCatalog ? ... : null` — pro v2 je `null`, OK.
8. **`submitFalJob`** (~ř. 423): `model: falModelUsed` (= `fal-ai/nano-banana-pro/edit` pro v2), `imageUrl: refImages`, `aspectRatio: outAspectRatio` (= '4:5'), `resolution`.
9. **`falModelUsed`** — kde se rozhoduje, který fal model: zajistit, že pro v2 (jako pro v1) je to nano-banana-pro. (`ai_model` přijde jako `fal_nano_banana_pro` z frontendu → mapuje se na `fal-ai/nano-banana-pro/edit`. Ověřit, že to tak je i bez speciální větve; pravděpodobně ano.)

### Soubor: `lib/actions/creatives.js`

**Beze změny.** `poll_generations` (~ř. 270): `if (c.style === 'product_catalog')` — NEpřidávat `product_catalog_v2`. v2 výstup se neořezává ani nezesvětluje.

## Co se NEmění
- Stávající "Product Catalog" (v1) — beze změny (avatar, Model/Pose/Framing pily, `catalogHighWaist`, framing crop, `processCatalogImage` pro v1)
- Realistic Beach, ostatní styly, Bulk Generate, branded content — beze změny
- `lib/avatar-crop.js`, `lib/higgsfield.js` — beze změny
- `generateCreatives` signatura (`apps/dashboard/src/lib/api.js`) — beze změny (v2 jen posílá podmnožinu polí)
- Žádné nové npm závislosti, žádná DB/schema změna (nový `style` string je jen hodnota ve sloupci `creatives.style`)

## Verifikace
1. `node --check api/creatives/generate.js` → exit 0
2. `npm test` → 27/27 pass (žádná test/routing změna)
3. `cd apps/dashboard && npm run build` → projde bez chyb (jen pre-existující ESLint noise)
4. Manuální (po deployi): Studio → vybrat pil **"Product Catalog v2"** → ověřit, že UI ukáže **JEN**: Pose pily (6×), Model preset pily (3×), Resolution pily, Count (1-4). ŽÁDNÝ avatar picker, ŽÁDNÉ Framing pily, ŽÁDNÉ Aspect ratio, ŽÁDNÁ custom instructions textarea, ŽÁDNÝ On model/Product only toggle. AI model picker skrytý. → vybrat Pose + Model + Resolution + Count → Generate → výstup: golden-hour pláž, "subject pops forward", modelka odpovídá zvolenému presetu, póza odpovídá, produkt z reference fotky, 4:5, vysokopáskové spodní díly s zakrytým pupkem (je v promptu). Vygenerovat 2-3×.
5. Regrese: vybrat stávající "Product Catalog" (v1) → ověřit, že funguje beze změny (avatar picker, Framing pily, Aspect ratio, post-process crop/brightness).
6. Edge: kdyby v2 prompt parser nenašel `POSE:` nebo `[catalog_model:...]` v `custom_prompt` → fallback na hardcoded mid-size modelku / první pózu (generace funguje).

## Pozn. / rizika
- Nesaháme na v1 ani na sdílenou prompt logiku — jen nová paralelní `else if` větev → riziko regrese na v1 minimální.
- Sdílení `catalogModel` / `catalogPose` state mezi v1 a v2 ve frontendu: vždy je aktivní jen jeden styl, takže sdílený state nevadí (ušetří duplicitní `useState`).
- Pokud se v2 výstup ukáže moc tmavý / moc světlý, řešíme samostatně (drobnost — buď drobná úprava promptu nebo zvážit gentle post-process). Záměrně neoptimalizujeme dopředu.
- `style='product_catalog_v2'` ve sloupci `creatives.style` — žádná migrace potřeba, je to volný text. Staré creativy se style='product_catalog' fungují dál.

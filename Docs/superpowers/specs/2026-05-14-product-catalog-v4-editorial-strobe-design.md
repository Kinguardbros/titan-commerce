# Spec: Product Catalog v4 — Editorial Strobe (verbatim user prompt + minimal UI)

> Datum: 2026-05-14 · Status: schváleno k implementaci · Scope: nový soubor `lib/v4-prompt.js` + nová větev v `api/creatives/generate.js` + nový styl v `apps/dashboard/src/components/CreativeStudio.jsx` · NEsahá na v1, v2, v3, Realistic Beach, PhotoStory, `processCatalogImage`, `lib/v3-beach-scenes.js`

## Context — proč to děláme

Uživatel poslal vlastní 6500-znakový prompt s vysokou úrovní detailu (premium DTC swimwear brand campaign aesthetic — Andie Swim / Hermoza / Aerie / Athleta editorial). Klíčový aspekt: "professional studio strobe na model + natural late golden hour beach jako pozadí" — tzn. **studio-quality light na subjektu + on-location backdrop**. Plus podrobný popis pose, expression, settingu, lighting direction, color grading, quality requirements a velkého negative listu (~1500 znaků).

Uživatel chce ten prompt **doslova verbatim** — pipeline ho nesmí editovat, jen kolem něj přidat technicky nutné věci (avatar identity reference + product title + Isola navel-hide blok). Backend žádné `[catalog_*]` tagy parsovat nebude (žádná Pose / Beach / Framing volba ve v4 UI). UI = extrémně minimální: Reference model + Resolution + Count.

**Cíl:** Nový styl "Product Catalog v4" ve Studiu. Jediné 4 věci kolem verbatim promptu: (a) avatar (povinný, sandwich pattern), (b) `${product.title}` substituce, (c) HIGH-WAIST navel-hide blok pro Isola (`catalogHighWaist=true`), (d) backend params (4:5, 2K resolution, count). Žádné catalog tagy v `customInstr`. Žádný post-process.

## Rozhodnutí (z brainstormingu)

- **Prompt verbatim** — uživatelův 6500-znakový text se nedotýká, žádné edity, žádné odstranění "DIMENSIONAL BODY MODELING" odstavce navzdory potenciálnímu konfliktu s anti-side-light premisou (uživatel akceptuje riziko).
- **UI minimal**: Reference model (avatar dropdown, povinný — bez `__preset__`, empty-state hláška) + Resolution + Count. Žádný Pose, žádný Beach scene, žádný Framing, žádné Aspect ratio.
- **Pose**: hardcoded v promptu ("standing facing camera, slight 5-15 degree turn, weight on one leg..."). Žádná uživatelská volba.
- **Aspect ratio**: hardcoded `4:5` (jak v promptu, tak v fal.ai params).
- **Navel hide**: stejný silný HIGH-WAIST blok jako v1/v3, přidaný backend na konec promptu (před tvůj NEGATIVE), podmíněný `catalogHighWaist`. `catalogHighWaist` se rozšíří o v4: `((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) && isIsola) || isHighWaistTummy`.
- **Reference roles prefix**: backend přidá na úplný začátek promptu krátký 4-řádkový reference-roles blok ("image 1 + last = THE MODEL ... middle = THE GARMENT") — bez něj sandwich nedává modelu smysl.
- **`Product: ${product.title}`**: backend vloží mezi reference-roles prefix a tvůj prompt.
- **Single shot** (jako v1/v2). Žádný 2-step pipeline. Žádný `processCatalogImage` post-process. v4 výstup jde do Storage bez úprav.
- **Model**: Nano Banana Pro (jako v1/v2/v3 step 1). Sandwich `[avatar, productPhoto, avatar]` — 3 reference images.
- **Jeden styl, izolovaný od ostatních**. v1/v2/v3/Realistic Beach/PhotoStory beze změny.

## Architektura promptu (co fal.ai dostane)

Jeden šablonu se 3 sekcemi:

```
REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).

Product: ${product.title}

[USER'S VERBATIM 6500-CHAR PROMPT — slovo od slova, žádná změna]
${catalogHighWaist ? `

━━━━━━━━━━━━━━━━━━━━━━━━
=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===
[stejný text jako má v1/v3]
━━━━━━━━━━━━━━━━━━━━━━━━` : ''}
```

Délka: ~7000 znaků s prefixem + product title + HIGH-WAIST blok. Tvůj NEGATIVE se zachová na konci.

## Změny

### Nový soubor: `lib/v4-prompt.js`

Exportuje uživatelův 6500-znakový verbatim prompt jako konstantu `V4_PROMPT_BODY` (string). Pro čitelnost samostatný soubor (`generate.js` má 700+ řádků, nechceme ho dál zhuštovat).

```js
// Product Catalog v4 — verbatim user-provided editorial-strobe prompt.
// User wants this text unmodified. Backend wraps it with reference-roles prefix +
// product title + (conditional) HIGH-WAIST navel-hide block. No other edits.
export const V4_PROMPT_BODY = `Ultra-realistic editorial fashion photograph of a confident, naturally beautiful woman wearing a swimsuit on a beach. This is a professional catalog studio shoot captured on location — premium DTC swimwear brand campaign aesthetic in the visual quality of Andie Swim, Hermoza, Aerie, Athleta, and J.Crew editorial campaigns. Studio-quality production values with professional strobe lighting on the model and natural beach environment as backdrop.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):
[... celý text ze zprávy uživatele ...]

REFERENCE: Match the visual aesthetic, lighting quality, and color grading of premium swimwear brands such as Andie Swim, Hermoza, Aerie, Athleta, and Summersalt. Editorial campaign photography quality. Studio shoot on location.`;
```

(Plný text bude v plánu Step "Create file" verbatim — ne v této spec.)

### Soubor: `api/creatives/generate.js`

1. **Import** `V4_PROMPT_BODY` z `lib/v4-prompt.js` (poblíž import `submitFalJob`).
2. **`isProductCatalogV4` flag** (poblíž `isProductCatalogV3`):
   ```js
   const isProductCatalogV4 = style === 'product_catalog_v4';
   ```
3. **Image filter** (~ř. 118): rozšířit o `|| isProductCatalogV4`:
   ```js
   if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) {
   ```
4. **`catalogHighWaist`** (~ř. 108): rozšířit o v4:
   ```js
   const catalogHighWaist = ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) && isIsola) || isHighWaistTummy;
   ```
5. **Nová prompt větev** `else if (isProductCatalogV4) { ... }` — umístit za `else if (isProductCatalogV3) { ... }`, před `else if (isRealisticBeach) { ... }`. Tělo:
   ```js
   } else if (isProductCatalogV4) {
     // Product Catalog v4 — verbatim user prompt (editorial strobe + on-location beach).
     // Backend only wraps it with reference-roles prefix, product title, and conditional
     // HIGH-WAIST navel-hide block. NO other edits to the body text.
     const v4Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
     const v4HighWaistBlock = catalogHighWaist
       ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
       : '';
     prompt = `${v4Prefix}${V4_PROMPT_BODY}${v4HighWaistBlock}`;
   }
   ```
6. **`outAspectRatio`** (~ř. 492): rozšířit o v4 (`'4:5'` hardcoded):
   ```js
   const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) ? '4:5' : aspect_ratio;
   ```
7. **`refImages`** (~ř. 496): rozšířit o v4 (sandwich):
   ```js
   const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4)
     ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
     : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
   ```
8. **`falPrompt`** (~ř. 513): rozšířit o v4 (self-contained, žádné wrappery):
   ```js
   const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4)
     ? prompt
     : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
   ```
9. **`configMeta`**: žádné nové fields. v4 nepoužívá `[catalog_*]` tagy → existující `catalogModelMatch`/`catalogPoseMatch`/`catalogFramingMatch` regex nic nevrátí pro v4 (frontend tagy nepošle) → `audience` se uloží přes existující `...(audience && { audience })`. Stačí.
10. **`ai_model` enforcement** — pro v4 vždy `fal_nano_banana_pro` (jako v1/v2/v3). Backend dostane `ai_model` z requestu (frontend pošle `'fal_nano_banana_pro'`); pokud něco jiného přijde, fallback na default cesta. Žádný explicit override v generate.js.

### Soubor: `apps/dashboard/src/components/CreativeStudio.jsx`

1. **`STYLE_MAP`** (~ř. 30-34): přidat `"product-catalog-v4": "product_catalog_v4"`.
2. **`STYLE_CATEGORIES` "product-photos"** (~ř. 109-117): přidat položku za v3:
   ```jsx
   { id: "product-catalog-v4", title: "Product Catalog v4", desc: "Editorial strobe + on-location beach (Andie Swim aesthetic)", icon: "📷" },
   ```
3. **Render-scope flag** (~ř. 522-526): přidat `isProductCatalogV4Style`, rozšířit `isAnyCatalogStyle`:
   ```jsx
   const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
   const isProductCatalogV4Style = imgStyle === "product-catalog-v4";
   const isProductCatalogV1Style = imgStyle === "product-catalog";
   const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style || isProductCatalogV4Style;
   const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
   ```
4. **`handleGenImage` early-return guard** (~ř. 556): rozšířit o v4:
   ```jsx
   if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3' || imgStyle === 'product-catalog-v4') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
   ```
5. **`handleGenImage` flags** (~ř. 562-565): přidat `isProductCatalogV4`, rozšířit `isAnyCatalog`:
   ```jsx
   const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
   const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
   const isProductCatalogV4 = imgStyle === 'product-catalog-v4';
   const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4;
   ```
6. **`customInstr` ternár** (~ř. 587-595): přidat v4 větev (prázdný text — žádné tagy, žádné prompt fragmenty z UI):
   ```jsx
   const customInstr = isProductCatalogV4
     ? '' // v4: prompt is hardcoded server-side; no [catalog_*] tags, no UI text injection
     : isProductCatalogV3
     ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
     : isProductCatalogV2
     ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
     : isProductCatalogStyle
     ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
     : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
   ```
7. **`generateCreatives` field overrides** (~ř. 603-614): rozšířit existující `(isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle)` ternáry o `|| isProductCatalogV4`. Stejné pattern pro `show_model`, `text_overlay`, `overlay_text`, `audience`, `aspect_ratio`, `reference_url`. `ai_model: 'fal_nano_banana_pro'` (existující ternár pro v1/v2/v3 — rozšířit o v4):
   ```jsx
   ai_model: (isProductCatalogStyle || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4)
     ? 'fal_nano_banana_pro'
     : (selectedAiModel || 'fal_nano_banana_pro'),
   ```
   *Pozn. při implementaci ověřit přesně, jak je `ai_model` aktuálně určen pro v1/v2/v3 — pravděpodobně přes `backendModel` proměnnou definovanou někde nahoře. Plán to dořeší.*
8. **v4 UI block** (vedle v3 bloku, ~po ř. 950): kompletně nový JSX:
   ```jsx
   {imgStyle === "product-catalog-v4" && (
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
     </>
   )}
   ```
   (Žádné Pose pily, žádné Beach scene pily, žádné Framing pily — Resolution/Count je v sdíleném "catalog Count/Resolution" řádku, který už `isAnyCatalogStyle` pokrývá.)
9. **Generate-button disabled guard** — už používá `isAnyCatalogStyle && !catalogAvatar`, tj. po rozšíření `isAnyCatalogStyle` v kroku 3 automaticky pokrývá v4. Nic se nemění.
10. **Catalog Count/Resolution řádek** — Aspect ratio sub-gate `!isAnyCatalogStyle` taky automaticky pokrývá v4 (skryje aspect ratio i pro v4). Nic se nemění.

### Soubor: `lib/actions/creatives.js` (`poll_generations`)

**Beze změny.** v4 je single-shot (jako v1/v2), žádný chain. `processCatalogImage` post-process zůstává `c.style === 'product_catalog'` only — v4 výstup jde do Storage bez úprav.

## Co se NEmění
- v1, v2, v3, Realistic Beach, PhotoStory — beze změny.
- `lib/avatar-crop.js`, `lib/v3-beach-scenes.js`, `lib/fal.js` — beze změny.
- `apps/dashboard/src/lib/api.js` — beze změny (v4 jen posílá podmnožinu polí).
- `processCatalogImage` v `poll_generations` — beze změny (v4 nepoužívá).
- `CATALOG_MODELS` / `CATALOG_FRAMINGS` / `CATALOG_POSES` / `CATALOG_BEACH_SCENES` — beze změny (v4 nepoužívá).
- `useCallback` deps array — `catalogBeach`/`catalogModel`/`catalogPose`/`catalogFraming` zůstávají (v4 je nepoužívá ale nemusí se odebírat).
- Persona avatar auto-injection (`audience` → `reference_url`) — beze změny (v4 to využívá).
- `isHighWaistTummy` regex — beze změny.
- Žádné nové npm závislosti, žádná DB schema změna.

## Verifikace
1. `node --check api/creatives/generate.js && node --check lib/v4-prompt.js` → exit 0
2. `npm test` → 27/27 pass
3. `cd apps/dashboard && npm run build` → projde
4. Manuální (po deployi): Studio → vybrat **Product Catalog v4** → ověřit UI: jen **Reference model** dropdown + **Resolution** pily + **Count**. ŽÁDNÝ Pose, ŽÁDNÝ Beach scene, ŽÁDNÝ Framing, ŽÁDNÉ Aspect ratio. Bez avatara → Generate disabled + hláška. → vybrat avatara + 2K + 1× → Generate → výstup: editorial strobe-lit modelka, late golden hour beach pozadí, identita drží z avatara, swimsuit z produktu, navel skrytý (Isola). Vygenerovat 2-3× pro stabilitu.
5. Regrese: v1, v2, v3 fungují stejně jako dnes (UI, generace). Realistic Beach, ostatní styly nedotknutelné.
6. Edge: empty store (žádné avatary) → v4 hláška "No persona avatars yet — create one in the Avatars tab to use this style." Generate disabled.

## Pozn. / rizika
- **Délka promptu** ~7000 znaků (verbatim 6500 + 4-řádkový prefix + product title + ~600-znakový HIGH-WAIST blok). Recency bias bude proti product fidelity (svimsuit detaily) — návrh navíc by byl **PRODUCT LOCK** blok na úplný konec, ale uživatel chce verbatim a vědomě akceptuje riziko (~10-20 % šance "vygenerován jiný produkt" jako u v1).
- **"DIMENSIONAL BODY MODELING — soft shadows along the sides of the torso, under the bust line, on the inside of her arms, on the inner thighs"** v promptu (uživatelův text) může vést k bočním stínům na produktu. v4 nepoužívá náš anti-side-shadow safety (ten je inline v v1 promptu). Pokud se objeví → uživatel rozhodne (ladění promptu / přidat NEGATIVE termy / akceptovat).
- **Fáze tváří / catchlights / skin texture** — uživatel je popsal velmi detailně, **ale** Nano Banana Pro má variance. Některé generace nesplní detail (např. chybí catchlights). Tipuji ~70-80 % výstupů bude mít editorial-strobe look požadované kvality, zbytek bude "almost". Single-shot edit modely.
- v4 je **další styl, ne nahrazení** žádného existujícího. Studio bude mít teď 4 Product Catalog varianty (v1, v2, v3, v4). Když se v4 osvědčí, můžeme zvážit deprekaci některé z předchozích — ale to je samostatné rozhodnutí v budoucnu.
- `lib/v4-prompt.js` jako samostatný file kvůli čitelnosti — `generate.js` má 700+ řádků. Verbatim 6500-znakový string by ho dál zhuštil.

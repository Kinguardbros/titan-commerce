# Spec: Product Catalog (v1) — sjednotit UI s v3 + 4 Beach Scene varianty

> Datum: 2026-05-13 · Status: schváleno k implementaci · Scope: `apps/dashboard/src/components/CreativeStudio.jsx` + `api/creatives/generate.js` (v1 prompt větev) · NEsahá na v2, v3, Realistic Beach, PhotoStory

## Context — proč to děláme

Po několika iteracích máme tři Product Catalog varianty s nesourodým UI:
- **v1 "Product Catalog"** (současný stav): Reference model dropdown s `__preset__` fallbackem + 3 textové Model preset pily + Pose pily + 4 Framing pily + Count/Aspect ratio/Resolution. Hodně voleb, kterých dnes nikdo nepotřebuje — uživatel chce vždycky avatar, vždycky 3/4 framing, vždycky 4:5.
- **v2 "Product Catalog v2"** (golden hour): Reference model dropdown (povinný, bez `__preset__`) + Pose pily + Count/Resolution.
- **v3 "Product Catalog v3"** (double pipeline): Reference model (povinný) + Pose + **Beach scene** (4 varianty: Bright sunny / Golden hour / Dune grass / Rocky cove) + Count/Resolution.

Uživatel chce **v1 sjednotit s v3 UI**: stejné 4 sekce (Reference model povinný + Pose + Beach scene + Count + Resolution), žádný Framing, žádný textový Model preset, žádné Aspect ratio. Beach scene musí v v1 reálně **měnit lighting/scénu v promptu** (ne jen UI dekorace), protože v1 je single-shot generace — vše se rozhoduje v jednom promptu.

**Cíl:** v1 UI = v3 UI (1:1). Avatar povinný. 4 Beach scene varianty mění odpovídající části v1 promptu (scéna + lighting). Aspect ratio hardcoded 4:5, framing hardcoded 3/4 body (post-process crop). v2 a v3 zůstávají beze změny.

## Rozhodnutí (z brainstormingu)

- **v1 UI = v3 UI**: Reference model (avatar dropdown, povinný, bez `__preset__`, empty-state hláška) + Pose pily + Beach scene pily + Count + Resolution. Vyhozeno: Model preset pily, Framing pily, Aspect ratio.
- **Aspect ratio**: hardcoded `'4:5'` pro v1 (jako v2/v3).
- **Framing crop**: hardcoded `'three-quarter'` pro v1 → post-process `processCatalogImage` udělá crop z `metadata.framing_crop`. Žádný `[catalog_framing:...]` tag z frontendu.
- **Beach scene 4 varianty mění v1 prompt**: nový helper `lib/v1-beach-scenes.js` exportuje `buildV1BeachScene(sceneKey)` → vrátí `{ sceneLine, lightingLine }` k substituci na 2 místech v v1 promptu (řádek scény ~261 + shrnutí "LIGHTING — READ THIS" ~292). Default `'sunny'` = současný stav (zachovat working baseline).
- **Avatar povinný**: bez vybraného avatara → Generate disabled + hláška (jako v2/v3). Early-return guard v `handleGenImage`. Pro v1 už `audience: catalogAvatar` posíláme — backend ho dohledá v `persona_avatars` jako dnes.
- **`catalogModel` / `catalogFraming` state**: ponechat v `useState` (může se vrátit), ale **odstranit z UI**. `CATALOG_MODELS` / `CATALOG_FRAMINGS` konstanty zůstávají v souboru (mohou se hodit later).
- **Jeden commit** pro celou sjednocenou změnu (FE + BE), jasná zpráva, snadno revertnout.

## Změny

### Soubor: `apps/dashboard/src/components/CreativeStudio.jsx`

1. **`isProductCatalogStyle` flag** (render scope, ~ř. 522-524) — existuje jako lokální v `handleGenImage` (ř. 577), nikoli render scope. Přidat render-scope `const isProductCatalogStyle = imgStyle === "product-catalog";` vedle `isProductCatalogV2Style`/`isProductCatalogV3Style` — pro JSX gates.
2. **v1 UI blok (~ř. 858-901)** — kompletně přepsat. Stávající `{imgStyle === "product-catalog" && (<> Select s __preset__ + Model preset pily + Pose pily + Framing pily </>)}` → nové:
   ```jsx
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
   ```
3. **`customInstr` v1 ternár (~ř. 591-592)** — zjednodušit, nepoužívat `catalogModelLabel` z `CATALOG_MODELS` (vždy bude avatar), nepoužívat `catalog_framing` tag, **přidat `[catalog_beach:<key>]`** tag. Nová podoba (vsazená do ternáru za v2):
   ```js
   : isProductCatalogStyle
   ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
   ```
   (`catalogModelLabel` zůstává — pro v1 to teď bude vždy `catalogAvatar` ne-null, protože UI vyžaduje avatar. `catalogPosePrompt` se počítá pro všechny `isAnyCatalog` taky pro v1.)
4. **`generateCreatives` pole pro v1** (~ř. 600-614) — rozšířit existující ternáry `(isProductCatalogV2 || isProductCatalogV3)` na zahrnout `isProductCatalogStyle`:
   - `show_model: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? true : subject === "On model"` — pro catalog vždy on-model.
   - `text_overlay: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "none" : ...`
   - `overlay_text: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "" : ...`
   - `audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? (catalogAvatar || undefined) : ...` — už existuje, OK.
   - `aspect_ratio: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "4:5" : imgRatio` — přidat v1 do 4:5 hardcode.
   - `reference_url: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? undefined : colorRef` — pro v1 nepoužíváme colorRef (avatar je v `audience`).
5. **Early-return guard v `handleGenImage`** (~ř. 556) — rozšířit na v1:
   ```js
   if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
   ```
6. **Generate button disabled + hláška** (~ř. 1095-1107) — rozšířit z `(isProductCatalogV2Style || isProductCatalogV3Style)` na zahrnout v1: použít `isAnyCatalogStyle && !catalogAvatar` (sjednotí všechny tři v jednom check). Hláška a disabled styling stejné.
7. **Catalog Count/Resolution řádek (~ř. 1043)** — Aspect ratio sub-gate ze `!isProductCatalogV2Style && !isProductCatalogV3Style` rozšířit na `!isAnyCatalogStyle` (= Aspect ratio se nezobrazí pro žádný catalog style).
8. **`useCallback` deps array** (~ř. 622) — beze změny (`catalogBeach`, `catalogAvatar`, `catalogPose` už tam jsou; `catalogModel`/`catalogFraming` taky — nechat, ač je UI nepoužívá).

### Nový soubor: `lib/v1-beach-scenes.js`

```js
// Beach scene variants for Product Catalog v1 (single-shot generation).
// Each scene replaces two passages in the v1 prompt: the scene line (~api/creatives/generate.js:261)
// and the lighting summary line (~api/creatives/generate.js:292). 'sunny' is the working baseline.
const SCENES = {
  sunny: {
    sceneLine: 'She is barefoot on a real beach, standing on sand on a bright sunny day. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves on one side, soft dry sand with a few dune grasses / beach grass, a low dune line, and a bright BLUE sky with a few scattered soft white clouds and light haze near the horizon. A clear, warm, sunny beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real beach: you can see the sea, the waves, the sand, the dune grass, the blue sky with clouds.',
    lightingSummary: 'LIGHTING — READ THIS: natural frontal daylight on the model and product (the sun is behind the camera) — well-exposed and clearly readable, a natural balanced true-to-life exposure, NOT dim and NOT overexposed / blown out / washed out. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon, background holds full visible detail (NOT blown out to white, sand and sky NOT vaporised). Warm, clean grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black.',
  },
  golden: {
    sceneLine: 'She is barefoot on a real beach at golden hour, standing on sand. Behind her is a CLEARLY VISIBLE beach scene: calm sea with gentle waves on one side, soft dry sand with a few dune grasses catching the warm low light, a low dune line, and a soft warm-toned sky with a low sun BEHIND the camera (not in frame). A clear, warm, late-afternoon beach. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real beach at golden hour: you can see the sea, the warm-lit sand, the dune grass, the warm soft sky.',
    lightingSummary: 'LIGHTING — READ THIS: warm golden-hour daylight on the model and product (the sun is BEHIND the camera, low in the sky) — well-exposed and clearly readable, gentle warm grade, NOT dim and NOT overexposed / blown out. Soft warm directional light from the front. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Soft warm sky with low haze, background holds full visible detail (NOT blown out to white). Warm, clean grade with golden tones — NOT a heavy orange filter, NOT washed-out, NOT moody. Black fabric shows texture, not crushed black.',
  },
  dune: {
    sceneLine: 'She is barefoot on a real beach behind a sand dune, standing on soft dry sand. Behind her is a CLEARLY VISIBLE beach scene: a low sand dune with TALL BEACH GRASS framing her on both sides, glimpses of ocean and bright sky beyond the dune, soft dry sand under her feet. Bright midday daylight from the front. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real dune-beach scene: you can see the tall beach grass, the dune line, the soft sand, and the sea/sky beyond.',
    lightingSummary: 'LIGHTING — READ THIS: natural frontal daylight on the model and product (the sun is behind the camera) — well-exposed and clearly readable, a natural balanced true-to-life exposure, NOT dim and NOT overexposed / blown out / washed out. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright sky and dune grass in soft focus, background holds full visible detail (NOT blown out to white). Warm, clean grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody. Black fabric shows texture, not crushed black.',
  },
  cove: {
    sceneLine: 'She is barefoot on the soft sand and smooth pebbles of a quiet rocky cove, standing relaxed. Behind her is a CLEARLY VISIBLE scene: turquoise water with gentle small waves, smooth pebbles and pale sand under her feet, a soft cliff face in the bokeh behind her, bright natural daylight from the front. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real rocky cove: you can see the turquoise water, the pebbles, the soft cliff face.',
    lightingSummary: 'LIGHTING — READ THIS: natural frontal daylight on the model and product (the sun is behind the camera) — well-exposed and clearly readable, a natural balanced true-to-life exposure, NOT dim and NOT overexposed / blown out / washed out. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Turquoise water and soft cliff bokeh, background holds full visible detail (NOT blown out to white). Warm, clean grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody. Black fabric shows texture, not crushed black.',
  },
};
export function buildV1BeachScene(sceneKey) {
  return SCENES[sceneKey] || SCENES.sunny;
}
```

(Default `sunny` = doslova současný stav v1 promptu, takže neměníme funkční baseline pro nejčastější volbu.)

### Soubor: `api/creatives/generate.js`

1. **Import** `buildV1BeachScene`:
   ```js
   import { buildV1BeachScene } from '../../lib/v1-beach-scenes.js';
   ```
2. **Parsovat `[catalog_beach:<key>]` z `custom_prompt`** (poblíž ř. 94, vedle `v3BeachKey`):
   ```js
   const v1BeachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
   ```
   *Pozn.: `v3BeachKey` na ř. 96 už čte tu samou regex. Sjednotit: extrahovat **jeden** `beachKey` použitelný pro v1 i v3 — odstraní duplicitu.*
3. **`catalogFramingKey` (~ř. 99-101)** — pro v1 vždy `'three-quarter'` (frontend přestane posílat `[catalog_framing:...]` tag, ale chceme post-process crop). Změnit z:
   ```js
   const catalogFramingKey = isProductCatalog
     ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || null)
     : null;
   ```
   na:
   ```js
   const catalogFramingKey = isProductCatalog
     ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || 'three-quarter')
     : null;
   ```
   (Default `'three-quarter'` místo `null`, když `catalogFramingLabel` chybí v custom_prompt. Tag jednou možná zmizí, ale i pak crop poběží.)
4. **v1 prompt větev (~ř. 215-299)** — dvě substituce. Před `prompt = \`...\`` template literal:
   ```js
   const v1Scene = buildV1BeachScene(v1BeachKey);
   ```
   Pak v template literal:
   - **Scene line (~ř. 261)** — nahradit hardcoded "She is barefoot on a real beach, standing on sand on a bright sunny day. ..." větu interpolací `${v1Scene.sceneLine}`.
   - **Lighting summary (~ř. 292)** — nahradit hardcoded "LIGHTING — READ THIS: natural frontal daylight ..." větu interpolací `${v1Scene.lightingSummary}`.
   - Vše ostatní v v1 promptu (LIGHTING blok ~ř. 263-275, EXPOSURE/GARMENT, FACE QUALITY, CAMERA, NEGATIVE, framingBlock, atd.) — **beze změny**.
   - Pro `framingBlock` a `framingNegative` (~ř. 230-237) — zachovat jak jsou (default bude vždy `three-quarter`). `isThreeQuarter` se vyhodnotí z `poseAndFraming` textu — který frontend přestane posílat. → Potřeba pro v1 explicitně nastavit `isThreeQuarter = true` když není v `custom_prompt` "FRAMING:" pasáž. Konkrétně: pokud `framingSection` nic nevrátí, nastavit fallback `isThreeQuarter=true` jen pro v1, aby se `framingBlock` (s "BOTTOM EDGE at mid-calf") aktivoval. Implementační detail v plánu.
5. **`configMeta` (~ř. 595-621)** — `catalog_beach` z tagu se uloží automaticky? Aktuálně máme `catalogModelMatch`/`catalogPoseMatch`/`catalogFramingMatch`, ale `catalog_beach` ne. Přidat:
   ```js
   const catalogBeachMatch = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/);
   ...(catalogBeachMatch && { beach_scene: catalogBeachMatch[1].trim() }),
   ```

### Soubor: `lib/actions/creatives.js`

Beze změny. `poll_generations` čte `c.style === 'product_catalog'` pro post-process — `processCatalogImage` poběží s `meta.framing_crop = 'three-quarter'` (jak je dnes). v3 chain zůstává netknutý.

## Co se NEmění
- v2 "Product Catalog v2" a v3 "Product Catalog v3" UI ani backend — beze změny.
- Realistic Beach, PhotoStory, ostatní styly — beze změny.
- `lib/avatar-crop.js` `processCatalogImage` — beze změny.
- `lib/v3-beach-scenes.js` `buildV3BeachPrompt` — beze změny (v3 step 2 ji používá).
- `lib/fal.js`, `api/system.js`, `apps/dashboard/src/lib/api.js` — beze změny.
- `CATALOG_MODELS` / `CATALOG_FRAMINGS` arrays v `CreativeStudio.jsx` — zůstávají v souboru, jen se přestanou renderovat v UI pro v1.
- `catalogModel` / `catalogFraming` React state — zůstávají (mohou se hodit later), z useCallback deps mažeme ne.
- Persona avatar auto-injection (`audience` → `reference_url` lookup ~ř. 59 v `generate.js`) — beze změny.
- `isHighWaistTummy` / `catalogHighWaist` logika — beze změny (Isola = navel hidden).
- Žádné nové npm závislosti, žádná DB schema změna.

## Verifikace
1. `node --check api/creatives/generate.js && node --check lib/v1-beach-scenes.js` → exit 0
2. `npm test` → 27/27 pass
3. `cd apps/dashboard && npm run build` → projde
4. Manuální (po deployi): Studio → Product Catalog (v1) → ověřit UI:
   - 4 sekce: Reference model (dropdown), Pose pily, Beach scene pily, Count + Resolution. **Žádný** Model preset, **žádný** Framing, **žádné** Aspect ratio.
   - Bez vybraného avatara → Generate **disabled** + hláška "Select a reference model above to generate."
   - Empty-state: store bez avatarů → hláška "No persona avatars yet — create one in the Avatars tab to use this style."
   - Vybrat avatara + Hero Front + Bright sunny + 1× 2K → Generate → výstup: stejný jako dnes (světlá pláž, 3/4 framing, navel skrytý, identita avatara). Vercel log: `[generate]` má `catalog_beach: sunny` v metadata.
   - Přepnout na "Golden hour" → výstup: warm golden hour scene, modelka pořád z avatara, 3/4 framing, pupek skrytý.
   - "Dune grass" → scéna s vyššíma dunama a travou kolem modelky.
   - "Rocky cove" → turquoise water + cliff bokeh.
   - Vygenerovat 2-3× každou variantu — identita drží.
5. Regrese: v2 a v3 fungují beze změny (UI, generace).
6. Edge: `processCatalogImage` post-process — `framing_crop` v metadata = `'three-quarter'` i bez tagu z frontendu (díky default v `catalogFramingKey`); crop se aplikuje.

## Pozn. / rizika
- **Beach scene 4 varianty jsou nová prompt engineering práce.** `'sunny'` = doslova současný stav (žádné riziko), ale `'golden'` / `'dune'` / `'cove'` jsou neověřené. Možná bude potřeba doladění po prvních testech (typicky řádek scene + lighting summary, vše ostatní v promptu drží anti-side-light a anti-overexposure logiku — neměníme). Riziko nízké až střední.
- **Stávající `framingBlock` v promptu** — když z frontendu neposíláme `[catalog_framing:...]` tag a `poseAndFraming` text neobsahuje "FRAMING:" sekci, `framingSection.match` vrátí null → `framingText=''` → `isThreeQuarter=false` → `isNonFullFraming=false` → `framingBlock=''` → prompt nezmiňuje crop. Post-process to udělá deterministicky stejně, ale prompt model nebude vědět, že se má vejít do 3/4. Nejjistější fix: explicitně vložit `framingBlock` pro v1 (vždy 3/4) — viz §"Změny v generate.js" bod 4. Implementační detail v plánu.
- v1 prompt je v `CLAUDE.md` flagovaný jako "churned heavily / 5-of-10 sensitivity" → jeden commit, jasná zpráva, snadno revertnout.
- `CATALOG_MODELS` / `CATALOG_FRAMINGS` zachované — pokud později chce uživatel volbu vrátit, stačí přidat zpět JSX. Žádné riziko že se ztratí prompty.

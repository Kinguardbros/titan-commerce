# Spec: Product Catalog v2 — "Model preset" → "Reference model" (avatar, povinný)

> Datum: 2026-05-12 · Status: schváleno k implementaci · Scope: `apps/dashboard/src/components/CreativeStudio.jsx` + `api/creatives/generate.js` (úprava existující v2 větve) · NEsahá na v1

## Context — proč to děláme

Product Catalog v2 (golden hour, commit `824e9d8` + `cb83aa7`) má v UI 3 textové "Model preset" pily (Model 1/2/3) — popis modelky se vloží do promptu jako text. Uživatel chce místo toho **"Reference model"** — stejný persona-avatar picker, jako má stávající Product Catalog (v1): vybere se skutečné reference foto modelky, do Nano Banany jde avatar sandwich `[avatar, produkt, avatar]`, identita modelky drží napříč generacemi. Avatar je **povinný** — bez něj nejde generovat (žádný textový fallback v UI; `__preset__` volba z v1 se v v2 nepoužije).

**Cíl:** V Product Catalog v2 se "Model preset" pily nahradí "Reference model" avatar dropdownem (bez `__preset__`). Vybraný avatar se pošle jako `audience` → backend dohledá `reference_url` → v2 prompt přepne na "použij ženu z reference fotky" + sandwich `[avatar, produkt, avatar]`. Bez vybraného avatara je Generate disabled. UI v2: Reference model / Pose / Resolution / Count. v1 zůstává nedotčený.

## Rozhodnutí (z brainstormingu)
- **"Reference model" = avatar picker jako v1**, ale BEZ `__preset__` volby — avatar je povinný.
- **Bez avatara → Generate disabled** + hláška "Select a reference model". Store bez persona avatarů → dropdown prázdný, hláška "No persona avatars yet — create one in the Avatars tab", Generate disabled.
- **Textové Model presety se v v2 přestanou používat** (`CATALOG_MODELS` array zůstává — v1 ho používá).
- **Backend v2 prompt**: reaguje na `reference_url` — když je (avatar) → reference-roles blok + "model = žena z image 1"; když není (defensivní fallback, frontend to nedovolí) → zůstane hardcoded mid-size popis.
- **Jeden commit** (frontend + backend úprava v2 spolu).

## Změny

### Soubor: `apps/dashboard/src/components/CreativeStudio.jsx`

1. **v2 UI blok** (`{imgStyle === "product-catalog-v2" && (<>...</>)}`, ~ř. 890-911): nahradit "Model preset" pily za "Reference model" dropdown:
   - Pokud `personas.filter(p => p.reference_url).length > 0`: `<SectionLabel>Reference model</SectionLabel>` + `<Select value={catalogAvatar || ""} onChange={setCatalogAvatar} options={personas.filter(p => p.reference_url).map(p => p.name)} renderOption={(opt) => \`${opt} (${personas.find(p => p.name === opt)?.age || ""}) — ${personas.find(p => p.name === opt)?.label || "avatar"}\`} placeholder="Select a model…" />` — bez `"__preset__"` volby.
   - Pokud žádné avatary s `reference_url`: místo dropdownu `<div style={{ fontSize: 12, color: TEXT_MID }}>No persona avatars yet — create one in the Avatars tab to use this style.</div>`
   - Pod tím Pose pily zůstávají beze změny.
2. **`customInstr` pro v2** (~ř. 570): model už neposíláme textem → `\`[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}\`` (vypustit `${catalogModelPrompt}`; `catalogModelLabel = catalogAvatar || ''` — už nastaveno; tag `[catalog_model:avatarName]` ponechat pro metadata).
3. **`generateCreatives` pro v2** (~ř. 588-590): `audience: isProductCatalogV2 ? (catalogAvatar || undefined) : (isProductCatalogStyle ? (catalogAvatar || undefined) : (useAudience && audience !== "auto" ? audience : undefined))` — tj. v2 teď posílá `catalogAvatar` jako `audience` (dnes posílá natvrdo `undefined`). Ostatní v2 overrides (`show_model: true`, `text_overlay: "none"`, `aspect_ratio: "4:5"`, `reference_url: undefined`) beze změny.
4. **Generate button** (~ř. 1095-1100): přidat `(isProductCatalogV2Style && !catalogAvatar)` do `disabled`. Pod/vedle buttonem (jen když tahle podmínka): `<div style={{ fontSize: 11, color: TEXT_MID, marginTop: 4 }}>Select a reference model above to generate.</div>`. (`isProductCatalogV2Style` je render-scope konstanta, už existuje.)

### Soubor: `api/creatives/generate.js`

1. **Auto-inject avatar** (~ř. 59, `if (audience && !reference_url && store_id && style !== 'realistic_beach')`): `product_catalog_v2` tím projde (není `realistic_beach`) → `audience='avatarName'` dohledá `persona_avatars.reference_url` → nastaví `reference_url`. **Beze změny.**
2. **v2 prompt větev** (`else if (isProductCatalogV2)`): upravit tak, aby reagovala na `reference_url`. Místo statického začátku (`Use the swimsuit shown in the attached image as the exact reference garment. ... Professional e-commerce swimwear product photography. ${v2ModelDesc}`) — větvit:
   - Spočítat `const v2HasAvatar = !!reference_url;`
   - `v2GarmentLine` = `v2HasAvatar ? \`REFERENCE IMAGES — READ CAREFULLY: image 1 AND the last image = THE MODEL (the SAME woman, shown twice) — use her EXACT face, hair, skin tone, body shape, and age; she is the ONLY person, do not invent a different face. Any image in between = THE GARMENT — recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do NOT redesign or reinterpret it, and do NOT let the garment images influence the model's face.\` : \`Use the swimsuit shown in the attached image as the exact reference garment. Recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign, restyle, or reinterpret the swimsuit. The garment in the attached image is the product, replicate it exactly.\``
   - `v2ModelLine` = `v2HasAvatar ? \`Professional e-commerce swimwear product photography. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.\` : \`Professional e-commerce swimwear product photography. ${v2ModelDesc}\``
   - `prompt` template literal začne `${v2GarmentLine}\n\n${v2ModelLine}\n\n` a pak pokračuje verbatim `She is barefoot on a quiet beach at golden hour, ...` až `... 85mm lens at f/2.8, Canon R5 look, true-to-life skin texture and fabric texture.` (golden hour lighting, composition, garment rules, `${v2PoseText}` — beze změny).
   - `v2ModelDesc` / `v2PoseText` parsování (z `custom_prompt`) — beze změny; `v2ModelDesc` se použije jen ve fallbacku (bez avatara). Pozn.: v2 `customInstr` z frontendu už neposílá model text před `POSE:` (krok 2 frontendu), takže `v2ModelDesc` parse vrátí prázdno → padne na hardcoded fallback default — což je správně pro defensivní case.
3. **`refImages`** (~ř. 437, `(isProductCatalog || isProductCatalogV2) ? (avatarRef ? [avatarRef, ...images.slice(0,1), avatarRef] : images.slice(0,1)) : ...`): pro v2 s `avatarRef` (= `reference_url`) → `[avatar, 1 produkt, avatar]`. **Beze změny.**
4. **`falPrompt`** (~ř. 459, `(isProductCatalog || isProductCatalogV2) ? prompt : ...`): v2 prompt self-contained. **Beze změny.**
5. **`configMeta`** (~ř. 506-536): `catalog_model` z `[catalog_model:avatarName]` tagu, `audience` z `...(audience && { audience })` — uloží jméno avatara. **Beze změny.**

## Co se NEmění
- v1 "Product Catalog" — beze změny (avatar `__preset__` + Model presety + Framing pily + post-process crop/brightness)
- `processCatalogImage` / `poll_generations` — beze změny (v2 pořád nemá post-process — `c.style === 'product_catalog'` jen)
- `CATALOG_MODELS` array — zůstává (v1 ho používá)
- Realistic Beach, ostatní styly, `lib/avatar-crop.js`, `lib/higgsfield.js`, `apps/dashboard/src/lib/api.js` — beze změny
- Žádné nové npm závislosti, žádná DB/schema změna

## Verifikace
1. `node --check api/creatives/generate.js` → exit 0
2. `npm test` → 27/27 pass
3. `cd apps/dashboard && npm run build` → projde (jen pre-existující ESLint noise)
4. Manuální (po deployi): Studio → Product Catalog v2 → ověřit: UI ukáže **Reference model** (avatar `Select` dropdown, NE 3 Model preset pily) / Pose pily / Resolution / Count. Bez vybraného avatara → Generate button **disabled** + hláška "Select a reference model above to generate." → vybrat avatara + pózu + rozlišení + počet → Generate → výstup: golden-hour pláž, **modelka = ten vybraný persona avatar** (jeho tvář, tělo, vlasy), póza odpovídá, swimsuit z produktové reference fotky, 4:5 vertikální, vysokopáskové spodní díly s zakrytým pupkem (garment rules v promptu). Vygenerovat 2-3× s 2 různými avatary → identita drží napříč generacemi.
5. Regrese: vybrat stávající "Product Catalog" (v1) → ověřit, že funguje beze změny (Reference model dropdown s `__preset__` volbou, Model preset pily, Pose pily, Framing pily, Count/Aspect/Resolution řádek, post-process crop/brightness).
6. Edge: store bez žádných persona avatarů → v2 UI ukáže hlášku "No persona avatars yet — create one in the Avatars tab", Generate disabled.

## Pozn. / rizika
- Backend v2 prompt teď má dvě cesty (s avatarem / bez) — fallback bez avatara je defensivní (frontend ho nedovolí), drží generaci funkční kdyby někdo zavolal API přímo bez avatara.
- Sdílení `catalogAvatar` state mezi v1 a v2: vždy aktivní jen jeden styl → OK (už to tak je).
- Avatar sandwich `[avatar, produkt, avatar]` pro v2 je identický jako pro v1 — osvědčený pattern (identity lock mezi headless product crops).
- v2 `customInstr` po změně neobsahuje žádný model text → `v2ModelDesc` parse vrátí prázdno → hardcoded fallback default. To je v pořádku — fallback se stejně použije jen když není avatar.

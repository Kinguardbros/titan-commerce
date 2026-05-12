# Spec: Product Catalog — sladit výstup s referenční fotkou (čelní soft slunce)

> Datum: 2026-05-12 · Status: schváleno k implementaci · Scope: jen `api/creatives/generate.js` (Product Catalog prompt blok)

## Context — proč to děláme

Kolega (Ondra) poslal referenční fotku jako cíl, jak by měl Product Catalog výstup vypadat (Isola, plus-size modelka v černém bikiny + hoodie cover-up na pláži). Klíčové pozorování po rozboru referenčky:

- **Lighting:** jemné **čelní sluneční světlo** — slunce ZA kamerou, te lehce nasvícený produkt, **teploulčký nádech** na vlasech a pokožce, **měkké přirozené stíny** (jemný stín pod bradou, za paží), jasná **modrá obloha s pár reálnými soft mraky**, lehký opar u horizontu. Grade je **teplý, čistý, lehce jasný** — sun-kissed.
- **NENÍ to** ostrý boční golden-hour stín ani plochý "studiový softbox bez stínů a bez slunce".
- **Background:** rozpoznatelná pláž — moře s vlnami na jedné straně, suchý písek + dunová tráva, nízká duna, shallow DOF, modelka tack sharp.
- **Camera:** eye-level, spíš mírně shora; ~head-to-mid-thigh záběr; vysoký portrét (~2:3 / 3:4).
- **Pose:** stojí čelem ke kameře, lehký kontrapost, jedna ruka lehce drží cover-up; teplý měkký úsměv, oční kontakt.

**Tension, který tahle změna vědomě řeší:** Současný Product Catalog prompt byl po 12+ iteracích vyladěn na **opak** referenčky — "žádné viditelné slunce, plochý softbox, nulové směrové stíny, studená high-key" — protože dřív byl problém **ostrý boční** golden-hour stín na produktu. Referenčka má slunce, ale **čelní a měkké** → ten dřívější problém (boční stín) nemá. Takže: otevřeme "slunce ZA kamerou" zpátky, **ale ponecháme anti-side-light NEGATIVE termy**.

**Cíl:** Při konkrétním nastavení ve Studiu (viz §"Doporučené nastavení") generuje Product Catalog výstup vizuálně blízký referenčce — bright čelní slunce, teplý čistý grade, modrá obloha s mraky, rozpoznatelná pláž, eye-level kamera, ne plochý softbox a zároveň ne ostrý boční stín na produktu.

## Rozhodnutí (z brainstormingu)
- **Slunce:** ANO — přepnout prompt na jemné čelní slunce (slunce za kamerou, měkké přirozené stíny, teplý tón, modrá obloha s mraky). Anti-side-light NEGATIVE termy zachovat.
- **Match:** ladit pro **konkrétní nastavení** (Pose=Hero Front, Framing=3/4 body, …) — viz §Doporučené nastavení.
- **Modelka:** beze změny — zůstává na uživateli (vybraný avatar / Model preset). Žádný nový Model preset. Pro nejbližší match doporučit Model 1 "Everyday" (když avatar není) nebo avatar podobný referenčce.
- **Warm grade:** řešit **jen v promptu**. Post-process `processCatalogImage` (sharp) beze změny — jen brightness lift, žádný warm tint.
- **Frontend `CreativeStudio.jsx`:** beze změny. Žádný nový pill, žádný nový preset, žádná změna `customInstr` formátu / `[catalog_*]` tagů (to rozbilo commit `117ad51`).
- **Post-process / `CROP_FRACTIONS` / npm deps:** beze změny.

## Změny

### Soubor: `api/creatives/generate.js` — `if (isProductCatalog)` blok (~ř. 246-288)

Lighting o světle se dnes opakuje na 3 místech (`=== LIGHTING ===` blok ~ř. 255-263, věta o pozadí ~ř. 252, `LIGHTING — READ THIS` ~ř. 283). Sjednotit na jeden konzistentní popis čelního soft slunce:

**1. Věta o pozadí / scéně (~ř. 252)** — přepsat na pláž s prvky z referenčky:
- ocean with gentle waves on one side; soft dry sand with a few dune grasses / beach grass; a low dune line; bright BLUE sky with a few scattered soft white clouds; light haze at the horizon. Background softly out of focus (shallow DOF), model tack sharp. Unmistakably a real beach — NOT a featureless white blur, NOT studio fog, NOT heavy grey overcast.

**2. `=== LIGHTING — READ CAREFULLY ===` blok (~ř. 255-263)** — přepsat:
- **SKY:** bright clear BLUE sky with a few real, soft, white clouds; light haze near the horizon. NOT a cloudless hard sky, NOT a heavy grey overcast.
- **SUN / LIGHT ON THE MODEL:** bright natural daylight, **the sun is BEHIND the camera (frontal)** — the model and the product are lit EVENLY FROM THE FRONT, bright and fully readable. The light has a subtle warm / golden quality (late-morning real sun, lightly hazy). Only SOFT NATURAL shadows — a gentle shadow under the chin, a soft shadow behind the arm. There is **NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow on the sand.** (Soft frontal sun ≠ harsh side sun — keep it frontal and gentle.)
- **EXPOSURE / GARMENT:** ZACHOVAT stávající text (produkt bright, černá látka čitelná texturou ne crushed black, dolní polovina stejně jasná jako horní, zero shadows on the swimsuit). Funguje — neměnit.
- **GRADE:** warm, clean, slightly bright — sun-kissed skin and hair, true-to-life colors. NOT a cool / grey / blue grade, NOT a heavy orange filter, NOT washed-out, NOT flat lifeless lighting.

**3. `LIGHTING — READ THIS` shrnutí (~ř. 283)** — sladit s výše: jednou větou "bright natural daylight, sun behind the camera (frontal), soft natural shadows only — no hard side-lit shadow on the product, blue sky with a few soft clouds, warm clean grade, product bright and fully readable, black fabric shows texture not crushed black."

**4. `NEGATIVE:` řádek (~ř. 288)** — úpravy:
- **ODSTRANIT** (tyhle teď brání i tomu, co chceme — slunce je v referenčce žádané): `direct hard sunlight, blazing visible sun, harsh sunbeam, cloudless hard sunny day, golden hour, sunset, sunrise, low-angle sun`. (`side-angle sun` a `side lighting` se NEodstraňují — viz "PONECHAT".)
- **PONECHAT** (jádro ochrany proti dřívějšímu problému): `side lighting, side-angle sun, hard cast shadow, directional shadow, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, dark areas on the garment, swimsuit lost in shadow, underlit swimsuit, crushed blacks, garment crushed to pure black, dramatic lighting, moody lighting, dim, dark photo, underexposed, heavy grey overcast, gloomy dark sky, heavy orange filter` + (z minulého commitu) `low-angle shot, shot from below, worm's-eye view, upward camera angle, distorted perspective, foreshortened legs` + ostatní (blown-out white background, featureless white background, plastic skin, AI face, slim body, flat stomach, …).
- **PŘIDAT:** `washed-out colors, flat lifeless lighting, cool blue grade`.

**Beze změny v tom bloku:** `poseAndFraming`, `framingBlock` / `framingNegative`, `CAMERA:` věta (~ř. 279 — už řeší podhled, sedí s referenčkou), `FACE QUALITY` blok, `Hyperrealistic … 85mm … 8K` řádek, `isHighWaistTummy` blok, `catalogReferenceRules` / `catalogModelLine` / `catalogFinalCheck` (identita), aspect ratio handling, `configMeta`.

**Beze změny mimo ten blok:** Realistic Beach, ostatní styly, Bulk Generate, branded content, avatar flow, sandwich pattern, image filtering, `lib/avatar-crop.js`, `lib/actions/creatives.js`, frontend.

## Doporučené nastavení ve Studiu pro nejbližší match (návod pro tým — není to kód)
- **Style:** Product Catalog
- **Avatar:** ideálně avatar podobný referenčce (kudrnatá blond plus-size ~30, přirozený makeup); když avatar není vybraný → **Model preset = "Model 1 (38) Everyday"** (nejblíž; Model 2 je moc slim, Model 3 starší)
- **Pose:** "Hero Front" (stojí čelem, lehký kontrapost — přesně referenčka)
- **Framing:** "3/4 body" (nově 0.90 crop ≈ head-to-mid-calf; referenčka je head-to-mid-thigh — 3/4 je nejblíž; "Waist up" by uřízlo víc)
- **Resolution:** 2K (default)
- **Aspect ratio:** pokud UI nabízí, vysoký portrét (4:5 default je OK, blízko 3:4)

(Pokud by tým chtěl "Hero Front + 3/4 body" jako default pro Product Catalog, je to drobná frontend změna — mimo scope téhle spec.)

## Verifikace
1. `node --check api/creatives/generate.js` → exit 0
2. `npm test` → 27/27 pass (žádná test/routing změna)
3. Manuální (po deployi): Studio → Product Catalog → nastavení dle §Doporučené nastavení → Generate 3-4× → porovnat s referenčkou:
   - (a) bright čelní sluneční světlo, teploulčký nádech na pokožce/vlasech, NE plochý softbox, NE studený grey grade
   - (b) jen měkké přirozené stíny, ŽÁDNÝ ostrý boční / směrový stín na produktu ani na písku
   - (c) modrá obloha s pár soft mraky, rozpoznatelná pláž (moře, vlny, písek, dunová tráva), lehký opar u horizontu
   - (d) eye-level kamera, NE podhled; ~head-to-mid-calf záběr (3/4)
   - (e) produkt (černý plavkový set) bright a plně čitelný, černá látka s texturou ne crushed black
   - (f) identita modelky odpovídá vybranému avataru / presetu (beze změny)
4. Edge / regrese: kdyby se vrátil ten dřívější ostrý **boční** stín na produktu → couvnout — zesílit `side lighting` / `side-angle sun` / `hard cast shadow` v NEGATIVE a/nebo přitvrdit "the sun is BEHIND the camera, frontal, never to the side" v LIGHTING bloku. (Necouvat na celý "no visible sun" — ten byl moc daleko.)
5. Poslat výsledek Ondrovi na porovnání s referenčkou.

## Pozn. / rizika
- Product Catalog lighting prompt je v `CLAUDE.md` flagovaný jako "churned heavily, sensitive (5/10)". Tahle změna je **vědomý pivot směru** (ne fine-tuning) — půjde jako **samostatný commit** s jasnou zprávou, aby se dal v gitu snadno revertnout, kdyby se vrátil boční-stín problém.
- Žádné nové npm závislosti, žádná DB/schema/routing změna, žádná frontend změna.

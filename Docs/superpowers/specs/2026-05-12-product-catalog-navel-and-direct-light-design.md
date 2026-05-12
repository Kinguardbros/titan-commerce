# Spec: Product Catalog — skrýt pupek (Isola always-on) + víc světla na produkt (direct frontal sun)

> Datum: 2026-05-12 · Status: schváleno k implementaci · Scope: `api/creatives/generate.js` (Product Catalog blok + store load) + `lib/avatar-crop.js` (post-process konstanty)

## Context — proč to děláme

Po commitu `bdc4136` (frontal soft-sun pivot) je Product Catalog výstup výrazně blíž referenční fotce — jasné čelní slunce, teplý grade, modrá obloha s mraky, rozpoznatelná pláž, eye-level kamera, produkt čitelný. Zbývají dvě připomínky od uživatele na poslední vygenerované fotce (Isola, plus-size modelka v černém high-waist bikiny):

1. **Pupek je pořád vidět** — high-waist tummy-control bottom, ale pásek model dotáhl moc nízko / pupek vykukuje nad hranou. `isHighWaistTummy` se detekuje z **názvu produktu** regexem (`tummy.?control|high.?wais?t|high.?rise|ruched|shirr|sculpt|...`) — buď název neprošel, nebo prošel a model přesto kopíruje pozici pásku z reference foto (kde pupek často vykukuje). Isola je ale CELÁ tummy-control swimwear (CLAUDE.md: "Isola — tummy-control swimwear, US, USD"). → "Pupek určitě nesmí být vidět."
2. **Produkt je zase moc tmavý** — uživatel chce víc světla, **přímé slunce přímo na produkt**. Současný stav: prompt říká "frontal SOFT sun", post-process v `processCatalogImage` lift +10 % / shadow +6. Nestačí to.

**Cíl:** (a) Pupek je na Product Catalog výstupech Isola produktů spolehlivě skrytý (pásek u přirozeného pasu). (b) Produkt je výrazně světlejší — vypadá jako nasvícený přímým čelním sluncem, ne tmavý. Bez návratu dřívějšího ostrého **bočního** stínu na produktu (ten byl od *bočního* slunce; čelní přímé slunce boční stín nedělá — referenčka má taky dost přímé čelní slunce).

## Rozhodnutí (z brainstormingu)
- **Pupek:** high-waist blok se zapne POKAŽDÉ, když je Product Catalog na Isola storu (bez ohledu na název produktu) — `(isProductCatalog && isIsola) || isHighWaistTummy`. Navíc přitvrdit text high-waist bloku ("pásek VÝŠE než na reference foto, až k přirozenému pasu"). Mimo Product Catalog (non-catalog `isTummyControl` cesta) — beze změny, zůstává na názvu.
- **Světlo na produkt:** OBOJÍ — (A) zesílit deterministický brightness lift v `processCatalogImage` (1.1 → 1.18, shadow 6 → 13), (B) přepsat lighting prompt z "frontal SOFT sun" na "bright DIRECT frontal sun, full sunlight on the swimsuit". Anti-side-light NEGATIVE termy zachovat.
- **NENECHÁVAT** se zpět vrátit do NEGATIVE: `golden hour / sunset / sunrise / blazing visible sun / cloudless hard sunny day` (ty brání oblohu/scénu).
- **Beze změny:** `CROP_FRACTIONS`, pose/framing/camera-věta/FACE QUALITY/identita/aspect ratio, `poll_generations` mechanika (jen volá `processCatalogImage`), Realistic Beach, ostatní styly, non-catalog `isTummyControl`, Bulk Generate, frontend. Žádné nové npm závislosti.

## Změny

### Soubor: `api/creatives/generate.js`

**1. Načíst store name + spočítat `isIsola` (~ř. 81-86)**
- V `if (store_id)` blocku do selectu přidat `name` (vedle `shopify_url`).
- Po načtení store: `const isIsola = (store?.name || '').toLowerCase().includes('isola');` (definovat tak, aby bylo v scope pro pozdější použití — pokud `store` je v blokovém scope, vytáhnout `isIsola` výš nebo přesunout výpočet níž; engineer to vyřeší podle aktuální struktury).

**2. Catalog high-waist podmínka (~ř. 95-97 nebo poblíž)**
- Ponechat `const isHighWaistTummy = /tummy.?control|.../i.test(titleLower);` jak je (používá ho non-catalog `isTummyControl` na ř. 324 — nedotýkat se).
- Přidat: `const catalogHighWaist = (isProductCatalog && isIsola) || isHighWaistTummy;`

**3. Product Catalog prompt — high-waist blok (~ř. 271)**
- Místo `${isHighWaistTummy ? \`...\` : ''}` použít `${catalogHighWaist ? \`...\` : ''}`.
- **Přitvrdit text bloku** — přidat (do stávajícího "=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===" bloku) větu: *"The waistband sits NOTICEABLY HIGHER than in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The belly button is buried several centimetres BELOW the fabric edge, fully covered. If you see ANY skin of the navel area, the waistband is too low — raise it higher."* (Důvod: edit model jinak kopíruje pozici pásku z reference foto.)

**4. Product Catalog prompt — NEGATIVE high-waist termy (~ř. 290)**
- Místo `${isHighWaistTummy ? '...' : ''}` použít `${catalogHighWaist ? '...' : ''}`.
- Ke stávajícím high-waist NEGATIVE termům (`visible belly button, exposed navel, partially visible navel, peek of belly button, gap above the waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach`) přidat: `navel showing above the waistband, low-set waistband`.

**5. Product Catalog prompt — lighting přepis na direct frontal sun (~ř. 254-265 + shrnutí ~ř. 285)**
- `=== LIGHTING ===` blok, sekce **LIGHT ON THE MODEL** (~ř. 258) — přepsat: *"bright DIRECT sunlight — the sun is up and shining DIRECTLY ON HER FROM THE FRONT (the sun is behind the camera). The model and the swimsuit are in FULL bright sunlight, brilliantly lit, every detail blazing-clear and high-key. The light has a subtle warm quality (real midday-to-late-morning sun). Only SOFT NATURAL shadows from that frontal direction — a gentle shadow under the chin, a soft shadow tucked behind an arm. There is NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow streaking across the sand. DIRECT FRONTAL sun — never side-lit, never from the side."*
- Sekce **THE GARMENT** (~ř. 262) — zesílit první větu: *"the SWIMSUIT is hit by direct front sunlight and is BRIGHT — fully, brilliantly lit, never dim, never grey-flat; every part crisply readable. Black fabric reads as a bright dark grey-black with all the ribbed / pleated texture catching the light — NOT crushed to a flat black silhouette."* (Zbytek věty o exposure / lower half / scene-consistency note — ponechat, jen sjednotit "sun behind the camera" formulaci.)
- Sekce **SKY** a **GRADE** — ponechat (modrá obloha s mraky, warm clean grade).
- Shrnutí "LIGHTING — READ THIS" (~ř. 285) — sladit: *"bright DIRECT frontal sunlight on the model and product (sun behind the camera) — the swimsuit is in full bright sun, brilliantly lit, every detail readable. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon. Warm, clean, slightly bright grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black."*
- **NEGATIVE** (~ř. 290) — NEpřidávat zpět anti-sun termy. Ponechat všechny anti-side-light termy (`side lighting, side-angle sun, hard cast shadow, directional shadow, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, ...`) + `washed-out colors, flat lifeless lighting, cool blue grade`. Beze změny.

### Soubor: `lib/avatar-crop.js`

**6. Zesílit brightness lift konstanty**
- `const BRIGHTNESS_MULT = 1.1;` → `1.18` (~+18 % expozice)
- `const SHADOW_LIFT = 6;` → `13` (zvednout černý bod ~13/255 — na černé látce má lift největší dopad)
- Aktualizovat komentář ("stronger lift — the product was still landing too dark on black garments").
- Funkce `processCatalogImage` jinak beze změny.

## Verifikace
1. `node --check api/creatives/generate.js && node --check lib/avatar-crop.js` → exit 0
2. `npm test` → 27/27 pass (žádná test/routing změna)
3. (Volitelné, lokálně) sharp test: 600×1000 šedý obrázek (r/g/b=80) → `processCatalogImage(buf, 'three-quarter')` → ověřit, že mean jasu výstupu je výrazně vyšší než vstup (s 1.18/13 ≈ 80→107) a rozměr 600×900 jpeg.
4. Manuální (po deployi): Studio → Product Catalog → **Isola** produkt → avatar podobný referenčce / Model preset "Model 1 (38) Everyday" → Pose "Hero Front" → Framing "3/4 body" → 2K → Generate 3-4×:
   - (a) **pupek NENÍ vidět** — pásek sedí u přirozeného pasu, žádná holá kůže navel area nad hranou
   - (b) produkt **výrazně světlejší** než předchozí generace — vypadá nasvícený přímým čelním sluncem, černá látka s viditelnou ribbed/pleated texturou, ne tmavá
   - (c) přímé čelní slunce, jen měkké přirozené stíny — ŽÁDNÝ ostrý **boční** stín na produktu ani na písku
   - (d) modrá obloha s pár soft mraky, rozpoznatelná pláž — pozadí **NE přepálené** do bílé
   - (e) eye-level kamera (ne podhled), identita modelky beze změny
5. Edge / regrese:
   - přepálené světlé partie pozadí (písek, obloha bílá) → snížit `BRIGHTNESS_MULT` na 1.14, `SHADOW_LIFT` na 10
   - vrátil se ostrý **boční** stín na produktu → přitvrdit `side lighting` / `side-angle sun` / `hard cast shadow` v NEGATIVE + zesílit "the sun is behind the camera, frontal, never to the side" v LIGHTING bloku (NEcouvat na "no visible sun")
   - pásek moc vysoko (kdyby existoval ne-vysokopáskový Isola produkt — nemá) → tolerovat / zúžit `isIsola` always-on jen na vybrané product_type
6. Poslat výsledek Ondrovi / uživateli na porovnání s referenčkou.

## Pozn. / rizika
- Product Catalog lighting prompt je v `CLAUDE.md` flagovaný jako "churned heavily, sensitive (5/10)". Jdeme **dál po směru** nastoleném `bdc4136` (víc světla), ne reverz — ale jako samostatný commit s jasnou zprávou, snadno revertnout.
- `(isProductCatalog && isIsola)` always-on high-waist: Isola nemá ne-vysokopáskový sortiment, takže bezpečné. Kdyby přibyl, řešit zúžením.
- Žádná DB/schema/routing/frontend změna. Žádné nové npm závislosti.

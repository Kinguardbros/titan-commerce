# Product Catalog — Hide Navel (Isola Always-On) + Direct Frontal Sun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Product Catalog generations: (1) reliably hide the model's navel for all Isola products (high-waist tummy-control prompt block fires whenever the store is Isola, not just on title-regex matches, plus stronger "waistband higher than the reference photo" wording); (2) brighten the product — stronger deterministic brightness lift in `processCatalogImage` and a lighting-prompt pivot from "frontal soft sun" to "bright direct frontal sun, full sunlight on the swimsuit", keeping the anti-side-light NEGATIVE terms.

**Architecture:** Two files. `api/creatives/generate.js` — load the store `name` (to know it's Isola), add a `catalogHighWaist` flag = `(isProductCatalog && isIsola) || isHighWaistTummy`, use it in the Product Catalog prompt's high-waist block + NEGATIVE terms, strengthen that block's text, and rewrite the three lighting passages to direct frontal sun. `lib/avatar-crop.js` — bump two constants (`BRIGHTNESS_MULT` 1.1→1.18, `SHADOW_LIFT` 6→13). No new files, no new deps, no DB/routing/frontend changes. Prompt content has no automated test — verification is `node --check`, `npm test` (regression), grep checks, and an optional local `sharp` brightness check.

**Tech Stack:** Node.js (Vercel serverless), `sharp`, Vitest (existing 27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-12-product-catalog-navel-and-direct-light-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — that's not a git repo). The repo is on branch `main` and the user deploys via Vercel on push — this is intentional.

---

## File Structure

- **Modify:** `api/creatives/generate.js` — store load (~line 84), `catalogHighWaist` flag near the existing `isHighWaistTummy` (~line 97), Product Catalog prompt: high-waist block (~line 271), lighting passages (~lines 258, 262, 285), NEGATIVE line (~line 290).
- **Modify:** `lib/avatar-crop.js` — two constants (~lines 17-18) + comment.
- **Unchanged:** everything else — `lib/actions/creatives.js`, the non-catalog `isTummyControl` path (line ~324), Realistic Beach branch, all other styles, `CROP_FRACTIONS`, `processCatalogImage` function body, `package.json`, frontend.

All edits are in one logical change (navel + lighting both target "make this look like the reference"); they go in one task and one commit.

---

### Task 1: Hide navel for Isola + direct frontal sun

**Files:**
- Modify: `api/creatives/generate.js`
- Modify: `lib/avatar-crop.js`

**Context for the engineer:** `api/creatives/generate.js` builds a giant prompt string for fal.ai's Nano Banana `/edit` image model in the `if (isProductCatalog)` branch (around line 206-290). `lib/avatar-crop.js`'s `processCatalogImage(buf, framingKey)` is called by `poll_generations` (in `lib/actions/creatives.js`) after generation completes — it crops the finished image to the chosen framing and applies a brightness lift. The Nano Banana edit model copies cues from the prompt text and from reference images; it tends to render the swimwear waistband roughly where the *product reference photo* shows it (so high-waist prompting is fighting the reference — hence the "raise it HIGHER than the reference" wording). The store is Isola, which is entirely tummy-control swimwear, so the navel must always be hidden on Isola Product Catalog shots. Make ONLY the changes below. Do not touch the non-catalog `isTummyControl` path (line ~324), Realistic Beach, other styles, `CROP_FRACTIONS`, the `processCatalogImage` function body, or the frontend.

#### Part A — `api/creatives/generate.js`

- [ ] **Step 1: Load the store `name` and compute `isIsola`**

Read lines 81-86 to confirm they currently are:
```js
    // If store_id provided, load store for store-specific shopify_url
    let storeShopifyUrl = null;
    if (store_id) {
      const { data: store } = await supabase.from('stores').select('shopify_url').eq('id', store_id).single();
      if (store) storeShopifyUrl = store.shopify_url;
    }
```

Use the `Edit` tool. `old_string`:
```
    // If store_id provided, load store for store-specific shopify_url
    let storeShopifyUrl = null;
    if (store_id) {
      const { data: store } = await supabase.from('stores').select('shopify_url').eq('id', store_id).single();
      if (store) storeShopifyUrl = store.shopify_url;
    }
```
`new_string`:
```
    // If store_id provided, load store for store-specific shopify_url + name (Isola = all tummy-control)
    let storeShopifyUrl = null;
    let isIsola = false;
    if (store_id) {
      const { data: store } = await supabase.from('stores').select('shopify_url, name').eq('id', store_id).single();
      if (store) {
        storeShopifyUrl = store.shopify_url;
        isIsola = (store.name || '').toLowerCase().includes('isola');
      }
    }
```

- [ ] **Step 2: Add the `catalogHighWaist` flag next to `isHighWaistTummy`**

Read line 97 to confirm it currently is:
```js
    const isHighWaistTummy = /tummy.?control|high.?wais?t|high.?rise|high.?cut|ruched|shirr|sculpt|shaping|control.?brief|retro.?(high|wais?t)|vintage.?(high|wais?t)|tankini/i.test(titleLower);
```

Use the `Edit` tool. `old_string`:
```
    const isHighWaistTummy = /tummy.?control|high.?wais?t|high.?rise|high.?cut|ruched|shirr|sculpt|shaping|control.?brief|retro.?(high|wais?t)|vintage.?(high|wais?t)|tankini/i.test(titleLower);
```
`new_string`:
```
    const isHighWaistTummy = /tummy.?control|high.?wais?t|high.?rise|high.?cut|ruched|shirr|sculpt|shaping|control.?brief|retro.?(high|wais?t)|vintage.?(high|wais?t)|tankini/i.test(titleLower);
    // Product Catalog on the Isola store is always tummy-control → always hide the navel.
    const catalogHighWaist = (isProductCatalog && isIsola) || isHighWaistTummy;
```

(Note: `isProductCatalog` is defined on line 89, `isIsola` on Step 1, `isHighWaistTummy` on line 97 — all in scope by line 98.)

- [ ] **Step 3: Use `catalogHighWaist` in the high-waist block + strengthen its text (line ~271)**

Read line 271 to confirm it currently is (one long line):
```js
Garment: Fabric smooth, zero bunching. Match reference exactly.${isHighWaistTummy ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button (the navel is several centimetres BELOW the top edge of the fabric, fully buried under it). The belly button is COMPLETELY, ENTIRELY covered — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If ANY part of the belly button or navel area is visible, the garment is WRONG — raise the waistline higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}
```

Use the `Edit` tool. `old_string` (exact, the whole line):
```
Garment: Fabric smooth, zero bunching. Match reference exactly.${isHighWaistTummy ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button (the navel is several centimetres BELOW the top edge of the fabric, fully buried under it). The belly button is COMPLETELY, ENTIRELY covered — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If ANY part of the belly button or navel area is visible, the garment is WRONG — raise the waistline higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}
```
`new_string` (exact, the whole line):
```
Garment: Fabric smooth, zero bunching. Match reference exactly.${catalogHighWaist ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━` : ''}
```

- [ ] **Step 4: Use `catalogHighWaist` in the NEGATIVE high-waist terms + add two terms (line ~290)**

Line 290 is one long line. The high-waist NEGATIVE fragment is `${isHighWaistTummy ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, gap above the waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : ''}`. Use the `Edit` tool with `old_string`:
```
${isHighWaistTummy ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, gap above the waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : ''}
```
`new_string`:
```
${catalogHighWaist ? 'visible belly button, exposed navel, partially visible navel, peek of belly button, navel showing above the waistband, gap above the waistband, low-set waistband, bare midriff, low-rise bottoms, mid-rise bottoms, low-waist cut, exposed stomach, ' : ''}
```

- [ ] **Step 5: Rewrite the `LIGHT ON THE MODEL` lighting passage → direct frontal sun (line ~258)**

Use the `Edit` tool. `old_string` (exact, the whole line 258):
```
LIGHT ON THE MODEL: bright natural daylight. The SUN IS BEHIND THE CAMERA — a frontal light source — so the model and the swimsuit are lit EVENLY FROM THE FRONT, bright and fully readable. The light has a subtle warm, slightly golden quality (late-morning real sun, lightly hazy) — not harsh, not glaring. Only SOFT NATURAL shadows: a gentle shadow under the chin, a soft shadow tucked behind an arm. There is NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow streaking across the sand. Frontal soft sun — never side-lit, never harsh.
```
`new_string`:
```
LIGHT ON THE MODEL: bright DIRECT sunlight — the sun is up and shining DIRECTLY ON HER FROM THE FRONT (the sun is behind the camera). The model and the swimsuit are in FULL bright sunlight, brilliantly lit, every detail blazing-clear and high-key. The light has a subtle warm quality (real midday-to-late-morning sun). Only SOFT NATURAL shadows from that frontal direction — a gentle shadow under the chin, a soft shadow tucked behind an arm. There is NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow streaking across the sand. DIRECT FRONTAL sun — never side-lit, never from the side.
```

- [ ] **Step 6: Strengthen the `THE GARMENT` lighting passage's opening (line ~262)**

Use the `Edit` tool. `old_string` (exact, the whole line 262):
```
THE GARMENT: the SWIMSUIT is the hero of this photo and must be evenly, fully, brightly lit — every part clearly visible and crisply readable: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband. The swimsuit is exposed a touch BRIGHTER than a perfectly neutral exposure — the shadows on the fabric are lifted, so even the deepest folds and the underside of the bust stay fully readable; the garment never goes dim, muddy, or grey-flat. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO hard shadows on the swimsuit. (This brighter exposure applies to the GARMENT only — it does NOT change the scene: the sky stays a bright blue with soft clouds, the sun stays behind the camera, the background stays a properly-exposed real beach.) If any part of the garment sinks into shadow, OR a hard directional / side-lit shadow appears on the body / garment / sand, OR the background is a featureless white blur or a gloomy dark grey, the result is WRONG.
```
`new_string`:
```
THE GARMENT: the SWIMSUIT is the hero of this photo. It is HIT BY DIRECT FRONT SUNLIGHT and is BRIGHT — fully, brilliantly lit, never dim, never grey-flat; every part crisply readable: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband. Black fabric reads as a bright dark grey-black with all the ribbed / pleated texture catching the light — NOT crushed to a flat black silhouette. The swimsuit is exposed a touch BRIGHTER than a perfectly neutral exposure — the shadows on the fabric are lifted, so even the deepest folds and the underside of the bust stay fully readable. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO hard shadows on the swimsuit. (This bright frontal-sun exposure applies to the GARMENT and model — it does NOT change the scene: the sky stays a bright blue with soft clouds, the sun stays behind the camera, the background stays a properly-exposed real beach, not blown out.) If any part of the garment sinks into shadow, OR a hard directional / side-lit shadow appears on the body / garment / sand, OR the background is a featureless white blur or a gloomy dark grey, the result is WRONG.
```

- [ ] **Step 7: Sync the `LIGHTING — READ THIS` summary line (line ~285)**

Use the `Edit` tool. `old_string` (exact, the whole line 285):
```
LIGHTING — READ THIS: bright natural daylight with the SUN BEHIND THE CAMERA (frontal) — the model and product lit evenly from the front, bright and fully readable. Subtle warm, slightly golden light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon. Warm, clean, slightly bright grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black.
```
`new_string`:
```
LIGHTING — READ THIS: bright DIRECT frontal sunlight on the model and product (the sun is behind the camera) — the swimsuit is in full bright sun, brilliantly lit, every detail readable. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon. Warm, clean, slightly bright grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast, NOT blown out. Black fabric shows texture, not crushed black.
```

#### Part B — `lib/avatar-crop.js`

- [ ] **Step 8: Bump the brightness-lift constants**

Read lines 13-18 to confirm they currently are:
```js
// Conservative exposure lift applied to every finished Product Catalog image. The generated
// shots tend to come out a touch dark; prompting "BRIGHT high-key" repeatedly hasn't moved
// the needle, so we lift it deterministically here. Kept gentle so the scene still looks
// natural — brightness multiplier + a small shadow lift on top of black.
const BRIGHTNESS_MULT = 1.1;   // ~+10% overall exposure
const SHADOW_LIFT = 6;          // raise the black point by ~6/255
```

Use the `Edit` tool. `old_string`:
```
// Conservative exposure lift applied to every finished Product Catalog image. The generated
// shots tend to come out a touch dark; prompting "BRIGHT high-key" repeatedly hasn't moved
// the needle, so we lift it deterministically here. Kept gentle so the scene still looks
// natural — brightness multiplier + a small shadow lift on top of black.
const BRIGHTNESS_MULT = 1.1;   // ~+10% overall exposure
const SHADOW_LIFT = 6;          // raise the black point by ~6/255
```
`new_string`:
```
// Exposure lift applied to every finished Product Catalog image. The generated shots keep
// landing too dark (especially black garments); prompting "BRIGHT" repeatedly hasn't moved
// the needle enough, so we lift it deterministically here. Tuned stronger than the original
// +10% — black fabric has the most headroom, so the shadow lift helps the garment most. If
// highlights (sand, sky) blow out, dial these back (e.g. 1.14 / 10).
const BRIGHTNESS_MULT = 1.18;  // ~+18% overall exposure
const SHADOW_LIFT = 13;         // raise the black point by ~13/255
```

#### Verification

- [ ] **Step 9: Syntax check both files**

Run: `node --check api/creatives/generate.js && node --check lib/avatar-crop.js`
Expected: exit 0, no output.

- [ ] **Step 10: Grep checks**

Run from the repo root:
```bash
grep -c "isIsola = " api/creatives/generate.js                       # expect 1
grep -c "catalogHighWaist" api/creatives/generate.js                 # expect 3  (def + high-waist block + NEGATIVE)
grep -c "shining DIRECTLY ON HER FROM THE FRONT" api/creatives/generate.js   # expect 1
grep -c "HIT BY DIRECT FRONT SUNLIGHT" api/creatives/generate.js     # expect 1
grep -c "navel showing above the waistband" api/creatives/generate.js # expect 1
grep -c "Frontal soft sun" api/creatives/generate.js                 # expect 0  (old wording removed)
grep -c "BRIGHTNESS_MULT = 1.18" lib/avatar-crop.js                  # expect 1
grep -c "SHADOW_LIFT = 13" lib/avatar-crop.js                        # expect 1
grep -c "isHighWaistTummy" api/creatives/generate.js                 # expect 3  (def + non-catalog isTummyControl line ~324 + comment line; verify the line ~324 `isTummyControl` use is untouched)
```
If any count is wrong, re-check the corresponding Edit. (For the last one: open line ~324 and confirm `const isTummyControl = !isRealisticBeach && !isProductCatalog && isHighWaistTummy;` is unchanged.)

- [ ] **Step 11: Optional local sharp brightness check**

Run:
```bash
node -e "
import('./lib/avatar-crop.js').then(async ({processCatalogImage}) => {
  const sharp = (await import('sharp')).default;
  const src = await sharp({ create: { width: 600, height: 1000, channels: 3, background: { r: 80, g: 80, b: 80 } } }).png().toBuffer();
  const out = await processCatalogImage(src, 'three-quarter');
  const m = await sharp(out).metadata();
  const s0 = (await sharp(src).stats()).channels[0].mean;
  const s1 = (await sharp(out).stats()).channels[0].mean;
  console.log('size', m.width+'x'+m.height, m.format, '(expect 600x900 jpeg)');
  console.log('mean', s0.toFixed(1), '->', s1.toFixed(1), '(expect ~80 -> ~107)');
});
"
```
Expected: `size 600x900 jpeg`, `mean 80.0 -> 107.x` (≈ 80×1.18 + 13 = 107.4).

- [ ] **Step 12: Run the test suite (regression)**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 13: Commit**

```bash
git add api/creatives/generate.js lib/avatar-crop.js
git commit -m "$(cat <<'EOF'
feat: Product Catalog — hide navel for Isola + brighter product (direct frontal sun)

- High-waist tummy-control block now fires for ALL Isola Product Catalog
  generations (store name match), not just title-regex hits; stronger wording
  ("waistband higher than the reference photo, navel fully covered").
- More light on the product: bump processCatalogImage lift (1.1 -> 1.18,
  shadow 6 -> 13) and pivot the lighting prompt from "frontal soft sun" to
  "bright DIRECT frontal sun, full sunlight on the swimsuit". Anti-side-light
  NEGATIVE terms kept (frontal direct sun casts no side shadow).
Spec: Docs/superpowers/specs/2026-05-12-product-catalog-navel-and-direct-light-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push after review.

- [ ] **Step 14: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user/colleague to run — not part of the automated plan:

1. Studio → Product Catalog → an **Isola** product → avatar resembling the reference / Model preset "Model 1 (38) Everyday" → Pose "Hero Front" → Framing "3/4 body" → 2K → Generate 3-4×.
2. Check:
   - (a) **navel is NOT visible** — waistband at the natural waist, no bare navel-area skin above the edge
   - (b) product **noticeably brighter** than the previous generation — looks lit by direct frontal sun, black fabric shows ribbed/pleated texture, not dark
   - (c) direct frontal sun, only soft natural shadows — NO hard *side* shadow on the product or sand
   - (d) blue sky with a few soft clouds, recognizable beach — background NOT blown out to white
   - (e) eye-level camera (not from below), model identity unchanged
3. **Regression:** if highlights blow out (sand/sky white) → lower `BRIGHTNESS_MULT` to 1.14, `SHADOW_LIFT` to 10 in `lib/avatar-crop.js`. If a hard *side* shadow comes back on the product → strengthen `side lighting` / `side-angle sun` / `hard cast shadow` in NEGATIVE and reinforce "sun behind the camera, never to the side" in the LIGHTING block (do NOT revert to "no visible sun"). If the waistband sits absurdly high on some product → tolerate or narrow the `isIsola` always-on to specific product types.
4. Send a result to Ondra / the user for comparison with the reference photo.

---

## Self-Review

**Spec coverage:** Spec §Změny `api/creatives/generate.js` item 1 (load name, compute `isIsola`) → Step 1 ✓. Item 2 (`catalogHighWaist` flag, keep `isHighWaistTummy` for non-catalog) → Step 2 ✓. Item 3 (use `catalogHighWaist` in high-waist block + strengthen text "waistband higher than reference") → Step 3 ✓. Item 4 (use `catalogHighWaist` in NEGATIVE + add `navel showing above the waistband, low-set waistband`) → Step 4 ✓. Item 5 (lighting rewrite: LIGHT ON THE MODEL → direct frontal sun, THE GARMENT → "hit by direct front sunlight", summary line synced, SKY/GRADE unchanged, NEGATIVE keeps anti-side-light, no anti-sun terms re-added) → Steps 5/6/7 ✓ (SKY line 256 and GRADE line 264 untouched; NEGATIVE line 290 only the high-waist fragment changed in Step 4, the lighting part stays). Spec §Změny `lib/avatar-crop.js` item 6 (1.1→1.18, 6→13, comment) → Step 8 ✓. Spec §Verifikace 1-5 → Steps 9-12 + Post-implementation ✓. Spec "beze změny" list (CROP_FRACTIONS, processCatalogImage body, non-catalog isTummyControl, Realistic Beach, other styles, poll_generations mechanics, frontend, no new deps) → no task touches them; Step 10's last grep explicitly verifies the line ~324 `isTummyControl` use is intact ✓. Spec §Pozn. "one commit, easy revert" → Step 13 single commit ✓. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every Step has the exact `old_string`/`new_string` or exact command + expected output. ✓

**Type consistency:** New identifiers — `isIsola` (Step 1), `catalogHighWaist` (Step 2), used consistently in Steps 3-4. Constants `BRIGHTNESS_MULT`/`SHADOW_LIFT` keep their names (Step 8). The four lighting `old_string`s (lines 258, 262, 271, 285) and the store-load block (84-86) and `isHighWaistTummy` line (97) and the NEGATIVE high-waist fragment (290) are verbatim from the current `api/creatives/generate.js` as of commit `bdc4136`. The brightness calc in Step 11 (80×1.18+13=107.4) matches Step 8's constants. ✓

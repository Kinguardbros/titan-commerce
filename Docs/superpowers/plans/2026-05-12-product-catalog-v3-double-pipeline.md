# Product Catalog v3 — Double Pipeline (Studio Shot → Beach Background) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Product Catalog v3" creative style: step 1 generates a clean white-studio shot of the model (from a persona avatar) in the swimsuit with flat, even, all-sides studio lighting; step 2 auto-fires from `poll_generations` and uses `fal-ai/ideogram/v3/replace-background` to swap ONLY the background for a beach scene, keeping subject/pose/garment/lighting unchanged. One creative row throughout — the user sees only the final beach shot. If step 2 fails, the clean studio shot is kept. UI: Reference model (avatar, required) / Pose / Beach scene / Resolution / Count. v1, v2, Realistic Beach, PhotoStory untouched.

**Architecture:** New `lib/v3-beach-scenes.js` (background prompts keyed by scene id). `api/creatives/generate.js`: a new `isProductCatalogV3` flag + a new `else if (isProductCatalogV3)` STUDIO prompt branch + routing hooks (image filter, refImages sandwich, outAspectRatio, falPrompt, configMeta `stage:'studio'` + `v3_beach_scene` + `v3_aspect`). `lib/actions/creatives.js` `poll_generations`: when a `product_catalog_v3` row with `meta.stage==='studio'` completes, instead of flipping to `pending`, submit the Ideogram BG step-2 job and update the row to `meta.stage==='beach'` (still `generating`); the next poll cycle finalizes it; if step 2 fails/times out at the beach stage, keep the studio shot as the result. Frontend (`CreativeStudio.jsx`): new style in `STYLE_MAP` + `STYLE_CATEGORIES`, derived `isProductCatalogV3` / `isProductCatalogV3Style`, a v3 UI block (avatar Select + Pose pills + new Beach-scene pills), `customInstr` v3 variant emitting `[catalog_beach:<id>]`, `generateCreatives` v3 fields, Generate-disabled-without-avatar extended to v3. No new deps, no DB schema change.

**Tech Stack:** Node.js (Vercel serverless), React 19 + Vite, fal.ai Nano Banana Pro + Ideogram v3 replace-background, Vitest (27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-12-product-catalog-v3-double-pipeline-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — not a git repo). Repo on `main`; the user deploys via Vercel on push — intentional. Line numbers below are accurate as of commit `8ca1ac4`.

---

## File Structure

- **Create:** `lib/v3-beach-scenes.js` — `buildV3BeachPrompt(sceneKey)`: maps a scene id (`sunny`/`golden`/`dune`/`cove`) to the Ideogram BG step-2 prompt. One responsibility, ~25 lines.
- **Modify:** `api/creatives/generate.js` — `isProductCatalogV3` flag (~line 94), image filter (~line 114), `[catalog_beach:...]` parse, new `else if (isProductCatalogV3)` STUDIO prompt branch (after ~line 345), `refImages` (~line 451), `outAspectRatio` (~line 446), `falPrompt` (~line 469), `configMeta` (~line 568).
- **Modify:** `lib/actions/creatives.js` — import `buildV3BeachPrompt` (~line 7), the chain block inside `poll_generations`'s `completed` handler (~line 254-259), the `failed` + timeout handlers for the beach stage (~lines 228-247, 285-301).
- **Modify:** `apps/dashboard/src/components/CreativeStudio.jsx` — `STYLE_MAP` (~line 31), `STYLE_CATEGORIES` (~line 105), `CATALOG_BEACH_SCENES` const + `catalogBeach` state (~lines 27/449), render-scope flags (~line 512), `backendModel` (~line ~547), `customInstr` (~line 575), `generateCreatives` fields (~line 588-599), v3 UI block (after ~line 911), Generate button + early-return guard (~lines 545, 1095-1107).
- **Unchanged:** `lib/avatar-crop.js` (`processCatalogImage` stays v1-only — `c.style === 'product_catalog'`), Realistic Beach branch, PhotoStory, all other styles, `apps/dashboard/src/lib/api.js`.

Four tasks: **Task 1 = `lib/v3-beach-scenes.js`**, **Task 2 = backend `generate.js`**, **Task 3 = backend `poll_generations` chain**, **Task 4 = frontend**. Backend before frontend so the API path exists. Each commits independently.

---

### Task 1: New `lib/v3-beach-scenes.js`

**Files:**
- Create: `lib/v3-beach-scenes.js`

- [ ] **Step 1: Create the file**

Use the `Write` tool to create `lib/v3-beach-scenes.js` with exactly this content:

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

- [ ] **Step 2: Syntax check**

Run: `node --check lib/v3-beach-scenes.js`
Expected: exit 0, no output.

- [ ] **Step 3: Quick smoke test**

Run:
```bash
node -e "import('./lib/v3-beach-scenes.js').then(m => { console.log(m.buildV3BeachPrompt('golden').slice(0,40)); console.log(m.buildV3BeachPrompt('nonsense').slice(0,40)); console.log(m.buildV3BeachPrompt().slice(0,40)); });"
```
Expected: first line starts `Replace the plain studio background with a real beach at golden`, second and third lines both start `Replace the plain studio background with a real sandy beach` (fallback to `sunny`).

- [ ] **Step 4: Commit**

```bash
git add lib/v3-beach-scenes.js
git commit -m "$(cat <<'EOF'
feat: lib/v3-beach-scenes — background prompts for Product Catalog v3 step 2

buildV3BeachPrompt(sceneKey) maps a scene id (sunny/golden/dune/cove) to the
Ideogram v3 replace-background prompt: swap ONLY the background, keep the subject,
pose, garment, and lighting unchanged. Falls back to 'sunny'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 5: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 2: Backend — `api/creatives/generate.js` v3 STUDIO prompt branch + routing

**Files:**
- Modify: `api/creatives/generate.js`

**Context for the engineer:** `api/creatives/generate.js` builds a prompt for fal.ai's Nano Banana `/edit` model. Around line 92-94 it sets `isRealisticBeach` / `isProductCatalog` / `isProductCatalogV2`. Around line 114 it filters out previously-pushed AI creatives. The big `if (isProductCatalog) {...} else if (isProductCatalogV2) {...} else if (isRealisticBeach) {...} else {...}` block (~lines ~210-345) builds `prompt`. Around lines 440-470, when routing to fal.ai Nano Banana, it builds `refImages` (the avatar "sandwich"), `outAspectRatio`, and `falPrompt` (self-contained for product_catalog/v2; wrapped otherwise). Around line 556-558 it extracts `[catalog_model:...]` / `[catalog_pose:...]` / `[catalog_framing:...]` tags from `custom_prompt` for `configMeta` (~line 568). We're adding `product_catalog_v3` which routes like v2 (Nano Banana Pro, product image as reference, hardcoded 4:5) but with a STUDIO prompt (clean white backdrop, flat all-sides lighting) and stores `stage:'studio'` + `v3_beach_scene` + `v3_aspect` in metadata so `poll_generations` can fire step 2. Make ONLY the changes below; do not touch v1's `isProductCatalog`, v2's `isProductCatalogV2`, `catalogHighWaist`, `catalogFramingKey`, `isRealisticBeach`, or `poll_generations`.

- [ ] **Step 1: Add `isProductCatalogV3` flag (~line 94)**

Read line 94 to confirm it's `    const isProductCatalogV2 = style === 'product_catalog_v2';`. Use the `Edit` tool. `old_string`:
```
    const isProductCatalogV2 = style === 'product_catalog_v2';
```
`new_string`:
```
    const isProductCatalogV2 = style === 'product_catalog_v2';
    const isProductCatalogV3 = style === 'product_catalog_v3';
```

- [ ] **Step 2: Include v3 in the image filter (~line 114)**

Read line 114 to confirm it's `    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2) {`. Use the `Edit` tool. `old_string`:
```
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2) {
```
`new_string`:
```
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3) {
```

- [ ] **Step 3: Parse the `[catalog_beach:...]` tag (near line 94, right after the v3 flag)**

Use the `Edit` tool. `old_string` (the two flag lines from Step 1, now adjacent):
```
    const isProductCatalogV2 = style === 'product_catalog_v2';
    const isProductCatalogV3 = style === 'product_catalog_v3';
```
`new_string`:
```
    const isProductCatalogV2 = style === 'product_catalog_v2';
    const isProductCatalogV3 = style === 'product_catalog_v3';
    const v3BeachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
```

- [ ] **Step 4: Add the `else if (isProductCatalogV3)` STUDIO prompt branch (before `} else if (isRealisticBeach) {` at ~line 346)**

Read line ~346 to confirm it's `    } else if (isRealisticBeach) {`. Use the `Edit` tool. `old_string`:
```
    } else if (isRealisticBeach) {
```
`new_string` (note: this is a template literal — keep the backtick and `${...}` exactly; the ONLY interpolations are `${v3GarmentLine}`, `${v3ModelLine}`, `${product.title}`, `${v3PoseText}`, `${aspect_ratio || '4:5'}`):
```
    } else if (isProductCatalogV3) {
      // Product Catalog v3 — STEP 1 of the double pipeline: a clean white-studio shot of the
      // model in the swimsuit with FLAT EVEN ALL-SIDES studio lighting (the controlled
      // environment is the whole point). poll_generations then fires step 2 (Ideogram BG) to
      // swap the studio background for a beach. Model comes from the persona avatar (sandwich).
      const v3HasAvatar = !!reference_url;
      const v3Custom = (custom_prompt || '').replace(/\[catalog_[^\]]+\]/g, '').trim();
      const v3PoseText = v3Custom.includes('POSE:')
        ? v3Custom.slice(v3Custom.indexOf('POSE:')).trim()
        : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';
      const v3ModelDesc = (v3Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1] || '').trim()
        || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';
      const v3ModelLine = v3HasAvatar
        ? `Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography in a CLEAN STUDIO. THE MODEL — generate exactly this woman: ${v3ModelDesc}`;
      const v3GarmentLine = v3HasAvatar
        ? `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, twice). Any image in between = THE GARMENT — recreate this swimsuit faithfully: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage; do NOT redesign or reinterpret it, and do NOT let the garment images influence the model's face.`
        : `Use the swimsuit shown in the attached image as the exact reference garment — recreate it faithfully: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign or reinterpret it.`;
      prompt = `${v3GarmentLine}

${v3ModelLine}

BACKGROUND: a CLEAN, SEAMLESS white-to-light-grey studio backdrop — NOTHING else: no props, no furniture, no floor line, no horizon, no shadows on the wall, no gradient, no colored background. Just a clean studio sweep behind her.

LIGHTING (this is the whole point — get it perfect): FLAT, EVEN, SOFT studio lighting — a big softbox on the model from the front plus fill light on BOTH sides, so the swimsuit is lit FULLY AND EVENLY FROM ALL SIDES. ZERO harsh shadows, ZERO side-lit shadow, ZERO directional shadow. Every part of the swimsuit is crisp and bright — fabric texture, color, pattern, ribbing/pleating, trims, stitching, seams, waistband all clearly readable. Black fabric reads as a clean dark grey-black with ALL the texture visible — NOT crushed to a flat black silhouette. Bright, clean, true-to-life exposure — NOT dim, NOT overexposed, NOT washed out. The model's skin is evenly lit, natural, true to life.

Product: ${product.title}

${v3PoseText}

GARMENT RULES (non-negotiable): for two-piece swimsuits the bikini bottoms must be high-waisted, sit well above the belly button, and fully cover the navel; moderate leg opening, not high-cut, full coverage across the hips and upper thighs. For one-piece swimsuits: full coverage from bust to upper hip, moderate leg opening.

FACE QUALITY (critical): sharp detailed features, visible skin pores, individual eyebrow hairs, realistic catchlight in the eyes, visible iris detail, individual eyelashes, natural lip texture. Face tack sharp, no AI smoothing, no uncanny valley, no doll-like skin. If the face looks AI-generated, blurry, or plastic — the image is WRONG.

CAMERA: shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below. Her proportions are natural and undistorted. Hyperrealistic, photographic, editorial swimwear catalog quality, 85mm lens at f/2.8, Canon R5 look, 8K, ultra-sharp. ${aspect_ratio || '4:5'} format.

NEGATIVE: beach, ocean, sand, water, sky, outdoor, nature, sunset, golden hour, props, furniture, floor line, horizon line, gradient backdrop, colored background, dark background, shadow on the wall, harsh shadow, hard cast shadow, side lighting, directional shadow, dark side of the body, dim, dark photo, underexposed, overexposed, blown-out highlights, washed out, hazy bright wash, crushed blacks, garment crushed to pure black, deep shadows on the swimsuit, dark areas on the garment, visible belly button, exposed navel, low-rise bottoms, mid-rise bottoms, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, low-angle shot, shot from below, distorted perspective, text, watermarks.`.trim();
    } else if (isRealisticBeach) {
```

- [ ] **Step 5: Route v3 in `refImages` / `outAspectRatio` (~lines 446-451)**

Read lines 446-451 to confirm:
```js
        // Product Catalog v2 is self-contained, no avatar, hardcoded 4:5 framing.
        const outAspectRatio = isProductCatalogV2 ? '4:5' : aspect_ratio;
        // Product Catalog (v1 & v2): with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                            without an avatar     → 1 product image only (packshot/flat-lay,
        //                                                    not a model shot), model comes from the prompt
        const refImages = (isProductCatalog || isProductCatalogV2)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
Use the `Edit` tool. `old_string`:
```
        // Product Catalog v2 is self-contained, no avatar, hardcoded 4:5 framing.
        const outAspectRatio = isProductCatalogV2 ? '4:5' : aspect_ratio;
        // Product Catalog (v1 & v2): with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                            without an avatar     → 1 product image only (packshot/flat-lay,
        //                                                    not a model shot), model comes from the prompt
        const refImages = (isProductCatalog || isProductCatalogV2)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
`new_string`:
```
        // Product Catalog v2/v3 are self-contained; v3 is step 1 of the double pipeline.
        const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3) ? '4:5' : aspect_ratio;
        // Product Catalog (v1, v2, v3): with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                               without an avatar     → 1 product image only (packshot/flat-lay,
        //                                                       not a model shot), model comes from the prompt
        const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```

- [ ] **Step 6: Route v3 in `falPrompt` (~line 469)**

Read line 469 to confirm it's:
```js
        const falPrompt = (isProductCatalog || isProductCatalogV2)
          ? prompt  // Product Catalog prompts are self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```
Use the `Edit` tool. `old_string`:
```
        const falPrompt = (isProductCatalog || isProductCatalogV2)
          ? prompt  // Product Catalog prompts are self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```
`new_string`:
```
        const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
          ? prompt  // Product Catalog prompts are self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```

- [ ] **Step 7: Add `stage`/`v3_beach_scene`/`v3_aspect` to `configMeta` (~line 568)**

Read lines 568-585 to confirm `configMeta` and find the line `      ...(catalogFramingKey && { framing_crop: catalogFramingKey }), // poll_generations crops the finished image to this`. Use the `Edit` tool. `old_string`:
```
      ...(catalogFramingKey && { framing_crop: catalogFramingKey }), // poll_generations crops the finished image to this
```
`new_string`:
```
      ...(catalogFramingKey && { framing_crop: catalogFramingKey }), // poll_generations crops the finished image to this
      ...(isProductCatalogV3 && { stage: 'studio', v3_beach_scene: v3BeachKey, v3_aspect: '4:5' }), // poll_generations fires step 2 (Ideogram bg replace)
```

- [ ] **Step 8: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 9: Grep checks**

```bash
grep -c "isProductCatalogV3" api/creatives/generate.js                          # expect 7-8 (flag + image filter + branch cond + refImages + outAspectRatio + falPrompt + configMeta + v3BeachKey-adjacent... ~7)
grep -c "else if (isProductCatalogV3)" api/creatives/generate.js                # expect 1
grep -c "LIGHTING (this is the whole point" api/creatives/generate.js           # expect 1
grep -c "stage: 'studio', v3_beach_scene" api/creatives/generate.js             # expect 1
grep -c "v3BeachKey" api/creatives/generate.js                                  # expect 2 (def + configMeta use)
grep -c "isProductCatalogV2 = " api/creatives/generate.js                       # expect 1 (v2 flag unchanged)
```

- [ ] **Step 10: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 11: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: backend — product_catalog_v3 STEP 1 (clean studio shot, flat all-sides lighting)

Step 1 of the double pipeline: a clean white-studio prompt — model from the persona
avatar (sandwich [avatar, product, avatar]), seamless backdrop, flat even all-sides
softbox + fill lighting (the whole point — product lit perfectly with no competing
sun/shadow/beach signals), 4:5, Nano Banana Pro. Stores stage:'studio' + the chosen
beach scene + 4:5 in metadata so poll_generations can fire step 2 (Ideogram BG).
Spec: Docs/superpowers/specs/2026-05-12-product-catalog-v3-double-pipeline-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 12: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 3: Backend — `poll_generations` chain (studio → beach)

**Files:**
- Modify: `lib/actions/creatives.js`

**Context for the engineer:** `lib/actions/creatives.js`'s `poll_generations` polls fal.ai jobs for creatives with `status='generating'` AND `hf_job_id != null` (~line 196-310). When a job is `completed`, it flips the row to `status='pending'` with the result URL (~line 254-259), then a fire-and-forget background task downloads + uploads to Supabase Storage (~line 264-284). It also handles timeouts (~line 228-247) and `failed` (~line 285-301) with one auto-retry. We're adding: when a `product_catalog_v3` row with `meta.stage==='studio'` completes, DON'T flip to `pending` — instead submit a step-2 Ideogram BG job (`fal-ai/ideogram/v3/replace-background`, `image_url`=the studio result, `prompt`=the beach scene prompt from `meta.v3_beach_scene`), update the row to `meta.stage==='beach'` with the new job's `hf_job_id`/`poll_base`/`submitted_at`/`model`/`studio_url`/`retry_count:0` (still `generating`), and `continue`. The next poll cycle picks it up (still `generating` + has `hf_job_id`), checks the step-2 job, and finalizes normally. If the beach-stage job fails (after retry) or times out, keep the studio shot as the result instead of marking `failed`. Make ONLY the changes below; don't touch the v1/v2/other-style paths.

- [ ] **Step 1: Import `buildV3BeachPrompt` (~line 7)**

Read line 7 to confirm it's `import { processCatalogImage } from '../avatar-crop.js';`. Use the `Edit` tool. `old_string`:
```
import { processCatalogImage } from '../avatar-crop.js';
```
`new_string`:
```
import { processCatalogImage } from '../avatar-crop.js';
import { buildV3BeachPrompt } from '../v3-beach-scenes.js';
```

- [ ] **Step 2: Add the v3 chain block in the `completed` handler (~line 254-259)**

Read lines 251-264 to confirm the structure:
```js
    try {
      checked++;
      const result = await checkFalJob(pollBase, c.hf_job_id);
      if (result.status === 'completed' && result.url) {
        // Flip status=pending with the fal.ai URL IMMEDIATELY so the UI shows
        // the finished image without waiting for Supabase Storage upload.
        const path = c.storage_path || `creatives/poll_${c.id}_${Date.now()}.png`;
        await supabase.from('creatives').update({ status: 'pending', file_url: result.url, storage_path: path }).eq('id', c.id);
        completed++;

        // Background: download from fal.ai (temporary URL, ~1h TTL), post-process Product
```
Use the `Edit` tool. `old_string`:
```
      if (result.status === 'completed' && result.url) {
        // Flip status=pending with the fal.ai URL IMMEDIATELY so the UI shows
        // the finished image without waiting for Supabase Storage upload.
        const path = c.storage_path || `creatives/poll_${c.id}_${Date.now()}.png`;
        await supabase.from('creatives').update({ status: 'pending', file_url: result.url, storage_path: path }).eq('id', c.id);
        completed++;
```
`new_string`:
```
      if (result.status === 'completed' && result.url) {
        // Product Catalog v3 double pipeline — step 1 (studio) done → fire step 2 (Ideogram bg
        // replace), keep this row 'generating' so the next poll cycle finalizes it. Single row.
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

        // Flip status=pending with the fal.ai URL IMMEDIATELY so the UI shows
        // the finished image without waiting for Supabase Storage upload.
        const path = c.storage_path || `creatives/poll_${c.id}_${Date.now()}.png`;
        await supabase.from('creatives').update({ status: 'pending', file_url: result.url, storage_path: path }).eq('id', c.id);
        completed++;
```

- [ ] **Step 3: Keep the studio shot if the beach-stage job fails (~line 285-301)**

Read lines 285-301 to confirm the `failed` handler:
```js
      } else if (result.status === 'failed') {
        if (retryCount < 1 && meta.model && meta.poll_base) {
          try {
            const retryJob = await submitFalJob({ model: meta.model, prompt: meta.retry_prompt || c.hook_used || '', imageUrl: [], aspectRatio: '1:1', resolution: meta.resolution });
            await supabase.from('creatives').update({
              hf_job_id: retryJob.requestId,
              metadata: { ...meta, poll_base: retryJob.pollBase || meta.poll_base, submitted_at: new Date().toISOString(), retry_count: retryCount + 1, prev_error: result.error },
            }).eq('id', c.id);
            console.log('[poll_generations] auto-retry after fal failure for', c.id);
            continue;
          } catch (retryErr) {
            console.error('[poll_generations] retry after fal failure failed for', c.id, retryErr.message);
          }
        }
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: result.error } }).eq('id', c.id);
        failed++;
      }
```
Use the `Edit` tool. `old_string`:
```
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: result.error } }).eq('id', c.id);
        failed++;
      }
```
`new_string`:
```
        if (c.style === 'product_catalog_v3' && meta.stage === 'beach' && meta.studio_url) {
          // v3 step 2 (bg replace) failed after retry — keep the clean studio shot as the result.
          await supabase.from('creatives').update({ status: 'pending', file_url: meta.studio_url, metadata: { ...meta, v3_error: `bg replace failed: ${result.error}`, v3_failed: true } }).eq('id', c.id);
          completed++;
          console.warn('[poll_generations] v3 step 2 failed for', c.id, '— kept studio shot as result');
        } else {
          await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: result.error } }).eq('id', c.id);
          failed++;
        }
      }
```

- [ ] **Step 4: Keep the studio shot if the beach-stage job times out (~line 243-247)**

Read lines 243-249 to confirm the timeout fallback:
```js
      } else {
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: `timeout after ${Math.round((Date.now() - submittedAt) / 1000)}s (retries exhausted)` } }).eq('id', c.id);
        failed++;
        console.warn('[poll_generations] hard timeout for', c.id, 'retries exhausted');
      }
      continue;
```
Use the `Edit` tool. `old_string`:
```
      } else {
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: `timeout after ${Math.round((Date.now() - submittedAt) / 1000)}s (retries exhausted)` } }).eq('id', c.id);
        failed++;
        console.warn('[poll_generations] hard timeout for', c.id, 'retries exhausted');
      }
      continue;
```
`new_string`:
```
      } else if (c.style === 'product_catalog_v3' && meta.stage === 'beach' && meta.studio_url) {
        // v3 step 2 (bg replace) timed out — keep the clean studio shot as the result.
        await supabase.from('creatives').update({ status: 'pending', file_url: meta.studio_url, metadata: { ...meta, v3_error: 'bg replace timed out', v3_failed: true } }).eq('id', c.id);
        completed++;
        console.warn('[poll_generations] v3 step 2 timed out for', c.id, '— kept studio shot as result');
      } else {
        await supabase.from('creatives').update({ status: 'failed', metadata: { ...meta, error: `timeout after ${Math.round((Date.now() - submittedAt) / 1000)}s (retries exhausted)` } }).eq('id', c.id);
        failed++;
        console.warn('[poll_generations] hard timeout for', c.id, 'retries exhausted');
      }
      continue;
```

- [ ] **Step 5: Syntax check**

Run: `node --check lib/actions/creatives.js`
Expected: exit 0, no output.

- [ ] **Step 6: Grep checks**

```bash
grep -c "buildV3BeachPrompt" lib/actions/creatives.js                           # expect 2 (import + use)
grep -c "product_catalog_v3" lib/actions/creatives.js                           # expect 3 (chain + failed handler + timeout handler)
grep -c "stage: 'beach'" lib/actions/creatives.js                               # expect 1
grep -c "v3 step 1 done, submitted step 2" lib/actions/creatives.js             # expect 1
grep -c "kept studio shot as result" lib/actions/creatives.js                   # expect 2 (failed + timeout)
```

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`. (system-routing.test will be unaffected — no route change. If it fails, an Edit broke something — re-read.)

- [ ] **Step 8: Commit**

```bash
git add lib/actions/creatives.js
git commit -m "$(cat <<'EOF'
feat: backend — poll_generations chains Product Catalog v3 step 1 -> step 2

When a product_catalog_v3 row with meta.stage==='studio' completes, instead of
flipping to 'pending' it submits the Ideogram v3 replace-background job (studio
shot as image_url, the chosen beach scene as the prompt) and updates the row to
meta.stage==='beach' (still 'generating') — the next poll cycle finalizes it.
Single creative row throughout; the user sees only the final beach shot. If the
beach-stage job fails after retry or times out, the clean studio shot is kept as
the result instead of marking 'failed'. v1/v2/other styles untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 9: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 4: Frontend — "Product Catalog v3" style + UI (Reference model / Pose / Beach scene / Resolution / Count)

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

**Context for the engineer:** `CreativeStudio.jsx` already has "product-catalog" (v1, full UI) and "product-catalog-v2" (avatar Select + Pose pills). v2's pattern: `STYLE_MAP` entry, `STYLE_CATEGORIES` entry, render-scope flags `isAnyCatalogStyle` (~line 512) / `isProductCatalogV2Style` (~line 513), `handleGenImage`-scope `isProductCatalogV2` (~line 550) / `isAnyCatalog` (~line 551), `backendModel` forced to Nano Banana Pro for catalog styles, a `customInstr` v3-style ternary (~line 575), `generateCreatives` field overrides keyed on `isProductCatalogV2` (~line 588-599), a v2 UI block (~line 889), and a Generate button that's disabled (greyed + hint) when `isProductCatalogV2Style && !catalogAvatar` (~line 1095-1107) plus an early-return guard in `handleGenImage` (~line 545). We add "product-catalog-v3" alongside v2, sharing the same patterns, plus a new "Beach scene" pill row (new `CATALOG_BEACH_SCENES` const + `catalogBeach` state). The avatar Select is identical to v2's (no `__preset__`, empty-state hint). `catalogPose` / `catalogAvatar` state is shared. `TEXT_MID` is a colour const in scope. Make ONLY the changes below; do not touch the v1 or v2 blocks.

- [ ] **Step 1: Add v3 to `STYLE_MAP` (~line 31)**

Read lines 30-32 to confirm. Use the `Edit` tool. `old_string`:
```
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "realistic-beach": "realistic_beach",
```
`new_string`:
```
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "product-catalog-v3": "product_catalog_v3",
  "realistic-beach": "realistic_beach",
```

- [ ] **Step 2: Add v3 to `STYLE_CATEGORIES` "product-photos" (~line 105)**

Read lines 104-106 to confirm. Use the `Edit` tool. `old_string`:
```
      { id: "product-catalog-v2", title: "Product Catalog v2", desc: "Golden hour, subject pops, simple controls", icon: "🌅" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```
`new_string`:
```
      { id: "product-catalog-v2", title: "Product Catalog v2", desc: "Golden hour, subject pops, simple controls", icon: "🌅" },
      { id: "product-catalog-v3", title: "Product Catalog v3", desc: "Studio shot → beach background (2-step)", icon: "🎬" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```

- [ ] **Step 3: Add `CATALOG_BEACH_SCENES` const next to `CATALOG_POSES` (~line 27)**

Read lines 20-28 to find `CATALOG_POSES` and the line right after it. Use the `Edit` tool — `old_string` (the `CATALOG_POSES` array's closing `];` and the blank line + `const STYLE_MAP = {` that follows):
```
];

const STYLE_MAP = {
```
`new_string`:
```
];

const CATALOG_BEACH_SCENES = [
  { id: 'sunny', label: 'Bright sunny' },
  { id: 'golden', label: 'Golden hour' },
  { id: 'dune', label: 'Dune grass' },
  { id: 'cove', label: 'Rocky cove' },
];

const STYLE_MAP = {
```
(Note: if `CATALOG_POSES` is NOT immediately followed by `const STYLE_MAP = {`, anchor instead on `CATALOG_POSES`'s closing `];` plus enough following context to be unique, and insert `CATALOG_BEACH_SCENES` right after.)

- [ ] **Step 4: Add `catalogBeach` state (~line 449)**

Read lines 447-451 to find `const [catalogAvatar, setCatalogAvatar] = useState(null);`. Use the `Edit` tool. `old_string`:
```
  const [catalogAvatar, setCatalogAvatar] = useState(null); // persona name, or null = use text preset
```
`new_string`:
```
  const [catalogAvatar, setCatalogAvatar] = useState(null); // persona name, or null = use text preset
  const [catalogBeach, setCatalogBeach] = useState("sunny"); // Product Catalog v3 step-2 beach scene
```

- [ ] **Step 5: Add render-scope `isProductCatalogV3Style` + extend `isAnyCatalogStyle` (~line 512-513)**

Read lines 512-513 to confirm:
```js
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2";
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
Use the `Edit` tool. `old_string`:
```
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2";
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
`new_string`:
```
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```

- [ ] **Step 6: Extend the `handleGenImage` early-return guard for v3 (~line 545)**

Read line 545 to confirm it's `    if (imgStyle === 'product-catalog-v2' && !catalogAvatar) { toast.error("Select a reference model first"); return; }`. Use the `Edit` tool. `old_string`:
```
    if (imgStyle === 'product-catalog-v2' && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```
`new_string`:
```
    if ((imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```

- [ ] **Step 7: Extend `isProductCatalogV2` / `isAnyCatalog` in `handleGenImage` for v3 (~line 550-551)**

Read lines 549-551 to confirm:
```js
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2;
```
Use the `Edit` tool. `old_string`:
```
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2;
```
`new_string`:
```
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3;
```

- [ ] **Step 8: Add the v3 `customInstr` branch (~line 575)**

Read lines 575-578 to confirm:
```js
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
```
Use the `Edit` tool. `old_string`:
```
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
```
`new_string`:
```
    const customInstr = isProductCatalogV3
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
```

- [ ] **Step 9: Extend the `generateCreatives` field overrides for v3 (~line 588-599)**

Read lines 588-599 to confirm the call. Use the `Edit` tool. `old_string`:
```
            show_model: isProductCatalogV2 ? true : subject === "On model",
            text_overlay: isProductCatalogV2 ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: isProductCatalogV2 ? "" : (textMode === "Custom" ? customText : ""),
            audience: (isProductCatalogV2 || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: isProductCatalogV2 ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: isProductCatalogV2 ? undefined : colorRef,
```
`new_string`:
```
            show_model: (isProductCatalogV2 || isProductCatalogV3) ? true : subject === "On model",
            text_overlay: (isProductCatalogV2 || isProductCatalogV3) ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: (isProductCatalogV2 || isProductCatalogV3) ? "" : (textMode === "Custom" ? customText : ""),
            audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: (isProductCatalogV2 || isProductCatalogV3) ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: (isProductCatalogV2 || isProductCatalogV3) ? undefined : colorRef,
```

(Note: `backendModel` for v3 — confirm the line `const backendModel = ... ? "fal_nano_banana_pro" : ...` already covers v3. It's keyed on `isAnyCatalog` which Step 7 extended to include v3 — so `backendModel.includes("nano_banana")` is true for v3, `resolution` is sent. Good. If `backendModel` is keyed on something narrower than `isAnyCatalog`, add `|| isProductCatalogV3` there.)

- [ ] **Step 10: Add the v3 UI block (after the v2 block, ~line 911)**

Find the end of the v2 catalog UI block — `{imgStyle === "product-catalog-v2" && (<>...avatar Select + Pose pills...</>)}` — it ends with `</>` `)}`. Read lines 909-915 to find the exact closing + what follows. Use the `Edit` tool — `old_string` (the v2 block's closing `</> )}` plus the next line(s) to anchor; the v2 Pose-pills div ends with `</div>` then `</>` then `)}` then a blank line then the next block). Read the actual lines first; the anchor should be the v2 block's `              </div>\n            </>\n          )}\n` followed by whatever comes next (likely `\n          {/* Scene` or another block). `new_string` inserts the v3 block right after the v2 block's `)}`:
```
          {/* Catalog v3 controls — Reference model (avatar, required) + Pose + Beach scene; step 1 is a clean studio shot, step 2 swaps in the beach */}
          {imgStyle === "product-catalog-v3" && (
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
(Concretely: do the `Edit` with `old_string` = the v2 block's exact closing three lines (`              </div>\n            </>\n          )}`) — but that pattern likely appears more than once. To make it unique, include the v2 Pose `</div>` block above it AND the line that follows the v2 block. Easiest robust approach: read lines ~889-915, identify the exact v2 block boundaries, and craft an `old_string` spanning the v2 block's last ~4 lines + the first line of whatever follows, then `new_string` = same content with the v3 block inserted between. If unsure, ask before guessing.)

- [ ] **Step 11: Extend the Generate-button disabled state + hint for v3 (~line 1095-1107)**

Read lines 1095-1107 to confirm the `{isProductCatalogV2Style && !catalogAvatar && (...)}` hint and the `<button onClick={handleGenImage} disabled={generating || (isProductCatalogV2Style && !catalogAvatar)} ...>`. We want `(isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar` everywhere it currently says `isProductCatalogV2Style && !catalogAvatar`. Use the `Edit` tool. `old_string`:
```
          {isProductCatalogV2Style && !catalogAvatar && (
            <div style={{ fontSize: 11, color: TEXT_MID, marginTop: "1rem" }}>Select a reference model above to generate.</div>
          )}
          <button onClick={handleGenImage} disabled={generating || (isProductCatalogV2Style && !catalogAvatar)} style={{
            width: "100%", marginTop: (isProductCatalogV2Style && !catalogAvatar) ? "0.5rem" : "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: (isProductCatalogV2Style && !catalogAvatar)
              ? "rgba(255,255,255,0.08)"
              : abMode
              ? `linear-gradient(135deg, ${NEON} 0%, ${CYAN} 100%)`
              : `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: (isProductCatalogV2Style && !catalogAvatar) ? TEXT_MID : BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: (isProductCatalogV2Style && !catalogAvatar) ? "not-allowed" : "pointer", transition: "all 0.25s",
            boxShadow: (isProductCatalogV2Style && !catalogAvatar) ? "none" : NEON_GLOW_BTN,
          }}>
```
`new_string`:
```
          {(isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar && (
            <div style={{ fontSize: 11, color: TEXT_MID, marginTop: "1rem" }}>Select a reference model above to generate.</div>
          )}
          <button onClick={handleGenImage} disabled={generating || ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar)} style={{
            width: "100%", marginTop: ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar) ? "0.5rem" : "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar)
              ? "rgba(255,255,255,0.08)"
              : abMode
              ? `linear-gradient(135deg, ${NEON} 0%, ${CYAN} 100%)`
              : `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar) ? TEXT_MID : BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar) ? "not-allowed" : "pointer", transition: "all 0.25s",
            boxShadow: ((isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar) ? "none" : NEON_GLOW_BTN,
          }}>
```

- [ ] **Step 12: Build the frontend**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds (Vite output, `dist/` written). No NEW errors referencing `CreativeStudio.jsx`. If it fails on an undefined variable, check scope: `imgStyle` (state), `isProductCatalogV3Style` / `TEXT_MID` (render-scope / module), `isProductCatalogV3` (handleGenImage scope), `catalogBeach` / `catalogAvatar` / `catalogPose` (state), `CATALOG_BEACH_SCENES` / `CATALOG_POSES` (module-level).

- [ ] **Step 13: Commit**

```bash
cd /Users/dan/Desktop/Projects/titan-commerce
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "$(cat <<'EOF'
feat: Studio — "Product Catalog v3" style (Reference model / Pose / Beach scene / Resolution / Count)

New style pill in Product photos. Selecting it shows: Reference model (avatar Select,
required — no __preset__, empty-state hint), Pose pills, Beach scene pills (Bright
sunny / Golden hour / Dune grass / Rocky cove), Resolution, Count. AI model forced to
Nano Banana Pro (step 1). customInstr emits [catalog_beach:<id>] so the backend stores
the chosen scene for step 2. Generate disabled (greyed, with a hint) until an avatar
is picked; early-return guard in handleGenImage. v1 and v2 untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 14: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user — not part of the automated plan:

1. Studio → open a product → select the style pill "Product Catalog v3". Verify the UI shows: **Reference model** (a dropdown), **Pose** pills, **Beach scene** pills (Bright sunny / Golden hour / Dune grass / Rocky cove), **Resolution** pills, **Count**. Nothing else.
2. With no avatar picked → Generate is greyed/disabled + hint "Select a reference model above to generate."
3. Pick a persona avatar + a Pose + Beach scene (Bright sunny) + Count → Generate. Watch: the creative shows "generating" → ~1-3 min (step 1: studio shot) → still "generating" → ~30s-1 min (step 2: bg replace) → the final **beach photo** appears. Check: the model is the chosen avatar; the swimsuit is from the product reference and **lit evenly from all sides — no side shadow, no overexposure, no crushed black** (this is the pillar); the navel is covered; the background is the chosen beach scene, softly out of focus, not blown out; the model is tack sharp. Vercel log shows `[poll_generations] v3 step 1 done, submitted step 2 (bg replace)`. Try "Golden hour" → warmer background, the model lit the same. Generate 2-3×.
4. Edge: if Ideogram BG fails (watch the `[poll_generations]` log) → the result is the clean studio shot (status `pending`, `metadata.v3_error` set).
5. **Regression:** select "Product Catalog" (v1) and "Product Catalog v2" → confirm both still show their UIs and still generate normally.
6. Send a v3 result to the user/colleague for comparison with the reference photo + with v1/v2.

---

## Self-Review

**Spec coverage:** Spec §"Nový soubor `lib/v3-beach-scenes.js`" → Task1 ✓ (exact content from spec). Spec §Změny `api/creatives/generate.js` items 1-9: flag → Task2 Step1 ✓; image filter → Step2 ✓; `[catalog_beach:...]` parse → Step3 ✓; new STUDIO branch with `v3HasAvatar`/`v3GarmentLine`/`v3ModelLine`/`v3PoseText`/`v3ModelDesc` + clean-studio prompt + flat all-sides lighting + garment/face/camera/NEGATIVE → Step4 ✓; `refImages` + `outAspectRatio` → Step5 ✓; `falPrompt` → Step6 ✓; `configMeta` `stage:'studio'` + `v3_beach_scene` + `v3_aspect:'4:5'` → Step7 ✓. (Spec said `v3_aspect: outAspectRatio` — the plan hardcodes `'4:5'` since `outAspectRatio` for v3 IS `'4:5'` per Step5; equivalent and avoids a scope question about whether `outAspectRatio` is visible at the `configMeta` line. ✓) Spec §Změny `lib/actions/creatives.js` items 1-4: import → Task3 Step1 ✓; chain block in `completed` handler (stage studio → submit Ideogram BG, update stage='beach', continue; submit-failure → keep studio shot) → Step2 ✓; `failed` handler keeps studio shot at beach stage → Step3 ✓; timeout handler keeps studio shot at beach stage → Step4 ✓; background download/upload + `processCatalogImage` stays v1-only → not touched ✓. Spec §Změny `CreativeStudio.jsx` items 1-10: STYLE_MAP → Task4 Step1 ✓; STYLE_CATEGORIES → Step2 ✓; CATALOG_BEACH_SCENES + catalogBeach state → Steps 3-4 ✓; render-scope flags → Step5 ✓; handleGenImage flags + early-return → Steps 6-7 ✓; backendModel for v3 → covered (keyed on isAnyCatalog which Step7 extends; noted in Step9) ✓; v3 UI block (avatar Select + Pose pills + Beach scene pills) → Step10 ✓; customInstr v3 → Step8 ✓; generateCreatives v3 fields → Step9 ✓; Generate-disabled-without-avatar + Count/Resolution row gating (already `isAnyCatalogStyle`, Aspect ratio already v1-only) → Step11 + (Count/Resolution row already gated on `isAnyCatalogStyle` which Step5 extends — no extra task needed; the Aspect-ratio sub-condition is `!isProductCatalogV2Style` which would SHOW aspect ratio for v3 — wait: that's a gap. See note below) ✓. Spec §"poll_generations stays v1-only for processCatalogImage" → not touched ✓. Spec §Verifikace → Tasks 1-4 syntax/grep/test/build steps + Post-implementation ✓.

**Gap found & fixed inline:** The catalog Count/Aspect-ratio/Resolution row gates Aspect-ratio on `!isProductCatalogV2Style` — for v3 that's `true`, so Aspect ratio would show for v3. But the spec says v3 UI is "Reference model / Pose / Beach scene / Resolution / Count" — no Aspect ratio (v3 hardcodes 4:5). **Add to Task 4: Step 11b** — change the Aspect-ratio sub-gate from `{!isProductCatalogV2Style && (` to `{!isProductCatalogV2Style && !isProductCatalogV3Style && (` (around line 1061). I'll add this as a Step in Task 4 below the others.

→ **Task 4, Step 11b (added): Hide the Aspect-ratio pills for v3 in the catalog Count/Resolution row (~line 1061)**

Read line ~1061 to confirm it's `                {!isProductCatalogV2Style && (` (the wrapper around the Aspect-ratio `<div>` in the catalog-only Count/Aspect/Resolution row). Use the `Edit` tool. `old_string`:
```
                {!isProductCatalogV2Style && (
```
`new_string`:
```
                {!isProductCatalogV2Style && !isProductCatalogV3Style && (
```
(This `old_string` should be unique — it's the only place that exact line appears. If not, include the surrounding `<SectionLabel>Aspect ratio</SectionLabel>` context.)

— Build (Step 12), commit (Step 13), report SHA (Step 14) as before; do Step 11b before Step 12.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Step 10 of Task 4 says "read the actual lines first ... if unsure, ask before guessing" — that's not a placeholder, it's a real instruction for a tricky insertion point (the v2 block's closing braces appear in patterns; the engineer must locate the exact boundary). Acceptable.

**Type consistency:** Backend new identifiers: `isProductCatalogV3` (Task2), `v3BeachKey` (Task2 Step3, used in Step7), `v3HasAvatar`/`v3Custom`/`v3PoseText`/`v3ModelDesc`/`v3ModelLine`/`v3GarmentLine` (Task2 Step4, local to the branch). The new STUDIO prompt template literal interpolates only `${v3GarmentLine}`, `${v3ModelLine}`, `${product.title}`, `${v3PoseText}`, `${aspect_ratio || '4:5'}` — re-reading Step4's `new_string`: yes, only those. `buildV3BeachPrompt` (Task1) imported & called in Task3 with `meta.v3_beach_scene` — and `configMeta` writes `v3_beach_scene: v3BeachKey` (Task2 Step7) — match ✓. `meta.v3_aspect` written as `'4:5'` (Task2 Step7), read in Task3 Step2 as `meta.v3_aspect || '4:5'` ✓. `meta.stage` written `'studio'` (Task2 Step7) / `'beach'` (Task3 Step2), read in Task3 Steps 2/3/4 ✓. `meta.studio_url` written in Task3 Step2, read in Task3 Steps 3/4 ✓. `meta.v3_failed` written in Task3 Step2's submit-failure path + Steps 3/4, read in Task3 Step2's guard (`!meta.v3_failed`) ✓. Frontend: `catalogBeach` state (Task4 Step4), used in `customInstr` (Step8) + the Beach-scene pills (Step10) ✓. `CATALOG_BEACH_SCENES` (Step3), used in Step10 ✓. `isProductCatalogV3Style` (render scope, Step5), used in Steps 10/11/11b ✓. `isProductCatalogV3` (handleGenImage scope, Step7), used in Steps 8/9 ✓. The `customInstr` v3 branch emits `[catalog_beach:${catalogBeach}]` — the backend's `v3BeachKey` regex (`/\[catalog_beach:([^\]]+)\]/`) matches it ✓. The `audience` value sent for v3 is `catalogAvatar` (persona name) — the backend's line-59 lookup does `.eq('persona_name', audience)` ✓.

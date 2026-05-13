# Unify Product Catalog v1 UI with v3 + 4 Beach Scene Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce v1 "Product Catalog" UI to match v3's minimal layout — Reference model (avatar, required) + Pose + Beach scene (4 variants: sunny / golden / dune / cove) + Count + Resolution. Remove Model preset pills, Framing pills, and Aspect ratio from the v1 UI. The 4 beach scenes swap the scene-line and lighting-summary in the v1 single-shot prompt via a new `lib/v1-beach-scenes.js` helper. `sunny` is the current working baseline. Framing crop is hardcoded to `'three-quarter'` so `processCatalogImage` post-process still runs. v2, v3, Realistic Beach, PhotoStory untouched.

**Architecture:** New `lib/v1-beach-scenes.js` exporting `buildV1BeachScene(sceneKey)` → `{ sceneLine, lightingSummary }` for 4 scenes. Backend (`api/creatives/generate.js`): unify the existing v3 `[catalog_beach:...]` regex into a shared `beachKey` constant used by both v1 and v3, default `catalogFramingKey` to `'three-quarter'` for v1 (so post-process crops even when the frontend stops sending `[catalog_framing:...]`), interpolate `${v1Scene.sceneLine}` and `${v1Scene.lightingSummary}` into the v1 prompt at the two locations (lines 261 + 294), force `isThreeQuarter=true` for v1 when no FRAMING in custom_prompt (so the `framingBlock` activates), add `beach_scene` to `configMeta`. Frontend (`CreativeStudio.jsx`): replace the v1 UI block (currently avatar Select with `__preset__` + Model preset pills + Pose pills + Framing pills) with v3-style block (avatar Select required + Pose pills + Beach scene pills), simplify the v1 `customInstr` ternary, extend the existing `(isProductCatalogV2 || isProductCatalogV3)` field overrides + Generate-disabled guard to include v1 — easiest pattern: switch to `isAnyCatalogStyle && !catalogAvatar`. No new deps, no DB schema change.

**Tech Stack:** Node.js (Vercel serverless), React 19 + Vite, fal.ai Nano Banana Pro, Vitest (27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-13-product-catalog-v1-unify-with-v3-ui-and-beach-scenes-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — not a git repo). Repo on `main`; the user deploys via Vercel on push — intentional. Line numbers below are accurate as of commit `df6e241`.

---

## File Structure

- **Create:** `lib/v1-beach-scenes.js` — `buildV1BeachScene(sceneKey)` returns `{ sceneLine, lightingSummary }`. 4 scenes; `'sunny'` is the verbatim current v1 baseline. Single responsibility, ~50 lines.
- **Modify:** `api/creatives/generate.js` — unify beach-key parsing (~line 96), default `catalogFramingKey` to `'three-quarter'` (~line 100), import + use `buildV1BeachScene` in the v1 prompt branch (~lines 215-299), add v1 fallback for `isThreeQuarter` (~line 227), add `beach_scene` to `configMeta` (~line 595-621).
- **Modify:** `apps/dashboard/src/components/CreativeStudio.jsx` — add render-scope `isProductCatalogStyle` flag (~line 522), replace the v1 UI block (~lines 858-901), simplify v1 `customInstr` (~line 591-592), extend `generateCreatives` field overrides for v1 (~lines 603-614), extend early-return guard (~line 556), switch Generate-button guard to `isAnyCatalogStyle && !catalogAvatar` (~lines 1095-1107), switch Aspect-ratio sub-gate to `!isAnyCatalogStyle` (~line 1054).
- **Unchanged:** v2 and v3 prompt branches, Realistic Beach, PhotoStory, `lib/avatar-crop.js`, `lib/v3-beach-scenes.js`, `lib/fal.js`, `lib/actions/creatives.js`, `apps/dashboard/src/lib/api.js`. `CATALOG_MODELS` and `CATALOG_FRAMINGS` arrays stay in `CreativeStudio.jsx` (just not rendered for v1 anymore).

Three tasks. Task 1 (new helper) is trivial — controller can do directly. Task 2 (backend) and Task 3 (frontend) are dispatched to subagents.

---

### Task 1: New `lib/v1-beach-scenes.js`

**Files:**
- Create: `lib/v1-beach-scenes.js`

- [ ] **Step 1: Create the file**

Use the `Write` tool to create `lib/v1-beach-scenes.js` with exactly this content:

```js
// Beach scene variants for Product Catalog v1 (single-shot generation).
// Each scene replaces two passages in the v1 prompt: the scene line at api/creatives/generate.js:261
// and the lighting summary line at api/creatives/generate.js:294. 'sunny' is the working baseline
// (verbatim copy of what the prompt has today). 'golden', 'dune', 'cove' are new variants — they
// only swap scene + lighting summary; all the anti-side-light / anti-overexposure / face / camera
// guardrails elsewhere in the prompt stay in place.
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

- [ ] **Step 2: Syntax check**

Run: `node --check lib/v1-beach-scenes.js`
Expected: exit 0, no output.

- [ ] **Step 3: Smoke test the helper**

Run:
```bash
node -e "import('./lib/v1-beach-scenes.js').then(m => {
  const s = m.buildV1BeachScene('golden');
  console.log('keys:', Object.keys(s).join(','));
  console.log('golden scene first 30:', s.sceneLine.slice(0, 30));
  console.log('golden lighting first 30:', s.lightingSummary.slice(0, 30));
  console.log('fallback sunny:', m.buildV1BeachScene('nonsense').sceneLine.slice(0, 30) === m.buildV1BeachScene('sunny').sceneLine.slice(0, 30));
});"
```
Expected:
```
keys: sceneLine,lightingSummary
golden scene first 30: She is barefoot on a real beac
golden lighting first 30: LIGHTING — READ THIS: warm gol
fallback sunny: true
```

- [ ] **Step 4: Commit**

```bash
git add lib/v1-beach-scenes.js
git commit -m "$(cat <<'EOF'
feat: lib/v1-beach-scenes — 4 scene+lighting variants for Product Catalog v1

buildV1BeachScene(sceneKey) returns { sceneLine, lightingSummary } for
sunny/golden/dune/cove. 'sunny' = verbatim current v1 baseline (no-op for the
default case). Other variants swap only those two passages — anti-side-light /
anti-overexposure / face / camera guardrails stay in place. Falls back to 'sunny'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push after all tasks.

- [ ] **Step 5: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 2: Backend — `api/creatives/generate.js` v1 prompt accepts beach scene variants

**Files:**
- Modify: `api/creatives/generate.js`

**Context for the engineer:** `api/creatives/generate.js` is the creative-generation handler. Around lines 92-96 it sets `isProductCatalog` / `isProductCatalogV2` / `isProductCatalogV3` flags and parses a `v3BeachKey` from `[catalog_beach:...]` in `custom_prompt`. Around lines 98-101 it parses `catalogFramingKey` from `[catalog_framing:...]` (used by `processCatalogImage` post-process to crop the finished image to a framing). The big `if (isProductCatalog) {...}` block (~lines 215-299) builds the v1 prompt — among other things it hardcodes the beach scene + lighting summary, and uses `framingBlock`/`framingNegative` derived from the `FRAMING:` text inside `custom_prompt`. We're changing: (a) unify the beach-key parsing so it's used for both v1 and v3 — same variable, no duplication; (b) default `catalogFramingKey` to `'three-quarter'` for v1 so post-process still crops even when the frontend stops sending the `[catalog_framing:...]` tag; (c) interpolate `${v1Scene.sceneLine}` and `${v1Scene.lightingSummary}` at the two hardcoded passages; (d) when the v1 `custom_prompt` has no `FRAMING:` text, force `isThreeQuarter=true` so the `framingBlock` reminder still gets included in the prompt; (e) record `beach_scene` in `configMeta` for audit. Make ONLY the changes below; do not touch the v2 or v3 prompt branches, `processCatalogImage`, Realistic Beach, or `lib/actions/creatives.js`.

- [ ] **Step 1: Add the import**

Find the existing imports at the top of `api/creatives/generate.js`. Look for `import { submitFalJob } from '../../lib/fal.js';` (line 3). Use the `Edit` tool to insert a new import next to it. `old_string`:
```
import { submitFalJob } from '../../lib/fal.js';
```
`new_string`:
```
import { submitFalJob } from '../../lib/fal.js';
import { buildV1BeachScene } from '../../lib/v1-beach-scenes.js';
```

- [ ] **Step 2: Unify the beach-key parsing for v1 + v3 (~line 96)**

Read lines 92-97 to confirm:
```js
    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
    const isProductCatalogV2 = style === 'product_catalog_v2';
    const isProductCatalogV3 = style === 'product_catalog_v3';
    const v3BeachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
```
Use the `Edit` tool. `old_string`:
```
    const v3BeachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
```
`new_string`:
```
    // Beach scene key — used by both v1 (selects scene+lighting variant in the single-shot prompt)
    // and v3 (selects the master beach prompt for step 2). 'sunny' is the default for both.
    const beachKey = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/)?.[1]?.trim() || 'sunny';
    const v3BeachKey = beachKey; // back-compat alias for the v3 branch + configMeta
```

(Note: keeping `v3BeachKey` as an alias so we don't have to find-and-replace every use site of `v3BeachKey` in the v3 branch and `configMeta`. The new `beachKey` is what the v1 branch will use.)

- [ ] **Step 3: Default `catalogFramingKey` to `'three-quarter'` for v1 (~line 99-101)**

Read lines 98-101 to confirm:
```js
    // Product Catalog framing → crop key for the avatar reference (full body → null = no crop)
    const catalogFramingLabel = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/)?.[1]?.trim();
    const catalogFramingKey = isProductCatalog
      ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || null)
      : null;
```
Use the `Edit` tool. `old_string`:
```
    const catalogFramingKey = isProductCatalog
      ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || null)
      : null;
```
`new_string`:
```
    const catalogFramingKey = isProductCatalog
      ? ({ '3/4 body': 'three-quarter', 'Waist up': 'waist-up', 'Detail crop': 'detail' }[catalogFramingLabel] || 'three-quarter')
      : null;
```

(Only the `null` at the end becomes `'three-quarter'`. Everything else unchanged. This means even when the frontend stops sending `[catalog_framing:...]`, post-process `processCatalogImage` will still crop to 3/4.)

- [ ] **Step 4: Compute `v1Scene` + force `isThreeQuarter` when no FRAMING text (inside `if (isProductCatalog)` block, around line 227)**

Read lines 215-230 to confirm the structure of the v1 branch start. We're adding two things at the very top of the branch: (a) compute `v1Scene` from `beachKey`, (b) after `isThreeQuarter` is computed, override it to `true` when no FRAMING text was present (so `framingBlock` still activates).

Use the `Edit` tool. `old_string`:
```
    if (isProductCatalog) {
      // Parse catalog config from custom_prompt (model desc, pose, framing)
      const catalogCustom = custom_prompt ? custom_prompt.replace(/\[catalog_[^\]]+\]/g, '').trim() : '';
      // Extract model description (everything before POSE:)
      const modelDescMatch = catalogCustom.match(/^([\s\S]*?)(?=POSE:|$)/);
      const modelDesc = modelDescMatch ? modelDescMatch[1].trim() : 'Mid-size woman, US size 12-14, natural soft body with visible curves, late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no tattoos.';
      // Extract pose + framing (everything from POSE: onwards)
      const poseAndFraming = catalogCustom.includes('POSE:') ? catalogCustom.slice(catalogCustom.indexOf('POSE:')) : 'POSE: Standing facing camera, weight on right hip, arms relaxed, warm genuine smile.';
      // Extract framing reminder for end of prompt (recency bias)
      // Extract full framing text (all sentences after FRAMING:)
      const framingSection = poseAndFraming.match(/FRAMING:\s*([\s\S]*?)$/);
      const framingText = framingSection ? framingSection[1].trim() : '';
      const isThreeQuarter = framingText.includes('mid-calf') || framingText.includes('Do NOT show feet');
      const isWaistUp = framingText.includes('waist/hip level') || framingText.includes('Upper body portrait');
      const isDetailCrop = framingText.includes('chest to upper thigh') || framingText.includes('No face visible');
      const isNonFullFraming = isThreeQuarter || isWaistUp || isDetailCrop;
```
`new_string`:
```
    if (isProductCatalog) {
      // Beach scene variant (sunny/golden/dune/cove) — swaps the scene line and lighting summary.
      const v1Scene = buildV1BeachScene(beachKey);
      // Parse catalog config from custom_prompt (model desc, pose, framing)
      const catalogCustom = custom_prompt ? custom_prompt.replace(/\[catalog_[^\]]+\]/g, '').trim() : '';
      // Extract model description (everything before POSE:)
      const modelDescMatch = catalogCustom.match(/^([\s\S]*?)(?=POSE:|$)/);
      const modelDesc = modelDescMatch ? modelDescMatch[1].trim() : 'Mid-size woman, US size 12-14, natural soft body with visible curves, late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no tattoos.';
      // Extract pose + framing (everything from POSE: onwards)
      const poseAndFraming = catalogCustom.includes('POSE:') ? catalogCustom.slice(catalogCustom.indexOf('POSE:')) : 'POSE: Standing facing camera, weight on right hip, arms relaxed, warm genuine smile.';
      // Extract framing reminder for end of prompt (recency bias)
      // Extract full framing text (all sentences after FRAMING:)
      const framingSection = poseAndFraming.match(/FRAMING:\s*([\s\S]*?)$/);
      const framingText = framingSection ? framingSection[1].trim() : '';
      // v1 always uses 3/4 framing (post-process crops the finished image). When the frontend stops
      // sending [catalog_framing:...] and there's no FRAMING: text, force isThreeQuarter so the
      // framingBlock reminder still gets included in the prompt.
      const isThreeQuarter = framingText.includes('mid-calf') || framingText.includes('Do NOT show feet') || !framingText;
      const isWaistUp = framingText.includes('waist/hip level') || framingText.includes('Upper body portrait');
      const isDetailCrop = framingText.includes('chest to upper thigh') || framingText.includes('No face visible');
      const isNonFullFraming = isThreeQuarter || isWaistUp || isDetailCrop;
```

(Two additions: `const v1Scene = buildV1BeachScene(beachKey);` near the top, and the `|| !framingText` on the `isThreeQuarter` line. Everything else unchanged.)

- [ ] **Step 5: Interpolate `${v1Scene.sceneLine}` at the hardcoded scene line (~line 261)**

Use the `Edit` tool. `old_string` (the entire scene line — one long paragraph line at 261):
```
She is barefoot on a real beach, standing on sand on a bright sunny day. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves on one side, soft dry sand with a few dune grasses / beach grass, a low dune line, and a bright BLUE sky with a few scattered soft white clouds and light haze near the horizon. A clear, warm, sunny beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real beach: you can see the sea, the waves, the sand, the dune grass, the blue sky with clouds.
```
`new_string`:
```
${v1Scene.sceneLine}
```

- [ ] **Step 6: Interpolate `${v1Scene.lightingSummary}` at the hardcoded "LIGHTING — READ THIS" line (~line 294)**

Use the `Edit` tool. `old_string` (the entire lighting summary line — one long paragraph line at 294):
```
LIGHTING — READ THIS: natural frontal daylight on the model and product (the sun is behind the camera) — well-exposed and clearly readable, a natural balanced true-to-life exposure, NOT dim and NOT overexposed / blown out / washed out. Subtle warm light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon, background holds full visible detail (NOT blown out to white, sand and sky NOT vaporised). Warm, clean grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black.
```
`new_string`:
```
${v1Scene.lightingSummary}
```

- [ ] **Step 7: Add `beach_scene` to `configMeta` (~lines 595-621)**

Find the `configMeta` object. There's `const catalogModelMatch = ...`, `catalogPoseMatch = ...`, `catalogFramingMatch = ...` at lines 595-597 — add a fourth match line right after. Use the `Edit` tool. `old_string`:
```
    const catalogModelMatch = (custom_prompt || '').match(/\[catalog_model:([^\]]+)\]/);
    const catalogPoseMatch = (custom_prompt || '').match(/\[catalog_pose:([^\]]+)\]/);
    const catalogFramingMatch = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/);
```
`new_string`:
```
    const catalogModelMatch = (custom_prompt || '').match(/\[catalog_model:([^\]]+)\]/);
    const catalogPoseMatch = (custom_prompt || '').match(/\[catalog_pose:([^\]]+)\]/);
    const catalogFramingMatch = (custom_prompt || '').match(/\[catalog_framing:([^\]]+)\]/);
    const catalogBeachMatch = (custom_prompt || '').match(/\[catalog_beach:([^\]]+)\]/);
```

Then add the corresponding spread in the `configMeta` object. Read lines 611-614 to confirm the structure (`...(catalogModelMatch && { catalog_model: ... }),` etc.). Use the `Edit` tool. `old_string`:
```
      ...(catalogModelMatch && { catalog_model: catalogModelMatch[1].trim() }),
      ...(catalogPoseMatch && { pose: catalogPoseMatch[1].trim() }),
      ...(catalogFramingMatch && { framing: catalogFramingMatch[1].trim() }),
```
`new_string`:
```
      ...(catalogModelMatch && { catalog_model: catalogModelMatch[1].trim() }),
      ...(catalogPoseMatch && { pose: catalogPoseMatch[1].trim() }),
      ...(catalogFramingMatch && { framing: catalogFramingMatch[1].trim() }),
      ...(catalogBeachMatch && { beach_scene: catalogBeachMatch[1].trim() }),
```

- [ ] **Step 8: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 9: Grep checks**

```bash
grep -c "buildV1BeachScene" api/creatives/generate.js                            # expect 2 (import + use)
grep -c "const beachKey = " api/creatives/generate.js                            # expect 1
grep -c "v3BeachKey = beachKey" api/creatives/generate.js                        # expect 1
grep -c "\${v1Scene.sceneLine}" api/creatives/generate.js                        # expect 1
grep -c "\${v1Scene.lightingSummary}" api/creatives/generate.js                  # expect 1
grep -c "catalogBeachMatch" api/creatives/generate.js                            # expect 2 (def + use)
grep -c "|| 'three-quarter')" api/creatives/generate.js                          # expect 1
grep -c "|| !framingText" api/creatives/generate.js                              # expect 1
grep -c "She is barefoot on a real beach, standing on sand on a bright sunny day" api/creatives/generate.js  # expect 0 (moved to v1-beach-scenes.js)
grep -c "natural frontal daylight on the model and product" api/creatives/generate.js  # expect 0 (moved)
```

- [ ] **Step 10: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 11: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: backend — Product Catalog v1 accepts beach scene variants + always-3/4 default

- Unify [catalog_beach:...] parsing into shared `beachKey` (used by v1 + v3).
- v1 prompt now interpolates ${v1Scene.sceneLine} and ${v1Scene.lightingSummary}
  from buildV1BeachScene(beachKey). 'sunny' = the previous baseline verbatim;
  'golden' / 'dune' / 'cove' swap the scene + lighting summary, all other v1
  guardrails (anti-side-light, anti-overexposure, face, camera, NEGATIVE) stay.
- catalogFramingKey defaults to 'three-quarter' for v1 (post-process crops even
  when the frontend stops sending [catalog_framing:...]).
- isThreeQuarter forces true when no FRAMING: text in custom_prompt — keeps the
  framingBlock reminder in the prompt.
- configMeta records beach_scene for audit.

Spec: Docs/superpowers/specs/2026-05-13-product-catalog-v1-unify-with-v3-ui-and-beach-scenes-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 12: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 3: Frontend — `CreativeStudio.jsx` v1 UI matches v3 (Reference model / Pose / Beach scene)

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

**Context for the engineer:** `CreativeStudio.jsx` is the Studio creative-generation UI. v2 ("product-catalog-v2") and v3 ("product-catalog-v3") have a minimal UI: Reference model (avatar dropdown required, no `__preset__`, empty-state hint) + Pose + (v3 only: Beach scene) + Count + Resolution. v1 ("product-catalog") still has the full historical UI: Reference model with a `__preset__` fallback option, 3 Model preset pills, 6 Pose pills, 4 Framing pills, plus a Count/Aspect ratio/Resolution row. We're reducing v1 to match v3 — adding Beach scene pills (already exists as `CATALOG_BEACH_SCENES` const), removing Model preset/Framing/Aspect ratio. The render-scope flag for "is v1?" doesn't exist yet — currently `isProductCatalogStyle` is only declared inside `handleGenImage` (line 577). Add a render-scope one at line 522 alongside `isProductCatalogV3Style`. Then the gates that say `(isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar` become simpler: use `isAnyCatalogStyle && !catalogAvatar` (since `isAnyCatalogStyle` already includes v1). Make ONLY the changes below; do not touch the v2 or v3 UI blocks, `CATALOG_MODELS`, `CATALOG_FRAMINGS`, `CATALOG_BEACH_SCENES`, `CATALOG_POSES`. The `catalogModel` and `catalogFraming` state stays — just not rendered in v1's UI anymore.

- [ ] **Step 1: Add render-scope `isProductCatalogStyle` (~line 522)**

Read lines 521-524 to confirm:
```js
  const showSceneForAb = SCENE_STYLES.has(abStyle);
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
Use the `Edit` tool. `old_string`:
```
  const showSceneForAb = SCENE_STYLES.has(abStyle);
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
`new_string`:
```
  const showSceneForAb = SCENE_STYLES.has(abStyle);
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isProductCatalogV1Style = imgStyle === "product-catalog";
  const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```

(Note: chose `isProductCatalogV1Style` to keep parallel naming with v2/v3. The existing `isProductCatalogStyle` inside `handleGenImage` already uses the older name — we leave that alone since it works.)

- [ ] **Step 2: Extend the `handleGenImage` early-return guard for v1 (~line 556)**

Read line 556 to confirm:
```js
    if ((imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```
Use the `Edit` tool. `old_string`:
```
    if ((imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```
`new_string`:
```
    if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```

- [ ] **Step 3: Simplify the v1 `customInstr` ternary (~line 591-592)**

Read lines 587-593 to confirm:
```js
    const customInstr = isProductCatalogV3
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_framing:${catalogFramingLabel}]\n${catalogModelBlock}${catalogPosePrompt}\n\n${catalogFramingPrompt}` + (imgInstructions ? `\n${imgInstructions}` : '')
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```
Use the `Edit` tool. `old_string`:
```
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_framing:${catalogFramingLabel}]\n${catalogModelBlock}${catalogPosePrompt}\n\n${catalogFramingPrompt}` + (imgInstructions ? `\n${imgInstructions}` : '')
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```
`new_string`:
```
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```

(Removed: `[catalog_framing:...]` tag, `${catalogModelBlock}` text block, `${catalogFramingPrompt}` text block, `imgInstructions` suffix. Added: `[catalog_beach:${catalogBeach}]` tag.)

- [ ] **Step 4: Extend the `generateCreatives` field overrides for v1 (~lines 603-614)**

Read lines 603-615 to confirm. Use the `Edit` tool. `old_string`:
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
`new_string`:
```
            show_model: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? true : subject === "On model",
            text_overlay: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "" : (textMode === "Custom" ? customText : ""),
            audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogStyle) ? undefined : colorRef,
```

(Added `|| isProductCatalogStyle` to five lines. `audience` line already had it — unchanged.)

- [ ] **Step 5: Replace the v1 UI block (~lines 858-901)**

The current v1 UI block starts at line 857 with the comment `{/* Catalog controls — only for product-catalog style */}` and ends at line 901 with `</>)}`. Read lines 857-901 to confirm. Use the `Edit` tool. `old_string`:
```
          {/* Catalog controls — only for product-catalog style */}
          {imgStyle === "product-catalog" && (
            <>
              <div>
                <SectionLabel>Reference model</SectionLabel>
                <Select
                  value={catalogAvatar || "__preset__"}
                  onChange={(v) => setCatalogAvatar(v === "__preset__" ? null : v)}
                  options={["__preset__", ...personas.filter((p) => p.reference_url).map((p) => p.name)]}
                  renderOption={(opt) => opt === "__preset__"
                    ? "Use text preset below"
                    : `${opt} (${personas.find((p) => p.name === opt)?.age || ""}) — ${personas.find((p) => p.name === opt)?.label || "avatar"}`}
                />
                {catalogAvatar && (
                  <div style={{ fontSize: 11, color: TEXT_MID, marginTop: 4 }}>
                    Using avatar "{catalogAvatar}" — the model presets below are ignored.
                  </div>
                )}
              </div>
              <div>
                <SectionLabel>Model preset</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_MODELS.map((m) => (
                    <Pill key={m.id} active={catalogModel === m.id && !catalogAvatar} disabled={!!catalogAvatar} onClick={() => setCatalogModel(m.id)}>{m.label}</Pill>
                  ))}
                </div>
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
                <SectionLabel>Framing</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_FRAMINGS.map((f) => (
                    <Pill key={f.id} active={catalogFraming === f.id} onClick={() => setCatalogFraming(f.id)}>{f.label}</Pill>
                  ))}
                </div>
              </div>
            </>
          )}
```
`new_string`:
```
          {/* Catalog v1 controls — Reference model (avatar, required) + Pose + Beach scene; framing/aspect/model preset removed, post-process always crops to 3/4 */}
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

- [ ] **Step 6: Switch the Aspect-ratio sub-gate to `!isAnyCatalogStyle` (~line 1054)**

Read line 1054 (the wrapper around the Aspect-ratio `<div>` in the catalog Count/Aspect/Resolution row). Use the `Edit` tool. `old_string`:
```
                {!isProductCatalogV2Style && !isProductCatalogV3Style && (
```
`new_string`:
```
                {!isAnyCatalogStyle && (
```

(All three catalog styles now hide Aspect ratio — v1 uses hardcoded 4:5 like v2/v3.)

- [ ] **Step 7: Switch the Generate-button hint + disabled guard to `isAnyCatalogStyle && !catalogAvatar` (~lines 1095-1107)**

Read lines 1095-1107 to confirm. Use the `Edit` tool. `old_string`:
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
`new_string`:
```
          {isAnyCatalogStyle && !catalogAvatar && (
            <div style={{ fontSize: 11, color: TEXT_MID, marginTop: "1rem" }}>Select a reference model above to generate.</div>
          )}
          <button onClick={handleGenImage} disabled={generating || (isAnyCatalogStyle && !catalogAvatar)} style={{
            width: "100%", marginTop: (isAnyCatalogStyle && !catalogAvatar) ? "0.5rem" : "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: (isAnyCatalogStyle && !catalogAvatar)
              ? "rgba(255,255,255,0.08)"
              : abMode
              ? `linear-gradient(135deg, ${NEON} 0%, ${CYAN} 100%)`
              : `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: (isAnyCatalogStyle && !catalogAvatar) ? TEXT_MID : BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: (isAnyCatalogStyle && !catalogAvatar) ? "not-allowed" : "pointer", transition: "all 0.25s",
            boxShadow: (isAnyCatalogStyle && !catalogAvatar) ? "none" : NEON_GLOW_BTN,
          }}>
```

(All five `(isProductCatalogV2Style || isProductCatalogV3Style) && !catalogAvatar` become `isAnyCatalogStyle && !catalogAvatar`. Simpler and correctly covers v1.)

- [ ] **Step 8: Build the frontend**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds (Vite output, `dist/` written). No NEW errors referencing `CreativeStudio.jsx`. If it fails on an undefined variable, check scope: `imgStyle` (state), `isAnyCatalogStyle` / `isProductCatalogV1Style` / `TEXT_MID` (render-scope / module), `catalogAvatar` / `catalogPose` / `catalogBeach` (state), `CATALOG_BEACH_SCENES` / `CATALOG_POSES` (module-level).

- [ ] **Step 9: Commit**

```bash
cd /Users/dan/Desktop/Projects/titan-commerce
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "$(cat <<'EOF'
feat: Studio — unify v1 Product Catalog UI with v3 (Reference model / Pose / Beach scene / Resolution / Count)

v1 UI reduced to match v3 1:1. Removed: __preset__ fallback in avatar Select,
3 Model preset pills, 4 Framing pills, Aspect ratio. Added: Beach scene pills
(sunny/golden/dune/cove). Generate disabled (greyed, with a hint) until an avatar
is picked — switched the guard to `isAnyCatalogStyle && !catalogAvatar` so v1, v2,
and v3 share the same code path. customInstr for v1 emits [catalog_beach:<id>]
instead of [catalog_framing:<label>]. CATALOG_MODELS / CATALOG_FRAMINGS arrays
kept in the file (no longer rendered for v1). v2 and v3 untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 10: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user — not part of the automated plan:

1. Studio → open a product → select the style pill **"Product Catalog"** (v1). Verify the UI shows:
   - **Reference model** (a dropdown — NOT 3 pills, NOT a `__preset__` "Use text preset below" option)
   - **Pose** pills (6×)
   - **Beach scene** pills (4×: Bright sunny / Golden hour / Dune grass / Rocky cove)
   - **Count** + **Resolution** (NO Aspect ratio)
   - Nothing else. No Model preset, no Framing.
2. With no avatar picked → Generate is greyed/disabled + hint "Select a reference model above to generate."
3. Pick a persona avatar + a Pose + Beach scene = **Bright sunny** + Count = 1 + 2K → Generate. Output: same as today's v1 baseline (bright sunny beach, 3/4 framing, navel hidden, avatar identity). Vercel log: `[generate]` metadata should include `beach_scene: sunny`.
4. Switch to **Golden hour** → output: warm low-sun late-afternoon beach, model unchanged, 3/4 framing.
5. Switch to **Dune grass** → output: scene with tall beach grass framing the model, dune line, sky beyond.
6. Switch to **Rocky cove** → output: turquoise water, smooth pebbles, soft cliff in the bokeh.
7. Generate 2-3× per variant — identity holds across generations.
8. **Regression:** select "Product Catalog v2" and "Product Catalog v3" → confirm both still show their existing UIs and generate normally.
9. Edge: store with no persona avatars → v1 shows hint "No persona avatars yet — create one in the Avatars tab to use this style." Generate disabled.

---

## Self-Review

**Spec coverage:** Spec §"Změny v `CreativeStudio.jsx`" items 1-8 → Task 3 Steps 1-7 ✓ (state lines untouched per spec; useCallback deps unchanged). Spec §"Nový soubor `lib/v1-beach-scenes.js`" → Task 1 ✓. Spec §"Změny v `api/creatives/generate.js`" items 1-5: import → Task 2 Step 1 ✓; unified beach-key → Step 2 ✓; default `catalogFramingKey='three-quarter'` → Step 3 ✓; v1 prompt interpolation + `isThreeQuarter` fallback → Steps 4/5/6 ✓; `beach_scene` in configMeta → Step 7 ✓. Spec §"Co se NEmění" — v2/v3 prompt branches, Realistic Beach, PhotoStory, lib/avatar-crop, lib/v3-beach-scenes, lib/fal, lib/actions/creatives, api.js, CATALOG_MODELS/CATALOG_FRAMINGS arrays, persona avatar auto-injection, isHighWaistTummy logic — no task touches them ✓. Spec §Verifikace → manual verification section ✓.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every Step has the exact `old_string`/`new_string` or exact command + expected output. The new helper file content in Task 1 Step 1 is the verbatim spec content. ✓

**Type consistency:** Backend: `beachKey` (Task 2 Step 2, shared) + `v3BeachKey` alias for back-compat. `v1Scene` returned by `buildV1BeachScene(beachKey)` has `{ sceneLine, lightingSummary }` (Task 1 Step 1) — used in `${v1Scene.sceneLine}` and `${v1Scene.lightingSummary}` (Task 2 Steps 5/6). `catalogBeachMatch` regex (Task 2 Step 7) matches the `[catalog_beach:<id>]` tag the frontend emits (Task 3 Step 3). Frontend: `isProductCatalogV1Style` (new, Task 3 Step 1) follows the parallel naming of `isProductCatalogV2Style`/`isProductCatalogV3Style`; not strictly needed by later steps (they use `isAnyCatalogStyle`), but introduced for future symmetry. `catalogBeach` state (already exists from v3 work) reused. `catalogModel` / `catalogFraming` state kept but no longer rendered. `CATALOG_BEACH_SCENES` const reused. ✓

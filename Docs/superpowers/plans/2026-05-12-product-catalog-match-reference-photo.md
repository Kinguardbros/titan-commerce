# Product Catalog — Match Reference Photo (Frontal Soft Sun Pivot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the Product Catalog image-generation prompt from "no visible sun / flat softbox" toward the colleague's reference photo (bright frontal sun, warm clean grade, blue sky with soft clouds, recognizable beach) while keeping the anti-side-light NEGATIVE terms that guard against the earlier hard side-shadow problem.

**Architecture:** Single-file edit — `api/creatives/generate.js`, the `if (isProductCatalog)` prompt block (~lines 246-288). Four targeted string replacements: (1) scene/background sentence, (2) the `=== LIGHTING ===` block, (3) the `LIGHTING — READ THIS` summary line, (4) the `NEGATIVE:` line. No new files, no new deps, no DB/routing/frontend changes. Prompt content has no automated test — verification is `node --check`, `npm test` (regression), and grep checks for the new/removed phrases.

**Tech Stack:** Node.js (Vercel serverless), Vitest (existing 27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-12-product-catalog-match-reference-photo-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — that's not a git repo).

---

## File Structure

- **Modify only:** `api/creatives/generate.js` — the `if (isProductCatalog)` branch, prompt template literal (~lines 246-288). Four `Edit` replacements.
- **Unchanged:** everything else — `lib/avatar-crop.js`, `lib/actions/creatives.js`, `apps/dashboard/src/components/CreativeStudio.jsx`, Realistic Beach branch, all other styles, `configMeta`, `package.json`.

The four edited regions are independent strings inside one template literal; they can all be done in one task.

---

### Task 1: Rewrite the Product Catalog lighting/scene prompt

**Files:**
- Modify: `api/creatives/generate.js` (the `if (isProductCatalog)` prompt block, ~lines 246-288)

**Context for the engineer:** `api/creatives/generate.js` builds a giant prompt string for fal.ai's Nano Banana `/edit` model. The `isProductCatalog` branch (around line 206) assembles `prompt = \`...\``. The model copies lighting/composition cues from this text and from reference images. The current text was tuned over many iterations to avoid harsh side-lit golden-hour shadows on the garment — it now says "no visible sun, flat softbox, zero directional shadows". We're pivoting toward a *frontal soft sun* look (sun behind the camera, warm grade, blue sky with clouds) — keeping the anti-*side*-light language but removing the anti-*sun-entirely* language. Make ONLY the four replacements below; do not touch `poseAndFraming`, `framingBlock`, `framingNegative`, the `CAMERA:` line (line 279), the `FACE QUALITY` block, the `Hyperrealistic … 85mm … 8K` line, the `isHighWaistTummy` block, `catalogReferenceRules`/`catalogModelLine`/`catalogFinalCheck`, or `${aspect_ratio}` handling.

- [ ] **Step 1: Replace the scene / background sentence (line ~252)**

Use the `Edit` tool. `old_string` (exact, the whole line 252):

```
She is barefoot on a real beach, standing on sand. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves, wet and dry sand, and a CLEAN bright LIGHT-BLUE sky with only a few small wispy high clouds — but NO visible sun, no sunbeam, no glare. A calm, clear, bright beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a beach: you can see the sea, the sand, the clean blue sky.
```

`new_string`:

```
She is barefoot on a real beach, standing on sand on a bright sunny day. Behind her is a CLEARLY VISIBLE beach scene: ocean with gentle waves on one side, soft dry sand with a few dune grasses / beach grass, a low dune line, and a bright BLUE sky with a few scattered soft white clouds and light haze near the horizon. A clear, warm, sunny beach day. NOT a featureless white blur, NOT a heavy grey overcast, NOT studio fog. The background is softly out of focus (shallow depth of field, model tack sharp) but it is unmistakably a real beach: you can see the sea, the waves, the sand, the dune grass, the blue sky with clouds.
```

- [ ] **Step 2: Replace the `=== LIGHTING — READ CAREFULLY ===` block (lines ~254-263)**

Use the `Edit` tool. `old_string` (exact — the full block from the top border line through the bottom border line, lines 254-263):

```
━━━━━━━━━━━━━━━━━━━━━━━━
=== LIGHTING — READ CAREFULLY, DO NOT SKIP THIS ===
SKY: a CLEAN bright light-blue sky with only a few small wispy high clouds. No visible sun disc, no sunbeam, no glare. NOT a heavy grey overcast, but also NOT a hard sunny day with a blazing sun casting shadows.

LIGHT ON THE MODEL: even though the sky is clear and blue, the SUN ITSELF is NOT in frame and is veiled by a high thin haze — so the light falling on the model is FLAT, SOFT, and comes EVENLY from a broad bright sky, like a giant softbox. There is NO single hard light source pointed at her. Therefore there are NO directional cast shadows — no shadow stretching off to one side, no dark side of the body, no hard shadow on the sand, no shadow under the bust, no shadow on either leg. Bright but soft, like a professional shoot done outdoors under a huge diffuser.

EXPOSURE: the MODEL and SWIMSUIT are BRIGHT — high-key, airy, well-lit, never dim, never dark, never moody. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette. The BACKGROUND is also properly exposed — visible sea, sand, and a clean light-blue sky — NOT blown out to pure white, NOT a foggy haze.

THE GARMENT: the SWIMSUIT is the hero of this photo and must be evenly, fully, brightly lit — every part clearly visible and crisply readable: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband. The swimsuit is exposed a touch BRIGHTER than a perfectly neutral exposure — the shadows on the fabric are lifted, so even the deepest folds and the underside of the bust stay fully readable; the garment never goes dim, muddy, or grey-flat. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO shadows on the swimsuit. (This brighter exposure applies to the GARMENT only — it does NOT change the light on the scene, the sky, or the direction of light: the sky stays a clean light-blue with no visible sun, the light on the model stays flat and soft, the background stays a properly-exposed real beach.) If any part of the garment sinks into shadow, OR a directional shadow appears on the body / sand, OR the background is a featureless white blur or a gloomy dark grey, the result is WRONG.
━━━━━━━━━━━━━━━━━━━━━━━━
```

`new_string`:

```
━━━━━━━━━━━━━━━━━━━━━━━━
=== LIGHTING — READ CAREFULLY, DO NOT SKIP THIS ===
SKY: a bright clear BLUE sky with a few real, soft, white clouds and light haze near the horizon. NOT a flat cloudless sky, NOT a heavy grey overcast.

LIGHT ON THE MODEL: bright natural daylight. The SUN IS BEHIND THE CAMERA — a frontal light source — so the model and the swimsuit are lit EVENLY FROM THE FRONT, bright and fully readable. The light has a subtle warm, slightly golden quality (late-morning real sun, lightly hazy) — not harsh, not glaring. Only SOFT NATURAL shadows: a gentle shadow under the chin, a soft shadow tucked behind an arm. There is NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO directional shadow streaking across the sand. Frontal soft sun — never side-lit, never harsh.

EXPOSURE: the MODEL and SWIMSUIT are BRIGHT — well-lit, airy, never dim, never dark, never moody. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette. The BACKGROUND is also properly exposed — visible sea, waves, sand, dune grass, and a blue sky with clouds — NOT blown out to pure white, NOT a foggy haze.

THE GARMENT: the SWIMSUIT is the hero of this photo and must be evenly, fully, brightly lit — every part clearly visible and crisply readable: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband. The swimsuit is exposed a touch BRIGHTER than a perfectly neutral exposure — the shadows on the fabric are lifted, so even the deepest folds and the underside of the bust stay fully readable; the garment never goes dim, muddy, or grey-flat. The LOWER HALF (briefs / bottoms / skirt) is lit just as brightly as the top — it does NOT fall darker. ZERO hard shadows on the swimsuit. (This brighter exposure applies to the GARMENT only — it does NOT change the scene: the sky stays a bright blue with soft clouds, the sun stays behind the camera, the background stays a properly-exposed real beach.) If any part of the garment sinks into shadow, OR a hard directional / side-lit shadow appears on the body / garment / sand, OR the background is a featureless white blur or a gloomy dark grey, the result is WRONG.

GRADE: warm, clean, slightly bright — sun-kissed skin and hair, true-to-life colors. NOT a cool / grey / blue grade, NOT a heavy orange filter, NOT washed-out, NOT flat lifeless lighting.
━━━━━━━━━━━━━━━━━━━━━━━━
```

- [ ] **Step 3: Replace the `LIGHTING — READ THIS` summary line (line ~283)**

Use the `Edit` tool. `old_string` (exact, the whole line 283):

```
LIGHTING — READ THIS: a clean bright light-blue sky with just a few wispy high clouds — but NO visible sun disc, NO sunbeam. The sun stays behind a high thin haze, so the light on the model is flat, soft and even — like a giant softbox. NO directional cast shadows anywhere (not on the body, not on the sand, not on the garment). Bright high-key exposure. NOT a hard cloudless sunny day with a blazing sun, NOT golden hour, NOT moody, NOT a heavy grey overcast. The swimsuit is evenly and brightly lit, every detail readable, black fabric shows texture (not crushed black).
```

`new_string`:

```
LIGHTING — READ THIS: bright natural daylight with the SUN BEHIND THE CAMERA (frontal) — the model and product lit evenly from the front, bright and fully readable. Subtle warm, slightly golden light. Only SOFT NATURAL shadows — NO hard side-lit / directional shadow on the product, body, or sand. Bright BLUE sky with a few soft white clouds, light haze at the horizon. Warm, clean, slightly bright grade — NOT cool/grey, NOT a heavy orange filter, NOT washed-out, NOT moody, NOT a heavy grey overcast. Black fabric shows texture, not crushed black.
```

- [ ] **Step 4: Edit the `NEGATIVE:` line (line ~288) — remove anti-sun terms, add anti-washed-out terms**

Use the `Edit` tool. This line is a template literal with `${...}` interpolations — only edit the literal-text portion. `old_string` (exact substring of line 288 — the literal text between the interpolations):

```
heavy grey overcast, gloomy dark sky, direct hard sunlight, blazing visible sun, harsh sunbeam, cloudless hard sunny day, directional shadow, hard cast shadow, side lighting, side-angle sun, golden hour, sunset, sunrise, low-angle sun, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, dark areas on the garment, swimsuit lost in shadow, underlit swimsuit, crushed blacks, garment crushed to pure black, dramatic lighting, moody lighting, dim, dark photo, underexposed, heavy orange filter, plastic skin
```

`new_string`:

```
heavy grey overcast, gloomy dark sky, directional shadow, hard cast shadow, side lighting, side-angle sun, shadow on the sand to one side, dark side of the body, shadow on one leg, shadow under the bust, deep shadows on the swimsuit, dark areas on the garment, swimsuit lost in shadow, underlit swimsuit, crushed blacks, garment crushed to pure black, dramatic lighting, moody lighting, dim, dark photo, underexposed, heavy orange filter, washed-out colors, flat lifeless lighting, cool blue grade, plastic skin
```

(Net effect: removed `direct hard sunlight, blazing visible sun, harsh sunbeam, cloudless hard sunny day, golden hour, sunset, sunrise, low-angle sun`; kept `side lighting, side-angle sun, hard cast shadow, directional shadow` and all the dark/underexposed/crushed-black terms; added `washed-out colors, flat lifeless lighting, cool blue grade`.)

- [ ] **Step 5: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 6: Grep checks — confirm the pivot landed**

Run:
```bash
grep -c "SUN IS BEHIND THE CAMERA" api/creatives/generate.js          # expect: 1
grep -c "no visible sun" api/creatives/generate.js                     # expect: 0  (case-sensitive; the only remaining mention is intentional context inside other phrases — see note)
grep -c "giant softbox" api/creatives/generate.js                      # expect: 0
grep -c "washed-out colors" api/creatives/generate.js                  # expect: 1
grep -c "blazing visible sun" api/creatives/generate.js                # expect: 0
grep -c "side lighting" api/creatives/generate.js                      # expect: 1  (kept in NEGATIVE)
grep -c "GRADE: warm" api/creatives/generate.js                        # expect: 1
```
If any count is wrong, re-check the corresponding Edit. (Note: `grep -i "no visible sun"` may still match `no visible sun` inside the parenthetical you replaced — but Step 2's new_string has no such phrase, so a case-sensitive `grep -c "no visible sun"` should be 0. If it's not, you missed part of Step 2.)

- [ ] **Step 7: Run the test suite (regression)**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`. (No test touches prompt content; this just confirms nothing else broke.)

- [ ] **Step 8: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: Product Catalog — frontal soft-sun lighting (match reference photo)

Pivot the lighting prompt from "no visible sun / flat softbox" to bright frontal
sunlight (sun behind the camera, warm clean grade, blue sky with soft clouds,
recognizable beach with dune grass). Keep the anti-side-light NEGATIVE terms
(side lighting, side-angle sun, hard cast shadow, dark side of the body, ...)
that guard against the earlier hard side-shadow problem; drop the anti-sun terms
(blazing sun, golden hour, cloudless hard sunny day, ...). Add washed-out/flat/
cool-grade negatives. Spec: Docs/superpowers/specs/2026-05-12-product-catalog-match-reference-photo-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Push**

Run: `git push origin main`
Expected: push succeeds (the user deploys via Vercel on push).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

Not part of the automated plan — for the user/colleague to run:

1. Studio → Product Catalog. Recommended settings for the closest match to the reference photo:
   - **Avatar:** an avatar resembling the reference (curly blonde, plus-size, ~30, natural makeup); if no avatar → **Model preset = "Model 1 (38) Everyday"**
   - **Pose:** "Hero Front"
   - **Framing:** "3/4 body"
   - **Resolution:** 2K (default)
   - **Aspect ratio:** tall portrait if offered (4:5 default is fine)
2. Generate 3-4 times. Compare to the reference photo:
   - (a) bright frontal sunlight, subtle warm tone on skin/hair, NOT a flat softbox, NOT a cool grey grade
   - (b) only soft natural shadows — NO hard side-lit / directional shadow on the product or sand
   - (c) blue sky with a few soft clouds, recognizable beach (sea, waves, sand, dune grass), light haze at the horizon
   - (d) eye-level camera, NOT shot from below; ~head-to-mid-calf framing (3/4)
   - (e) the black swimwear set bright and fully readable, black fabric shows texture, not crushed black
   - (f) model identity matches the selected avatar/preset (unchanged)
3. **Regression check:** if the earlier hard *side* shadow on the product comes back → revert this commit OR strengthen `side lighting` / `side-angle sun` / `hard cast shadow` in NEGATIVE and reinforce "the sun is behind the camera, frontal, never to the side" in the LIGHTING block. Do NOT revert all the way back to "no visible sun" (that overshot).
4. Send a result to Ondra for comparison with the reference.

---

## Self-Review

**Spec coverage:** Spec §Změny item 1 (scene sentence) → Task 1 Step 1 ✓. Item 2 (`=== LIGHTING ===` block, incl. SKY / SUN-LIGHT-ON-MODEL / EXPOSURE-GARMENT kept / GRADE added) → Step 2 ✓. Item 3 (`LIGHTING — READ THIS` summary) → Step 3 ✓. Item 4 (NEGATIVE: remove anti-sun, keep anti-side-light, add washed-out/flat/cool-grade) → Step 4 ✓. Spec "beze změny" list (poseAndFraming, framingBlock, CAMERA line, FACE QUALITY, Hyperrealistic line, isHighWaistTummy, identity lines, aspect_ratio, post-process, CROP_FRACTIONS, frontend, other styles) → explicitly out of scope, no task touches them ✓. Spec §Doporučené nastavení → Post-implementation verification §1 (it's guidance, not code) ✓. Spec §Verifikace → Steps 5-7 + Post-implementation §2-4 ✓. Spec §Pozn. "samostatný commit, snadno revertnout" → Step 8 single commit with clear message ✓. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every Step has the exact `old_string`/`new_string` or exact command. ✓

**Type consistency:** N/A — no new functions/types; pure string edits in one file. The four `old_string`s are verbatim from the current `api/creatives/generate.js` lines 252, 254-263, 283, and a substring of 288. The `EXPOSURE` and `THE GARMENT` paragraphs in Step 2's new_string preserve the working "garment bright / black not crushed / lower half as bright" language per the spec's "ZACHOVAT". ✓

# Product Catalog v2 (Golden Hour) Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second creative style "Product Catalog v2" (golden hour) alongside the existing "Product Catalog", using the user's verbatim golden-hour prompt with two substitutions (Model preset replaces the hardcoded model line; Pose preset replaces `[INSERT POSE VARIANT FROM BELOW]`). In Studio, selecting v2 shows only: Pose pills, Model pills, Resolution pills, Count — nothing else. AI model is always Nano Banana Pro (hidden). The existing Product Catalog (v1) is untouched.

**Architecture:** Backend (`api/creatives/generate.js`): new `isProductCatalogV2` flag + a new `else if (isProductCatalogV2)` prompt branch + hook v2 into the image-filter and Nano-Banana routing alongside v1. Frontend (`apps/dashboard/src/components/CreativeStudio.jsx`): add the style to `STYLE_MAP` + `STYLE_CATEGORIES`, derive `isProductCatalogV2` / `isAnyCatalog`, replace `imgStyle !== "product-catalog"` gates with `!isAnyCatalog`, add a v2-only UI block (Model + Pose pills, reusing `CATALOG_MODELS`/`CATALOG_POSES`), extend `customInstr` and the `generateCreatives` call for v2, gate Aspect-ratio out of the catalog Count/Resolution row for v2 only. No post-process for v2 (`poll_generations` stays v1-only). No new deps, no DB changes.

**Tech Stack:** Node.js (Vercel serverless), React 19 + Vite, fal.ai Nano Banana Pro, Vitest (27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-12-product-catalog-v2-style-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — not a git repo). Repo is on `main`; the user deploys via Vercel on push — intentional. Line numbers below are accurate as of commit `2844bec`.

---

## File Structure

- **Modify:** `api/creatives/generate.js` — `isProductCatalogV2` flag (~line 93), image filter (~line 113), avatar-injection guard (~line 59, no-op), new prompt branch (after ~line 297), Nano-Banana routing: `refImages` / `outAspectRatio` / `falPrompt` (~lines 398-421).
- **Modify:** `apps/dashboard/src/components/CreativeStudio.jsx` — `STYLE_MAP` (~line 29), `STYLE_CATEGORIES` (~line 103), `backendStyle`/`backendModel` (~lines 544-546), the catalog-prompt-vars block + `customInstr` (~lines 558-570), `generateCreatives` call (~lines 578-590), the `imgStyle !== "product-catalog"` gates (~lines 732, 750, 757, 799, 811, 823, 881, 892), the catalog-only Count/Ratio/Resolution row (~line 1012), and a new v2-only UI block (after ~line 878).
- **Unchanged:** `lib/actions/creatives.js` (`poll_generations` stays v1-only), `lib/avatar-crop.js`, `lib/higgsfield.js`, `apps/dashboard/src/lib/api.js`, the entire v1 Product Catalog logic, Realistic Beach, all other styles.

Two tasks: **Task 1 = backend** (so the `/api/creatives/generate` endpoint handles `product_catalog_v2` before the frontend can send it), **Task 2 = frontend**. Each commits independently.

---

### Task 1: Backend — `product_catalog_v2` prompt branch + routing

**Files:**
- Modify: `api/creatives/generate.js`

**Context for the engineer:** `api/creatives/generate.js` builds a prompt string for fal.ai's Nano Banana `/edit` model. Around line 92-93 it sets `isRealisticBeach` / `isProductCatalog` from `style`. Around line 113 it filters out previously-pushed AI creatives from the product's image list for audience/standalone flows. The big `if (isProductCatalog) {...} else if (isRealisticBeach) {...} else {...}` block (~lines 212-330) builds `prompt`. Then around lines 385-426 it routes to fal.ai Nano Banana with the reference images (the "sandwich" for v1-with-avatar, or just product images otherwise). We're adding a third standalone style `product_catalog_v2` that behaves like v1 but with a completely different, self-contained prompt (the user's golden-hour prompt) and NO avatar / NO framing-crop machinery. Make ONLY the changes below; do not touch v1's `isProductCatalog` logic, `catalogHighWaist`, `catalogFramingKey`, `framingBlock`, the `isRealisticBeach` branch, or `poll_generations`.

- [ ] **Step 1: Add `isProductCatalogV2` flag (line ~93)**

Read lines 92-93 to confirm:
```js
    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
```
Use the `Edit` tool. `old_string`:
```
    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
```
`new_string`:
```
    const isRealisticBeach = style === 'realistic_beach';
    const isProductCatalog = style === 'product_catalog';
    const isProductCatalogV2 = style === 'product_catalog_v2';
```

- [ ] **Step 2: Include v2 in the image filter (line ~113)**

Read line 113 to confirm it is `if (audience || isProductCatalog || isRealisticBeach) {`. Use the `Edit` tool. `old_string`:
```
    if (audience || isProductCatalog || isRealisticBeach) {
```
`new_string`:
```
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2) {
```

- [ ] **Step 3: Add the `else if (isProductCatalogV2)` prompt branch (after line ~297)**

Find the line `} else if (isRealisticBeach) {` (~line 297). The branch we add goes BEFORE it — i.e. change `} else if (isRealisticBeach) {` to `} else if (isProductCatalogV2) { <new branch body> } else if (isRealisticBeach) {`. Use the `Edit` tool. `old_string` (the exact line, ~297):
```
    } else if (isRealisticBeach) {
```
`new_string` (note: this is a template literal — keep the backticks and `${...}` exactly):
```
    } else if (isProductCatalogV2) {
      // Golden-hour Product Catalog v2 — verbatim prompt, two substitutions: ${modelDesc} from the
      // chosen Model preset, ${poseText} from the chosen Pose preset. No avatar, no framing crop.
      const v2Custom = (custom_prompt || '').replace(/\[catalog_[^\]]+\]/g, '').trim();
      const v2ModelDesc = (v2Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1] || '').trim()
        || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';
      const v2PoseText = v2Custom.includes('POSE:')
        ? v2Custom.slice(v2Custom.indexOf('POSE:')).trim()
        : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';
      prompt = `Use the swimsuit shown in the attached image as the exact reference garment. Recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign, restyle, or reinterpret the swimsuit. The garment in the attached image is the product, replicate it exactly.

Professional e-commerce swimwear product photography. ${v2ModelDesc}

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

${v2PoseText}

Hyperrealistic, photographic, editorial swimwear catalog quality, shot on 85mm lens at f/2.8, Canon R5 look, true-to-life skin texture and fabric texture.`;
    } else if (isRealisticBeach) {
```

- [ ] **Step 4: Route v2 in the Nano Banana block — `refImages`, `outAspectRatio`, `falPrompt` (lines ~398-421)**

Read lines 398-404 to confirm:
```js
        const outAspectRatio = aspect_ratio;
        // Product Catalog: with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                  without an avatar     → 1 product image only (packshot/flat-lay,
        //                                          not a model shot), model comes from the prompt's modelDesc
        const refImages = isProductCatalog
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
Use the `Edit` tool. `old_string`:
```
        const outAspectRatio = aspect_ratio;
        // Product Catalog: with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                  without an avatar     → 1 product image only (packshot/flat-lay,
        //                                          not a model shot), model comes from the prompt's modelDesc
        const refImages = isProductCatalog
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
`new_string`:
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

Then read line ~418-421 to confirm:
```js
        const productCheck = isProductCatalog ? '' : `\n\n━━━...
        const falPrompt = isProductCatalog
          ? prompt  // Product Catalog prompt is self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```
Use the `Edit` tool. `old_string`:
```
        const falPrompt = isProductCatalog
          ? prompt  // Product Catalog prompt is self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```
`new_string`:
```
        const falPrompt = (isProductCatalog || isProductCatalogV2)
          ? prompt  // Product Catalog prompts are self-contained — no extra wrappers
          : `${productInstr}${colorOverride}\n\n${prompt}${identityLock}${ageReminder}${coverageReminder}${productCheck}`;
```

(Note: `productCheck` on the line just above stays `isProductCatalog ? '' : ...` — that's fine; it's only referenced inside the non-catalog branch of `falPrompt`, which v2 never hits. Don't change it.)

- [ ] **Step 5: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 6: Grep checks**

```bash
grep -c "isProductCatalogV2" api/creatives/generate.js          # expect 5  (flag def + image filter + branch condition + outAspectRatio + refImages + falPrompt = actually 6; count and accept >=5)
grep -c "else if (isProductCatalogV2)" api/creatives/generate.js # expect 1
grep -c "golden hour, ocean and sky softly out of focus" api/creatives/generate.js  # expect 1
grep -c "Repeat: high-waisted bottoms, navel fully covered" api/creatives/generate.js  # expect 1
grep -c "isProductCatalog =" api/creatives/generate.js          # expect 1  (v1 flag unchanged)
```
(If `isProductCatalogV2` count is 6 not 5, that's fine — flag def, image filter, branch condition, two routing edits in Step 4 = 5-6 occurrences.)

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 8: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: backend — product_catalog_v2 style (golden hour, verbatim prompt)

New standalone style alongside product_catalog: self-contained golden-hour prompt
with two substitutions (model desc from the chosen preset, pose text from the
chosen preset). Routes like v1 (Nano Banana Pro, product image as reference,
hardcoded 4:5), but no avatar sandwich, no framing crop, no high-waist machinery
(the prompt's GARMENT RULES already cover navel coverage). poll_generations
post-process stays v1-only. Spec: Docs/superpowers/specs/2026-05-12-product-catalog-v2-style-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push after both tasks.

- [ ] **Step 9: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 2: Frontend — "Product Catalog v2" style + minimal Studio UI

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

**Context for the engineer:** `CreativeStudio.jsx` is the Studio creative-generation UI. Styles live in `STYLE_MAP` (id → backend key) and `STYLE_CATEGORIES` (the picker UI). The existing "product-catalog" style hides most of the default UI (model picker, subject, pose, body, framing, scene, A/B, text, custom instructions, negative prompt) via `imgStyle !== "product-catalog"` gates, and shows a special block with: Reference model (avatar) Select, Model preset pills, Pose pills, Framing pills — plus a separate Count/Aspect-ratio/Resolution row. We're adding "product-catalog-v2" which shares almost all the v1 *hiding* behaviour but its special block shows ONLY Model preset pills + Pose pills (no avatar, no framing), and its Count/Resolution row has NO aspect-ratio (the v2 backend prompt hardcodes 4:5). The fal model is forced to Nano Banana Pro for both. Reuse the existing `CATALOG_MODELS` / `CATALOG_POSES` arrays and the `catalogModel` / `catalogPose` state — only one catalog style is active at a time, so sharing state is fine. Make ONLY the changes below.

- [ ] **Step 1: Add v2 to `STYLE_MAP` (line ~30)**

Read lines 29-31 to confirm:
```js
const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "realistic-beach": "realistic_beach",
```
Use the `Edit` tool. `old_string`:
```
const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "realistic-beach": "realistic_beach",
```
`new_string`:
```
const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "realistic-beach": "realistic_beach",
```

- [ ] **Step 2: Add v2 to `STYLE_CATEGORIES` "product-photos" (line ~103)**

Read lines 102-104 to confirm:
```js
    styles: [
      { id: "product-catalog", title: "Product Catalog", desc: "Pro e-commerce, golden hour beach, editorial", icon: "📸" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```
Use the `Edit` tool. `old_string`:
```
    styles: [
      { id: "product-catalog", title: "Product Catalog", desc: "Pro e-commerce, golden hour beach, editorial", icon: "📸" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```
`new_string`:
```
    styles: [
      { id: "product-catalog", title: "Product Catalog", desc: "Pro e-commerce, bright beach, editorial", icon: "📸" },
      { id: "product-catalog-v2", title: "Product Catalog v2", desc: "Golden hour, subject pops, simple controls", icon: "🌅" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```

- [ ] **Step 3: Force Nano Banana Pro for both catalog styles + derive `isProductCatalogV2` / `isAnyCatalog` (lines ~544-558)**

Read lines 544-558 to confirm (the `backendStyle` / `backendModel` / `isProductCatalogStyle` lines). Use the `Edit` tool. `old_string`:
```
    const backendStyle = imgStyle.startsWith('cs_') ? imgStyle : (STYLE_MAP[imgStyle] || "ad_creative");
    // Product Catalog hides the model picker — force Nano Banana Pro (best identity preservation)
    const backendModel = imgStyle === 'product-catalog' ? "fal_nano_banana_pro" : (MODEL_MAP[imgModel] || "fal_nano_banana");
```
`new_string`:
```
    const backendStyle = imgStyle.startsWith('cs_') ? imgStyle : (STYLE_MAP[imgStyle] || "ad_creative");
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2;
    // Catalog styles hide the model picker — force Nano Banana Pro (best identity preservation)
    const backendModel = isAnyCatalog ? "fal_nano_banana_pro" : (MODEL_MAP[imgModel] || "fal_nano_banana");
```

Then read line ~558 to confirm `const isProductCatalogStyle = imgStyle === 'product-catalog';` and the catalog-vars block (lines 559-570). Use the `Edit` tool. `old_string`:
```
    const isProductCatalogStyle = imgStyle === 'product-catalog';
    const catalogPosePrompt = isProductCatalogStyle ? (CATALOG_POSES.find(p => p.id === catalogPose)?.prompt || '') : '';
    const catalogModelPrompt = isProductCatalogStyle ? (CATALOG_MODELS.find(m => m.id === catalogModel)?.prompt || '') : '';
    const catalogFramingPrompt = isProductCatalogStyle ? (CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.prompt || '') : '';
    const catalogModelLabel = catalogAvatar || (CATALOG_MODELS.find(m => m.id === catalogModel)?.label || '');
    const catalogPoseLabel = CATALOG_POSES.find(p => p.id === catalogPose)?.label || '';
    const catalogFramingLabel = CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.label || '';
    // When an avatar is chosen, the model comes from the avatar reference (sent via `audience`),
    // so leave the model description out of custom_prompt.
    const catalogModelBlock = isProductCatalogStyle && !catalogAvatar ? `${catalogModelPrompt}\n\n` : '';
    const customInstr = isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_framing:${catalogFramingLabel}]\n${catalogModelBlock}${catalogPosePrompt}\n\n${catalogFramingPrompt}` + (imgInstructions ? `\n${imgInstructions}` : '')
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```
`new_string`:
```
    const isProductCatalogStyle = imgStyle === 'product-catalog';
    const catalogPosePrompt = isAnyCatalog ? (CATALOG_POSES.find(p => p.id === catalogPose)?.prompt || '') : '';
    const catalogModelPrompt = isAnyCatalog ? (CATALOG_MODELS.find(m => m.id === catalogModel)?.prompt || '') : '';
    const catalogFramingPrompt = isProductCatalogStyle ? (CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.prompt || '') : '';
    const catalogModelLabel = catalogAvatar || (CATALOG_MODELS.find(m => m.id === catalogModel)?.label || '');
    const catalogPoseLabel = CATALOG_POSES.find(p => p.id === catalogPose)?.label || '';
    const catalogFramingLabel = CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.label || '';
    // v1: when an avatar is chosen, the model comes from the avatar reference (sent via `audience`),
    // so leave the model description out of custom_prompt.
    const catalogModelBlock = isProductCatalogStyle && !catalogAvatar ? `${catalogModelPrompt}\n\n` : '';
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogModelPrompt}\n\n${catalogPosePrompt}`
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_framing:${catalogFramingLabel}]\n${catalogModelBlock}${catalogPosePrompt}\n\n${catalogFramingPrompt}` + (imgInstructions ? `\n${imgInstructions}` : '')
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```

(Note: `catalogModelLabel` uses `catalogAvatar` — for v2, `catalogAvatar` is never set by the UI, so it falls through to the model preset label. That's correct.)

- [ ] **Step 4: Extend the `generateCreatives` call for v2 (lines ~578-590)**

Read lines 578-590. Use the `Edit` tool. `old_string`:
```
          generateCreatives({
            product_id: product.id, store_id: storeId, style: bs, ai_model: backendModel,
            custom_prompt: customInstr,
            show_model: subject === "On model",
            text_overlay: textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom",
            overlay_text: textMode === "Custom" ? customText : "",
            audience: isProductCatalogStyle
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: colorRef,
          }).then(() => setCompleted((p) => p + 1))
```
`new_string`:
```
          generateCreatives({
            product_id: product.id, store_id: storeId, style: bs, ai_model: backendModel,
            custom_prompt: customInstr,
            show_model: isProductCatalogV2 ? true : subject === "On model",
            text_overlay: isProductCatalogV2 ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: isProductCatalogV2 ? "" : (textMode === "Custom" ? customText : ""),
            audience: isProductCatalogV2
              ? undefined
              : isProductCatalogStyle
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: isProductCatalogV2 ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: isProductCatalogV2 ? undefined : colorRef,
          }).then(() => setCompleted((p) => p + 1))
```

(Note: `isProductCatalogV2` is defined inside `handleGenImage` in Step 3. Verify it's in scope here — it should be, both are in the same callback body. If not, move the `const isProductCatalogV2 = ...` up so it's defined before line 578.)

- [ ] **Step 5: Replace `imgStyle !== "product-catalog"` gates with `!isAnyCatalog` (multiple lines)**

There are several gates that hide the default UI for v1; they must hide it for v2 too. These are in the JSX render, NOT in `handleGenImage` — so `isAnyCatalog` from Step 3 is NOT in scope there. **Add a render-scope derived constant** near the top of the component's render body (alongside other derived render constants like `showSceneForStyle`). Find where `showSceneForStyle` (or similar) is defined in the render scope and add right after it:
```js
  const isAnyCatalogStyle = imgStyle === "product-catalog" || imgStyle === "product-catalog-v2";
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
(If you can't find `showSceneForStyle`, add these two lines just before the `return (` of the main render. They must be at component-render scope, used by the JSX below.)

Then replace each of these `imgStyle !== "product-catalog"` occurrences with `!isAnyCatalogStyle`:
- Line ~732: `{imgStyle !== "product-catalog" && (` → `{!isAnyCatalogStyle && (`  (Model + Subject grid)
- Line ~750: `{imgStyle !== "product-catalog" && <div ...>` → `{!isAnyCatalogStyle && <div ...>`  (Color + Audience)
- Line ~757: `... && imgStyle !== "product-catalog" && (` → `... && !isAnyCatalogStyle && (`  (Audience targeting inner — it's `personas.length > 0 && subject === "On model" && imgStyle !== "realistic-beach" && imgStyle !== "product-catalog" && (`)
- Line ~799: `... && imgStyle !== "product-catalog" && (` → `... && !isAnyCatalogStyle && (`  (Model pose)
- Line ~811: `... && imgStyle !== "product-catalog" && (` → `... && !isAnyCatalogStyle && (`  (Body type)
- Line ~823: `... && imgStyle !== "product-catalog" && (` → `... && !isAnyCatalogStyle && (`  (Framing)
- Line ~881: `{showSceneForStyle && !abMode && imgStyle !== "product-catalog" && (` → `{showSceneForStyle && !abMode && !isAnyCatalogStyle && (`  (Scene)
- Line ~892: `{imgStyle !== "product-catalog" && (<>` → `{!isAnyCatalogStyle && (<>`  (A/B + Text+Count + Ratio + Resolution + Instructions + Negative — the big block, closes at line ~1009 `</>)}`)

Do these as 8 separate `Edit` calls (each `old_string` is the exact line; if a line appears more than once, include enough surrounding context to make it unique — most have a distinct comment above them).

- [ ] **Step 6: Update the catalog-only Count/Ratio/Resolution row to cover v2, hiding Aspect ratio for v2 (line ~1012)**

Read lines 1011-1041. Use the `Edit` tool. `old_string`:
```
          {/* Count + Ratio + Resolution for product-catalog (shown separately since the block above is hidden) */}
          {imgStyle === "product-catalog" && (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "end", marginTop: "1rem", flexWrap: "wrap" }}>
                <div>
                  <SectionLabel>Count</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <NumBtn key={n} active={imgCount === n} onClick={() => setImgCount(n)}>{n}</NumBtn>
                    ))}
                  </div>
                </div>
                <div>
                  <SectionLabel>Aspect ratio</SectionLabel>
                  <div style={{ display: "flex", gap: 10 }}>
                    {IMG_RATIOS.map((r) => (
                      <RatioBox key={r.label} {...r} active={imgRatio === r.label} onClick={() => setImgRatio(r.label)} />
                    ))}
                  </div>
                </div>
                <div>
                  <SectionLabel>Resolution</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {IMG_RESOLUTIONS.map((r) => (
                      <Pill key={r} active={imgResolution === r} onClick={() => setImgResolution(r)}>{r}</Pill>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
```
`new_string`:
```
          {/* Count + (Ratio for v1 only) + Resolution for catalog styles (the big block above is hidden) */}
          {isAnyCatalogStyle && (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "end", marginTop: "1rem", flexWrap: "wrap" }}>
                <div>
                  <SectionLabel>Count</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <NumBtn key={n} active={imgCount === n} onClick={() => setImgCount(n)}>{n}</NumBtn>
                    ))}
                  </div>
                </div>
                {!isProductCatalogV2Style && (
                  <div>
                    <SectionLabel>Aspect ratio</SectionLabel>
                    <div style={{ display: "flex", gap: 10 }}>
                      {IMG_RATIOS.map((r) => (
                        <RatioBox key={r.label} {...r} active={imgRatio === r.label} onClick={() => setImgRatio(r.label)} />
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <SectionLabel>Resolution</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    {IMG_RESOLUTIONS.map((r) => (
                      <Pill key={r} active={imgResolution === r} onClick={() => setImgResolution(r)}>{r}</Pill>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
```

- [ ] **Step 7: Add the v2-only UI block (Model pills + Pose pills) after the v1 catalog block (after line ~878)**

The v1 catalog block ends at line ~878 with `</>)}` (closing the `{imgStyle === "product-catalog" && (<>...`). Right after that closing, add a new sibling block. Read lines 876-880 to find the exact closing. Use the `Edit` tool — `old_string` (the v1 block's closing + the next line, to anchor the insertion):
```
              </div>
            </>
          )}

          {/* Scene — conditional on style, hidden for product-catalog */}
```
`new_string`:
```
              </div>
            </>
          )}

          {/* Catalog v2 controls — only Model preset + Pose (everything else hardcoded in the v2 prompt) */}
          {imgStyle === "product-catalog-v2" && (
            <>
              <div>
                <SectionLabel>Model preset</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_MODELS.map((m) => (
                    <Pill key={m.id} active={catalogModel === m.id} onClick={() => setCatalogModel(m.id)}>{m.label}</Pill>
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
            </>
          )}

          {/* Scene — conditional on style, hidden for catalog styles */}
```

(Note: this assumes the line after the v1 block was `{/* Scene — conditional on style, hidden for product-catalog */}` then `{showSceneForStyle && !abMode && imgStyle !== "product-catalog" && (`. If Step 5 already changed that gate to `!isAnyCatalogStyle`, the comment text may differ — anchor on `</>` `)}` + blank line + `{/* Scene` and adjust the comment in `new_string` to match what's there. The key is: insert the v2 block between the v1 catalog block and the Scene block.)

- [ ] **Step 8: Build the frontend**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds (Vite output, `dist/` written). Pre-existing ESLint warnings in other files are fine; there must be no NEW errors referencing `CreativeStudio.jsx`. If the build fails on an undefined variable (`isAnyCatalogStyle`, `isProductCatalogV2Style`, `isProductCatalogV2`), check the scope — render-scope constants (Steps 5, 6, 7) vs `handleGenImage`-scope constants (Steps 3, 4) are separate; each must be defined in the scope where it's used.

- [ ] **Step 9: Commit**

```bash
cd /Users/dan/Desktop/Projects/titan-commerce
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "$(cat <<'EOF'
feat: Studio — "Product Catalog v2" style with minimal UI (Pose / Model / Resolution / Count)

New style pill in Product photos. Selecting it shows only Pose pills, Model preset
pills, Resolution pills, and Count — no avatar picker, no framing pills, no aspect
ratio (v2 prompt hardcodes 4:5), no custom instructions, no on-model toggle. AI
model forced to Nano Banana Pro (hidden). Reuses CATALOG_MODELS / CATALOG_POSES /
catalogModel / catalogPose. v1 Product Catalog untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push.

- [ ] **Step 10: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user — not part of the automated plan:

1. Studio → product picker → open a product → select the style pill **"Product Catalog v2"**. Verify the UI shows **ONLY**: Model preset pills (3×), Pose pills (6×), Resolution pills, Count (1-4). NO Reference model / avatar Select, NO Framing pills, NO Aspect ratio, NO custom instructions textarea, NO Subject (On model/Product only) toggle, NO AI model picker, NO A/B mode, NO text-in-image, NO negative prompt.
2. Pick a Model preset + Pose + Resolution + Count, click Generate. Output: golden-hour beach, "subject pops forward / background slightly darker & cooler", the model matches the chosen preset, the pose matches, the swimsuit copied from the product reference, 4:5 vertical, two-piece bottoms high-waisted with the navel covered (it's in the prompt's GARMENT RULES). Generate 2-3×.
3. **Regression:** select the existing "Product Catalog" (v1) → confirm it still shows the full v1 UI (Reference model avatar Select, Model preset, Pose, Framing pills, Count/Aspect/Resolution row) and still generates with the bright-frontal-sun prompt + framing crop + brightness lift.
4. Send a v2 result to the user/colleague for comparison with the reference photo they sent.

---

## Self-Review

**Spec coverage:** Spec §Změny `CreativeStudio.jsx` item 1 (STYLE_MAP) → Task2 Step1 ✓. Item 2 (STYLE_CATEGORIES) → Task2 Step2 ✓. Item 3 (isProductCatalogV2 / isAnyCatalog) → Task2 Step3 (handleGenImage scope) + Step5 (render scope: isAnyCatalogStyle / isProductCatalogV2Style) ✓. Item 4 (backendModel) → Task2 Step3 ✓. Item 5 (UI gating `!isAnyCatalog`) → Task2 Step5 (8 gates) ✓. Item 6 (catalog Count/Resolution row, Aspect ratio v1-only) → Task2 Step6 ✓. Item 7 (v1 block unchanged) → not touched ✓. Item 8 (new v2 UI block: Model + Pose pills, no avatar/framing) → Task2 Step7 ✓. Item 9 (customInstr for v2) → Task2 Step3 ✓. Item 10 (generateCreatives for v2) → Task2 Step4 ✓. Spec §Změny `api/creatives/generate.js` item 1 (isProductCatalogV2 flag) → Task1 Step1 ✓. Item 2 (avatar guard no-op) → not touched, audience is undefined for v2 — verified, no change needed ✓. Item 3 (image filter) → Task1 Step2 ✓. Item 4 (new else-if branch with verbatim prompt + 2 substitutions + fallbacks) → Task1 Step3 ✓. Item 5 (refImages v2) → Task1 Step4 ✓. Item 6 (outAspectRatio 4:5) → Task1 Step4 ✓. Item 7 (configMeta — catalog_model/pose extracted from tags, framing_crop not set for v2) → no change needed; `catalogModelMatch`/`catalogPoseMatch` already match the `[catalog_model:...]`/`[catalog_pose:...]` tags v2's customInstr emits, and `catalogFramingKey` is `isProductCatalog ? ... : null` so it's null for v2 ✓. Item 8 (submitFalJob — uses falModelUsed=bananaModel since ai_model=fal_nano_banana_pro, refImages, outAspectRatio, resolution) → covered by Task1 Step4 + the existing line 423 which already does `submitFalJob({ model: falModelUsed, prompt: falPrompt, imageUrl: refImages, aspectRatio: outAspectRatio, resolution })` ✓. Item 9 (falModelUsed = nano-banana-pro for v2) → automatic: `ai_model === 'fal_nano_banana_pro'` enters the line-385 branch, `bananaModel = 'fal-ai/nano-banana-pro/edit'`, `falModelUsed = bananaModel` at line 422 ✓. Spec §"poll_generations stays v1-only" → not touched ✓. Spec §Verifikace → Task1 Steps 5-7 + Task2 Step8 + Post-implementation ✓. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step has the exact `old_string`/`new_string` or exact command + expected output. Step 5 of Task 2 lists 8 specific line edits with the exact text to change. ✓

**Type consistency:** Frontend new identifiers: `isProductCatalogV2` (handleGenImage scope, Task2 Step3), `isAnyCatalog` (handleGenImage scope, Task2 Step3), `isAnyCatalogStyle` + `isProductCatalogV2Style` (render scope, Task2 Step5) — used consistently in Steps 4-7. `customInstr` for v2 emits `[catalog_model:...][catalog_pose:...]` tags which the backend's existing `catalogModelMatch` / `catalogPoseMatch` regexes (`/\[catalog_model:([^\]]+)\]/` etc.) already parse — match ✓. Backend new identifiers: `isProductCatalogV2` (Task1 Step1), `v2Custom` / `v2ModelDesc` / `v2PoseText` (Task1 Step3, local to the new branch). The verbatim prompt's substitution points (`${v2ModelDesc}`, `${v2PoseText}`) are the only `${...}` in the new template literal besides — wait, double-check: the new prompt template literal must contain ONLY `${v2ModelDesc}` and `${v2PoseText}` as interpolations; the rest is plain text. Re-reading Step 3's `new_string`: yes, only those two. ✓. The `style` column value `product_catalog_v2` is consistent between STYLE_MAP (Task2 Step1) and the backend flag (Task1 Step1) ✓.

# Product Catalog v2 — "Model preset" → "Reference model" (avatar, required) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Product Catalog v2, replace the 3 text "Model preset" pills with a "Reference model" persona-avatar dropdown (like v1, but no `__preset__` fallback — the avatar is required). The selected avatar is sent as `audience`; the backend resolves its `reference_url`, the v2 prompt switches to "use the woman from the reference image", and the avatar sandwich `[avatar, product, avatar]` is built. Generate is disabled without an avatar. v1 Product Catalog is untouched.

**Architecture:** Backend (`api/creatives/generate.js`): the existing `else if (isProductCatalogV2)` prompt branch becomes conditional on `reference_url` — with an avatar it emits a reference-image-roles block + "model = the woman from image 1"; without one (defensive — the frontend won't allow it) it keeps the hardcoded mid-size model description. The avatar auto-lookup at line ~59 already covers `product_catalog_v2` (it's not `realistic_beach`), and `refImages` / `falPrompt` already handle `isProductCatalogV2` — no change there. Frontend (`apps/dashboard/src/components/CreativeStudio.jsx`): the v2 UI block swaps Model-preset pills for a `Select` avatar dropdown (no `__preset__`, with an empty-state hint); `customInstr` for v2 drops the model text; `generateCreatives` for v2 sends `audience: catalogAvatar || undefined`; the Generate button gets `disabled` when v2 has no avatar, plus a hint. No new deps, no DB changes, no post-process change.

**Tech Stack:** Node.js (Vercel serverless), React 19 + Vite, fal.ai Nano Banana Pro, Vitest (27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-12-product-catalog-v2-reference-model-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — not a git repo). Repo on `main`; the user deploys via Vercel on push — intentional. Line numbers below are accurate as of commit `5219ba7`.

---

## File Structure

- **Modify:** `api/creatives/generate.js` — the `else if (isProductCatalogV2)` prompt branch (~lines 298-336). Auto-lookup (~line 59), `refImages` (~line 437), `falPrompt` (~line 459), `configMeta` (~line 506) — verified, no change needed.
- **Modify:** `apps/dashboard/src/components/CreativeStudio.jsx` — the v2 UI block (~lines 890-910), `customInstr` for v2 (~line 575), the `generateCreatives` `audience` for v2 (~line 592), the Generate button (~lines 1089-1102), and an early-return guard in `handleGenImage` (~line ~545).
- **Unchanged:** v1 Product Catalog logic, `CATALOG_MODELS` array (v1 uses it), `lib/actions/creatives.js`, `lib/avatar-crop.js`, `lib/higgsfield.js`, `apps/dashboard/src/lib/api.js`, all other styles.

Two tasks: **Task 1 = backend** (so the API handles v2-with-avatar before the frontend sends it), **Task 2 = frontend**. Each commits independently.

---

### Task 1: Backend — v2 prompt branch reacts to `reference_url`

**Files:**
- Modify: `api/creatives/generate.js`

**Context for the engineer:** `api/creatives/generate.js` builds a prompt for fal.ai's Nano Banana `/edit` model. Around line 59 there's `if (audience && !reference_url && store_id && style !== 'realistic_beach') { ... look up persona_avatars.reference_url by audience name, set reference_url ... }` — this already covers `product_catalog_v2` (it's not `realistic_beach`). The `else if (isProductCatalogV2)` branch (~lines 298-336) currently always uses a text model description (`${v2ModelDesc}`). We're making it conditional: when `reference_url` is set (avatar mode), emit a reference-image-roles block and "the model is the woman from image 1" instead of the text description; when not (defensive fallback — the frontend will require an avatar, but a direct API call without one should still work), keep the current text behaviour. The `refImages` line (~437) already does `(isProductCatalog || isProductCatalogV2) ? (avatarRef ? [avatarRef, ...images.slice(0,1), avatarRef] : images.slice(0,1)) : ...` and `falPrompt` (~459) already does `(isProductCatalog || isProductCatalogV2) ? prompt : ...` — leave both. Make ONLY the change below. Do not touch v1's `isProductCatalog` logic, `isRealisticBeach`, `poll_generations`, or anything else.

- [ ] **Step 1: Read the current v2 branch to confirm**

Run: `sed -n '298,337p' api/creatives/generate.js`
Confirm the branch starts `} else if (isProductCatalogV2) {`, parses `v2Custom` / `v2ModelDesc` / `v2PoseText`, then `prompt = \`Use the swimsuit shown in the attached image ... ${v2ModelDesc} ... ${v2PoseText} ... 85mm lens at f/2.8, Canon R5 look, true-to-life skin texture and fabric texture.\`;` and the next line is `} else if (isRealisticBeach) {`.

- [ ] **Step 2: Replace the v2 branch with the avatar-aware version**

Use the `Edit` tool. `old_string` (the exact branch — from `} else if (isProductCatalogV2) {` through the closing backtick + `;` of the `prompt = ...` assignment; everything up to but NOT including `} else if (isRealisticBeach) {`):
```
    } else if (isProductCatalogV2) {
      // Golden-hour Product Catalog v2 — verbatim prompt, two substitutions: ${v2ModelDesc} from the
      // chosen Model preset, ${v2PoseText} from the chosen Pose preset. No avatar, no framing crop.
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
```
`new_string`:
```
    } else if (isProductCatalogV2) {
      // Golden-hour Product Catalog v2 — verbatim prompt. The MODEL comes from the persona avatar
      // when one is selected (reference_url set via the audience lookup above) → reference-roles
      // block + sandwich [avatar, product, avatar]. Otherwise (defensive — the UI requires an
      // avatar) fall back to the hardcoded mid-size model description. ${v2PoseText} from the Pose preset.
      const v2HasAvatar = !!reference_url;
      const v2Custom = (custom_prompt || '').replace(/\[catalog_[^\]]+\]/g, '').trim();
      const v2ModelDesc = (v2Custom.match(/^([\s\S]*?)(?=POSE:|$)/)?.[1] || '').trim()
        || 'Mid-size woman, US size 12-14, natural soft body with visible curves, apple-shaped silhouette, real-looking belly and thighs (not athletic, not slim), late 30s to mid 40s, warm relatable expression with a soft natural smile. Natural windswept hair, minimal makeup, no jewelry, no accessories, no tattoos.';
      const v2PoseText = v2Custom.includes('POSE:')
        ? v2Custom.slice(v2Custom.indexOf('POSE:')).trim()
        : 'POSE: Standing facing camera, slight weight shift to right hip creating natural S-curve, arms relaxed at sides, direct confident eye contact with camera, warm genuine smile.';
      const v2GarmentLine = v2HasAvatar
        ? `REFERENCE IMAGES — READ CAREFULLY: image 1 AND the last image = THE MODEL (the SAME woman, shown twice) — use her EXACT face, hair, skin tone, body shape, and age; she is the ONLY person, do not invent a different face. Any image in between = THE GARMENT — recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do NOT redesign, restyle, or reinterpret the swimsuit, and do NOT let the garment images influence the model's face.`
        : `Use the swimsuit shown in the attached image as the exact reference garment. Recreate this swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage. Do not redesign, restyle, or reinterpret the swimsuit. The garment in the attached image is the product, replicate it exactly.`;
      const v2ModelLine = v2HasAvatar
        ? `Professional e-commerce swimwear product photography. THE MODEL — use the exact woman shown in reference image 1 / the last reference image: her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography. ${v2ModelDesc}`;
      prompt = `${v2GarmentLine}

${v2ModelLine}

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
```

- [ ] **Step 3: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 4: Grep checks**

```bash
grep -c "v2HasAvatar" api/creatives/generate.js                                 # expect 3 (def + v2GarmentLine + v2ModelLine)
grep -c "REFERENCE IMAGES — READ CAREFULLY: image 1 AND the last image" api/creatives/generate.js  # expect 1
grep -c "Repeat: high-waisted bottoms, navel fully covered" api/creatives/generate.js  # expect 1 (prompt body intact)
grep -c "Use the swimsuit shown in the attached image as the exact reference garment" api/creatives/generate.js  # expect 1 (fallback line still there)
grep -c "else if (isProductCatalogV2)" api/creatives/generate.js                # expect 1
```

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 6: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: backend — product_catalog_v2 model comes from a persona avatar when selected

The v2 prompt branch now branches on reference_url: with an avatar (resolved from
`audience` via the existing persona_avatars lookup) it emits a reference-image-roles
block + "the model is the woman from image 1" and the sandwich [avatar, product,
avatar] is used (refImages already handles isProductCatalogV2). Without an avatar
(defensive — the UI will require one) it keeps the hardcoded mid-size description.
Spec: Docs/superpowers/specs/2026-05-12-product-catalog-v2-reference-model-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push after both tasks.

- [ ] **Step 7: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 2: Frontend — v2 "Reference model" avatar dropdown + required-avatar guard

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

**Context for the engineer:** `CreativeStudio.jsx` is the Studio creative-generation UI. The v2 style ("product-catalog-v2") currently shows "Model preset" pills (`CATALOG_MODELS`) + "Pose" pills (`CATALOG_POSES`) in a block gated by `{imgStyle === "product-catalog-v2" && (<>...</>)}` (~line 890). We're replacing the Model-preset pills with a "Reference model" `Select` dropdown — the same persona-avatar picker v1 has (~line 845: `<Select value={catalogAvatar || "__preset__"} ... options={["__preset__", ...personas.filter(p => p.reference_url).map(p => p.name)]} ...>`), but WITHOUT the `__preset__` option (the avatar is required). The `catalogAvatar` state already exists (`useState(null)`, ~line 450). For v2, `customInstr` should drop the model text (the model comes from the avatar), `generateCreatives` should send `audience: catalogAvatar || undefined`, and the Generate button should be disabled when v2 has no avatar (plus a hint). `personas` is the array of persona avatars (each has `name`, `age`, `label`, `reference_url`); `TEXT_MID` is a colour constant in scope. `isProductCatalogV2` is defined inside `handleGenImage`; `isProductCatalogV2Style` is the render-scope equivalent (~line 511) — use the right one for the right scope. Make ONLY the changes below; do not touch the v1 catalog block (~line 845) or `CATALOG_MODELS`.

- [ ] **Step 1: Swap the v2 "Model preset" pills for a "Reference model" avatar dropdown (~lines 890-910)**

Read lines 890-910 to confirm the v2 block. Use the `Edit` tool. `old_string`:
```
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
```
`new_string`:
```
          {/* Catalog v2 controls — only Reference model (avatar, required) + Pose; everything else hardcoded in the v2 prompt */}
          {imgStyle === "product-catalog-v2" && (
            <>
              <div>
                <SectionLabel>Reference model</SectionLabel>
                {personas.filter((p) => p.reference_url).length > 0 ? (
                  <Select
                    value={catalogAvatar || ""}
                    onChange={setCatalogAvatar}
                    options={personas.filter((p) => p.reference_url).map((p) => p.name)}
                    placeholder="Select a model…"
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
            </>
          )}
```

(Note on `Select`: v1 uses `<Select value={...} onChange={...} options={...} renderOption={...} />` — confirm `Select` accepts a `placeholder` prop; if it doesn't, drop the `placeholder` line — `value=""` will just render an empty/first option. The behaviour is: when `catalogAvatar` is `null`, the Select shows no valid selection; picking one sets `catalogAvatar` to the persona name.)

- [ ] **Step 2: Drop the model text from `customInstr` for v2 (~line 575)**

Read line 575 to confirm it's:
```js
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogModelPrompt}\n\n${catalogPosePrompt}`
      : isProductCatalogStyle
```
Use the `Edit` tool. `old_string`:
```
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogModelPrompt}\n\n${catalogPosePrompt}`
      : isProductCatalogStyle
```
`new_string`:
```
    const customInstr = isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
```

(`catalogModelLabel` is `catalogAvatar || (CATALOG_MODELS.find(...)?.label || '')` — for v2 it'll be the avatar name. Keeping `[catalog_model:avatarName]` for metadata. Note: after this change `catalogModelPrompt` is still computed/used by v1 — leave it.)

- [ ] **Step 3: Send the avatar as `audience` for v2 (~line 592)**

Read lines 592-596 to confirm:
```js
            audience: isProductCatalogV2
              ? undefined
              : isProductCatalogStyle
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
```
Use the `Edit` tool. `old_string`:
```
            audience: isProductCatalogV2
              ? undefined
              : isProductCatalogStyle
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
```
`new_string`:
```
            audience: (isProductCatalogV2 || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
```

- [ ] **Step 4: Add an early-return guard in `handleGenImage` (~line 545)**

Read the start of `handleGenImage` (~line 543-545). Find the line `if (!product?.id || generating) return;`. Use the `Edit` tool. `old_string` (include enough context — the line right after it, `setGenerating(true); setCompleted(0);`, to make it unique):
```
    if (!product?.id || generating) return;
    setGenerating(true); setCompleted(0);
```
`new_string`:
```
    if (!product?.id || generating) return;
    if (imgStyle === 'product-catalog-v2' && !catalogAvatar) { toast.error("Select a reference model first"); return; }
    setGenerating(true); setCompleted(0);
```

(Note: this is render-time `imgStyle`, not the `handleGenImage`-scope `isProductCatalogV2` constant which is declared a few lines later — `imgStyle` is the component-scope state, in scope here. `toast` is in scope — it's used elsewhere in this callback.)

- [ ] **Step 5: Disable the Generate button + hint when v2 has no avatar (~lines 1089-1102)**

Read lines 1089-1102 to confirm the `<button onClick={handleGenImage} style={{...}}>` block (no `disabled` attr currently). Use the `Edit` tool. `old_string`:
```
          <button onClick={handleGenImage} style={{
            width: "100%", marginTop: "1rem", padding: "15px 0", border: "none", borderRadius: 14,
            background: abMode
              ? `linear-gradient(135deg, ${NEON} 0%, ${CYAN} 100%)`
              : `linear-gradient(135deg, ${NEON} 0%, #c48a18 100%)`,
            color: BG_DEEP, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            cursor: "pointer", transition: "all 0.25s",
            boxShadow: NEON_GLOW_BTN,
          }}>
            {generating ? `Generating... ${completed}/${abMode ? imgCount * 2 : imgCount}` : abMode ? `Generate A/B test (${imgCount}× each)` : `Generate ${imgCount} ${styleName.toLowerCase()}${imgCount > 1 ? "s" : ""}`}
            <span style={{ marginLeft: 8, opacity: 0.5 }}>↗</span>
          </button>
```
`new_string`:
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
            {generating ? `Generating... ${completed}/${abMode ? imgCount * 2 : imgCount}` : abMode ? `Generate A/B test (${imgCount}× each)` : `Generate ${imgCount} ${styleName.toLowerCase()}${imgCount > 1 ? "s" : ""}`}
            <span style={{ marginLeft: 8, opacity: 0.5 }}>↗</span>
          </button>
```

(`isProductCatalogV2Style` and `TEXT_MID` must be in scope at this point in the render — `isProductCatalogV2Style` is declared ~line 511; `TEXT_MID` is a module-level colour constant. If `TEXT_MID` isn't in scope, use whichever muted text colour the file uses for hints — search for `color: TEXT_MID` or similar usages nearby.)

- [ ] **Step 6: Build the frontend**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds (Vite output, `dist/` written). Pre-existing ESLint warnings in other files are fine; no NEW errors referencing `CreativeStudio.jsx`. If the build fails on an undefined variable, check the scope: `imgStyle` (component state), `isProductCatalogV2Style` / `TEXT_MID` (render-scope / module-level), `isProductCatalogV2` (handleGenImage scope), `catalogAvatar` (state).

- [ ] **Step 7: Commit**

```bash
cd /Users/dan/Desktop/Projects/titan-commerce
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "$(cat <<'EOF'
feat: Studio — Product Catalog v2 uses a "Reference model" avatar picker (required)

Replace the 3 text Model-preset pills in v2 with a persona-avatar dropdown (no
__preset__ fallback; empty-state hint when the store has no avatars). The selected
avatar is sent as `audience`; customInstr for v2 drops the model text (the model
comes from the avatar). Generate is disabled (greyed, with a hint) until an avatar
is picked, plus an early-return guard in handleGenImage. v1 untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push — the controller handles the push.

- [ ] **Step 8: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user — not part of the automated plan:

1. Studio → open a product → select the style pill "Product Catalog v2". Verify the UI shows: **Reference model** (a dropdown — NOT 3 pills), **Pose** pills, **Resolution** pills, **Count**. Nothing else.
2. With no avatar picked → the Generate button is greyed out / disabled, and there's a hint "Select a reference model above to generate."
3. Pick a persona avatar from the dropdown + a Pose + Resolution + Count → Generate. Output: golden-hour beach, **the model IS the chosen avatar** (her face, body, hair), the pose matches, the swimsuit copied from the product reference, 4:5 vertical, two-piece bottoms high-waisted with the navel covered. Generate 2-3× with 2 different avatars → identity holds across generations.
4. **Regression:** select the existing "Product Catalog" (v1) → confirm it still shows the v1 UI (Reference model dropdown WITH a "Use text preset below" / `__preset__` option, Model preset pills, Pose pills, Framing pills, Count/Aspect/Resolution row) and still generates with the bright-frontal-sun prompt + framing crop + brightness lift.
5. Edge: on a store with no persona avatars, v2 shows the hint "No persona avatars yet — create one in the Avatars tab", and Generate is disabled.
6. Send a v2 result to the user/colleague for comparison with the reference photo.

---

## Self-Review

**Spec coverage:** Spec §Změny `CreativeStudio.jsx` item 1 (v2 UI block: "Reference model" Select, no `__preset__`, empty-state hint, Pose pills kept) → Task2 Step1 ✓. Item 2 (`customInstr` for v2 drops `${catalogModelPrompt}`, keeps `[catalog_model:avatarName]` tag) → Task2 Step2 ✓. Item 3 (`generateCreatives` `audience: catalogAvatar || undefined` for v2) → Task2 Step3 ✓. Item 4 (Generate button `disabled` when v2 + no avatar, hint, early-return guard) → Task2 Steps 4 + 5 ✓. Spec §Změny `api/creatives/generate.js` item 1 (auto-lookup unchanged) → not touched, verified covers `product_catalog_v2` ✓. Item 2 (v2 prompt branch reacts to `reference_url`: `v2HasAvatar`, `v2GarmentLine`, `v2ModelLine`, fallback keeps hardcoded desc, rest of prompt verbatim) → Task1 Step2 ✓. Items 3/4/5 (`refImages` / `falPrompt` / `configMeta` unchanged) → not touched, verified `(isProductCatalog || isProductCatalogV2)` already present in refImages & falPrompt ✓. Spec §"v1 untouched / processCatalogImage unchanged / CATALOG_MODELS stays" → no task touches them ✓. Spec §Verifikace → Task1 Steps 3-5 + Task2 Step6 + Post-implementation ✓. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step has the exact `old_string`/`new_string` or exact command + expected output. ✓

**Type consistency:** Backend new identifiers: `v2HasAvatar` (Task1 Step2, local to the branch), used in `v2GarmentLine` / `v2ModelLine` ternaries. `v2Custom` / `v2ModelDesc` / `v2PoseText` keep their names. The new prompt template literal interpolates only `${v2GarmentLine}`, `${v2ModelLine}`, `${v2PoseText}` — re-reading Task1 Step2's `new_string`: yes, only those three. ✓. Frontend: `catalogAvatar` (existing state), `isProductCatalogV2` (handleGenImage scope, Task2 Steps 2-3), `isProductCatalogV2Style` (render scope, Task2 Step5), `imgStyle` (component state, Task2 Step4). The `customInstr` for v2 emits `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]` — the backend's existing `catalogModelMatch` (`/\[catalog_model:([^\]]+)\]/`) and `catalogPoseMatch` regexes still parse these → metadata gets the avatar name + pose label ✓. The `audience` value sent for v2 is the persona name (`catalogAvatar`) — the backend's line-59 lookup does `.eq('persona_name', audience)` → match ✓. Frontend `Select` props (`value`, `onChange`, `options`, `renderOption`) match how v1's avatar Select uses it (line 845) — `placeholder` is the one prop to verify (Task2 Step1 note covers the fallback). ✓

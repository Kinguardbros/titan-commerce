# Product Catalog avatar reference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Product Catalog use a persona avatar as the visual source of the model (via the existing sandwich pattern), so the generated model matches a chosen avatar instead of copying a face from the product photo. Also add a free-text override to AvatarBuilder.

**Architecture:** Three additive touch points: (1) `AvatarBuilder.jsx` gets a free-text textarea that, when filled, overrides the structured builder; (2) `CreativeStudio.jsx` Product Catalog block gets a "Reference model" dropdown that is mutually exclusive with the model-preset pills; (3) `api/creatives/generate.js` removes the `product_catalog` exclusion from avatar auto-injection and, when a `reference_url` is present for Product Catalog, switches to the sandwich `[avatar, product, avatar]` reference layout + identity-lock prompt.

**Tech Stack:** React 19 (Vite), Vercel serverless (Node), fal.ai Nano Banana Pro `/edit`, Supabase.

**Note on testing:** This codebase has no frontend tests; the 27 backend tests cover auth/rate-limit/profit/system-routing and do not touch `creatives/generate.js` or React components. The changes here are UI + prompt/reference-image plumbing — verified by generating an image and inspecting it. Each task therefore uses syntax checks, `npm test` as a regression gate, and an explicit manual verification step. This matches how the prior commits in this session were validated.

---

### Task 1: AvatarBuilder — free-text override

**Files:**
- Modify: `apps/dashboard/src/components/AvatarBuilder.jsx`

- [ ] **Step 1: Add the `freeText` state**

In `AvatarBuilder`, find the state block (around line 92, after `const [extraNotes, setExtraNotes] = useState('');`). Add directly below it:

```jsx
  const [freeText, setFreeText] = useState('');
```

- [ ] **Step 2: Use `freeText` in `handleGenerate`**

In `handleGenerate` (around line 104-122), replace this line:

```jsx
      const prompt = buildAvatarPrompt({ age, weight, height, bodyType, attractiveness, faceShape, noseSize, lipFullness, skinTone, hairColor, hairLength, hairStyle, imperfections, expression, extraNotes });
```

with:

```jsx
      // Free-text override: when filled, ignore the structured builder. Prefix "Full body
      // reference photograph:" so generate_avatar treats it as a passthrough prompt
      // (it rewrites prompts that don't start with "Professional" or "Full body").
      const prompt = freeText.trim()
        ? `Full body reference photograph: ${freeText.trim()}`
        : buildAvatarPrompt({ age, weight, height, bodyType, attractiveness, faceShape, noseSize, lipFullness, skinTone, hairColor, hairLength, hairStyle, imperfections, expression, extraNotes });
```

- [ ] **Step 3: Add the textarea to the UI**

Find the "Extra notes" field block (around line 280-283):

```jsx
            <div className="ab-field">
              <label className="ab-label">Extra notes</label>
              <textarea className="ab-textarea" value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={2} placeholder="Specific details..." />
            </div>
```

Insert a new field block immediately AFTER it (before `<div className="ab-toolbar-actions">`):

```jsx
            <div className="ab-field">
              <label className="ab-label">Free-text description (overrides options above)</label>
              <textarea className="ab-textarea" value={freeText} onChange={e => setFreeText(e.target.value)} rows={4}
                placeholder="e.g. A 38-year-old woman, US size 12-14, warm brunette, apple-shaped, fair skin with freckles, gentle natural smile..." />
              {freeText.trim() && (
                <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 4 }}>
                  When filled, the options above are ignored.
                </div>
              )}
            </div>
```

- [ ] **Step 4: Reset `freeText` when generating from a structured photo upload (avoid stale state)**

Not required — `freeText` only affects `handleGenerate`, and `handleUploadAndGenerate` already passes its own prompt. Skip.

- [ ] **Step 5: Syntax/lint check**

Run: `cd apps/dashboard && npx eslint src/components/AvatarBuilder.jsx`
Expected: no NEW errors mentioning `freeText` (pre-existing warnings/errors in the file are fine).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/AvatarBuilder.jsx
git commit -m "feat: free-text prompt override in AvatarBuilder

When the new free-text textarea is filled, it overrides the structured
builder. Prefixed with 'Full body reference photograph:' so generate_avatar
treats it as a passthrough prompt (no backend change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend — Product Catalog accepts persona avatar reference

**Files:**
- Modify: `api/creatives/generate.js`

- [ ] **Step 1: Allow avatar auto-injection for Product Catalog**

Find line 59:

```jsx
  if (audience && !reference_url && store_id && style !== 'realistic_beach' && style !== 'product_catalog') {
```

Change to:

```jsx
  if (audience && !reference_url && store_id && style !== 'realistic_beach') {
```

(Product Catalog now goes through the same persona-avatar lookup as other styles. `realistic_beach` still bypasses it — that style is fully standalone.)

- [ ] **Step 2: Sandwich reference layout for Product Catalog when `reference_url` present**

Find the ref-image block (around lines 328-339):

```jsx
        const productImages = images.slice(0, 2);
        const refImages = reference_url
          ? [reference_url, ...productImages, reference_url]  // avatar → products → avatar (sandwich)
          : isProductCatalog
            ? images.slice(0, 1)   // Product Catalog: only the first product image (usually a packshot/
                                   // flat-lay, not a lifestyle shot of a model) — fewer reference faces
                                   // for the edit model to copy, so the prompt's model description wins
            : images.slice(0, 4);
```

Change to:

```jsx
        const productImages = images.slice(0, 2);
        // Product Catalog: with a persona avatar → sandwich [avatar, 1 product image, avatar]
        //                  without an avatar     → 1 product image only (packshot/flat-lay,
        //                                          not a model shot), model comes from the prompt's modelDesc
        const refImages = isProductCatalog
          ? (reference_url ? [reference_url, ...images.slice(0, 1), reference_url] : images.slice(0, 1))
          : (reference_url ? [reference_url, ...productImages, reference_url] : images.slice(0, 4));
```

- [ ] **Step 3: Build a Product-Catalog falPrompt that uses the avatar when present**

The `if (isProductCatalog)` branch (around line 190) builds `prompt` from `modelDesc`. We need: when `reference_url` is set, the prompt must say "the model is the woman in reference images 1 and the last image" instead of using `modelDesc`. The simplest place is inside that branch — it already has access to `reference_url` (it's a function param in scope).

Find the Product Catalog `prompt = ` block. Locate this line near its top (the start of the template literal, around line 206):

```jsx
      prompt = `The attached reference image shows the SWIMSUIT/GARMENT ONLY — use it solely to copy the garment (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage). If a person appears in the reference, COMPLETELY IGNORE that person — do not copy her face, hair, body, age, or skin tone. The woman in the final image is a NEW model described below, not the person in the reference.

Recreate the swimsuit faithfully on the new model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage.

Professional e-commerce swimwear product photography. THE MODEL — generate exactly this woman: ${modelDesc}
```

Replace it with a version that branches on `reference_url`. Add this just before the `prompt = ` assignment:

```jsx
      const catalogModelLine = reference_url
        ? `Professional e-commerce swimwear product photography. THE MODEL — use the woman shown in reference image 1 AND the last reference image (the SAME woman, shown twice): her exact face, hair, skin tone, body shape, and age. She is the ONLY person; do not invent a different face.`
        : `Professional e-commerce swimwear product photography. THE MODEL — generate exactly this woman: ${modelDesc}`;
      const catalogReferenceRules = reference_url
        ? `Reference image roles: image 1 AND the last image = THE MODEL (same woman, twice — use her exact identity). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).`
        : `The attached reference image shows the SWIMSUIT/GARMENT ONLY — use it solely to copy the garment (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage). If a person appears in the reference, COMPLETELY IGNORE that person — do not copy her face, hair, body, age, or skin tone. The woman in the final image is a NEW model described below, not the person in the reference.`;
```

Then change the start of the `prompt = ` template literal from:

```jsx
      prompt = `The attached reference image shows the SWIMSUIT/GARMENT ONLY — use it solely to copy the garment (color, cut, neckline, strap style, fabric texture, seaming, construction, coverage). If a person appears in the reference, COMPLETELY IGNORE that person — do not copy her face, hair, body, age, or skin tone. The woman in the final image is a NEW model described below, not the person in the reference.

Recreate the swimsuit faithfully on the new model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage.

Professional e-commerce swimwear product photography. THE MODEL — generate exactly this woman: ${modelDesc}
```

to:

```jsx
      prompt = `${catalogReferenceRules}

Recreate the swimsuit faithfully on the model: same color, same cut, same neckline, same strap style, same fabric texture, same seaming, same construction details, same coverage.

${catalogModelLine}
```

- [ ] **Step 4: Fix the FINAL CHECK line at the end of the Product Catalog prompt (it references `modelDesc.slice(0,80)`)**

Find this near the end of the Product Catalog `prompt` template literal (around line 232):

```jsx
FINAL CHECK — READ LAST: The model in this image MUST be the exact woman described above ("THE MODEL — generate exactly this woman: ${modelDesc.slice(0, 80)}..."). The reference image is the GARMENT ONLY. If the generated woman looks like a person from the reference image instead of the described model, the result is WRONG — generate the described woman.

NEGATIVE: copying the reference model's face, copying the reference person's identity, overcast sky, grey clouds, cloudy weather, dark photo, underexposed, moody lighting, harsh shadows, dramatic lighting, golden hour, sunset, orange tones, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, text, watermarks${framingNegative}.`.trim();
```

Replace with a version that branches:

```jsx
FINAL CHECK — READ LAST: ${reference_url
  ? `The model in this image MUST be the exact woman from reference image 1 / the last reference image. If she looks like a different person, the result is WRONG.`
  : `The model in this image MUST be the exact woman described above ("${modelDesc.slice(0, 80)}..."). If the generated woman looks like a person from the reference image instead of the described model, the result is WRONG — generate the described woman.`}

NEGATIVE: ${reference_url ? '' : 'copying the reference model\\'s face, copying the reference person\\'s identity, '}overcast sky, grey clouds, cloudy weather, dark photo, underexposed, moody lighting, harsh shadows, dramatic lighting, golden hour, sunset, orange tones, plastic skin, porcelain smoothing, AI face, blurry face, smooth featureless skin, doll eyes, slim body, flat stomach, thigh gap, text, watermarks${framingNegative}.`.trim();
```

(When an avatar is present, "don't copy the reference face" would be self-contradictory — the reference IS the desired face — so that NEGATIVE clause is dropped.)

- [ ] **Step 5: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: no output (exit 0).

- [ ] **Step 6: Run backend tests (regression gate)**

Run: `npm test`
Expected: `Tests 27 passed (27)` — no change. (No routing change; this only edits the Product Catalog prompt/reference logic, which tests don't cover.)

- [ ] **Step 7: Commit**

```bash
git add api/creatives/generate.js
git commit -m "feat: Product Catalog accepts persona avatar reference

When an audience/persona is selected for Product Catalog, the persona's
reference photo is injected with the sandwich pattern [avatar, product,
avatar] + an identity-lock prompt, so the generated model matches that
avatar. Without an avatar, behaviour is unchanged (1 product image + the
selected model preset's text description).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: CreativeStudio — Reference model dropdown (mutually exclusive with presets)

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

- [ ] **Step 1: Add `catalogAvatar` state**

Find the catalog state declarations (around line 437-439):

```jsx
  const [catalogPose, setCatalogPose] = useState("hero");
  const [catalogModel, setCatalogModel] = useState("everyday38");
  const [catalogFraming, setCatalogFraming] = useState("three-quarter");
```

Add below `catalogFraming`:

```jsx
  const [catalogAvatar, setCatalogAvatar] = useState(null); // persona name, or null = use text preset
```

- [ ] **Step 2: Add the "Reference model" dropdown to the Product Catalog block, and disable preset pills when an avatar is chosen**

Find the catalog Model pills block (around line 821-830):

```jsx
          {/* Catalog controls — only for product-catalog style */}
          {imgStyle === "product-catalog" && (
            <>
              <div>
                <SectionLabel>Model</SectionLabel>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATALOG_MODELS.map((m) => (
                    <Pill key={m.id} active={catalogModel === m.id} onClick={() => setCatalogModel(m.id)}>{m.label}</Pill>
                  ))}
                </div>
              </div>
```

Replace it with (adds the dropdown above the pills, disables pills when `catalogAvatar` is set):

```jsx
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
```

(`Pill` already supports a `disabled` prop — see its definition around line 182.)

- [ ] **Step 3: In `handleGenImage`, send `audience` when an avatar is chosen, and drop `modelDesc` from `custom_prompt` in that case**

Find this block in `handleGenImage` (around line 549-557):

```jsx
    const catalogPosePrompt = isProductCatalogStyle ? (CATALOG_POSES.find(p => p.id === catalogPose)?.prompt || '') : '';
    const catalogModelPrompt = isProductCatalogStyle ? (CATALOG_MODELS.find(m => m.id === catalogModel)?.prompt || '') : '';
    const catalogFramingPrompt = isProductCatalogStyle ? (CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.prompt || '') : '';
    const catalogModelLabel = CATALOG_MODELS.find(m => m.id === catalogModel)?.label || '';
    const catalogPoseLabel = CATALOG_POSES.find(p => p.id === catalogPose)?.label || '';
    const catalogFramingLabel = CATALOG_FRAMINGS.find(f => f.id === catalogFraming)?.label || '';
    const customInstr = isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_framing:${catalogFramingLabel}]\n${catalogModelPrompt}\n\n${catalogPosePrompt}\n\n${catalogFramingPrompt}` + (imgInstructions ? `\n${imgInstructions}` : '')
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```

Replace with:

```jsx
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

- [ ] **Step 4: Pass `audience: catalogAvatar` for Product Catalog in the `generateCreatives` call**

Find the `generateCreatives({ ... })` call inside `handleGenImage` (around line 565-573):

```jsx
          generateCreatives({
            product_id: product.id, store_id: storeId, style: bs, ai_model: backendModel,
            custom_prompt: customInstr,
            show_model: subject === "On model",
            text_overlay: textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom",
            overlay_text: textMode === "Custom" ? customText : "",
            audience: useAudience && audience !== "auto" ? audience : undefined,
            aspect_ratio: imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: colorRef,
          })
```

Change the `audience:` line to also handle the catalog-avatar case:

```jsx
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
          })
```

- [ ] **Step 5: Add `catalogAvatar` to the `handleGenImage` useCallback deps**

Find the deps array at the end of `handleGenImage` (around line 585):

```jsx
  }, [product, storeId, imgStyle, imgModel, imgCount, subject, modelPose, scene, imgInstructions, textMode, customText, negPrompt, imgResolution, abMode, abStyle, selectedColor, colorToImage, audience, useAudience, generating, onGenerated, toast]);
```

Add `catalogAvatar`, `catalogModel`, `catalogPose`, `catalogFraming` (the latter three were already missing — ESLint already warns about them; add them all now while we're here):

```jsx
  }, [product, storeId, imgStyle, imgModel, imgCount, subject, modelPose, scene, imgInstructions, textMode, customText, negPrompt, imgResolution, catalogAvatar, catalogModel, catalogPose, catalogFraming, abMode, abStyle, selectedColor, colorToImage, audience, useAudience, generating, onGenerated, toast]);
```

- [ ] **Step 6: Add `catalogAvatar` to the config-summary memo (`buildMsg`)**

Find `buildMsg` (around line 515-528). After the `if (subject === "On model") msg += ...` line, add a catalog-avatar hint. Find:

```jsx
    if (imgModel.startsWith("nano-banana")) msg += `, ${imgResolution}`;
    if (subject === "On model") msg += `, pose: ${pose}`;
```

Change to:

```jsx
    if (imgModel.startsWith("nano-banana")) msg += `, ${imgResolution}`;
    if (styleId === "product-catalog" && catalogAvatar) msg += `, avatar: ${catalogAvatar}`;
    if (subject === "On model") msg += `, pose: ${pose}`;
```

And add `catalogAvatar` to `buildMsg`'s deps array (around line 528):

```jsx
  }, [imgModel, imgCount, subject, imgRatio, imgResolution, catalogAvatar, imgInstructions, textMode, customText, negPrompt, allStyles]);
```

- [ ] **Step 7: Syntax/lint check**

Run: `cd apps/dashboard && npx eslint src/components/CreativeStudio.jsx`
Expected: no NEW errors mentioning `catalogAvatar` / `catalogModelBlock` / `catalogModelLine` (pre-existing errors like `backendStyle` unused, and the react-hooks "preserve manual memoization" warning, are fine).

- [ ] **Step 8: Run backend tests (regression gate, frontend has none)**

Run: `npm test`
Expected: `Tests 27 passed (27)` — unchanged.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "feat: Reference model dropdown in Product Catalog

Adds a 'Reference model' dropdown (persona avatars with a set reference
photo) to the Product Catalog block, mutually exclusive with the model
presets — picking an avatar greys out the preset pills and sends the
avatar name as \`audience\` so the backend injects it via the sandwich
pattern. No avatar → unchanged text-preset behaviour.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Manual end-to-end verification

**No files.** This task is run by the human after deploy (or locally via `npm run dev` / `vercel dev`).

- [ ] **Step 1: Create a persona avatar from free text**

Avatars tab → "New Avatar" → fill **Name** (e.g. "Model 1 Everyday") → paste into the new "Free-text description" textarea: `A 38-year-old woman, US size 12-14, mid-size natural body with soft curves, apple-shaped, warm brunette shoulder-length wavy hair, fair-to-medium skin with light freckles, soft round face with warm brown eyes, gentle natural smile, no makeup, North American look.` → "Generate Preview" → wait → pick a variant → "Save Avatar".

Expected: avatar saved, appears in the Avatars list with a reference photo.

- [ ] **Step 2: Use the avatar in Product Catalog**

Studio → pick a swimwear product → CreativeStudio panel → style "Product Catalog" → in **Reference model** dropdown pick "Model 1 Everyday" → the **Model preset** pills should grey out (disabled) → choose a pose/framing → Generate → wait (1-3 min on 2K; Nano Banana Pro is slow).

Expected: generated image — the model should match the avatar's face/body (brunette, mid-size, ~38), NOT a person from the product's photos. Check the Vercel log: `[generate] Submitting fal.ai Nano Banana (has reference), ref images: 3, has persona: true, productCatalog: true`.

- [ ] **Step 3: Verify the fallback (no avatar)**

Same panel → set **Reference model** back to "Use text preset below" → preset pills become active → pick "Model 2 (28) Coastal" → Generate.

Expected: generated image based on the text preset (different woman: ~28, slim, Mediterranean). Vercel log: `ref images: 1, has persona: false, productCatalog: true`. (This confirms we didn't break the existing path.)

- [ ] **Step 4: Verify other styles unaffected**

Same panel → style "ad-creative" or "lifestyle" → confirm the Reference model dropdown is NOT shown (it's only in the product-catalog block) and the existing audience picker still works.

Expected: no regression in non-catalog styles.

- [ ] **Step 5 (optional): Push for production verification**

If verifying on production: `git push origin main` → Vercel auto-deploys (~2-3 min) → re-run steps 1-4 on the live URL.

---

## Self-review notes

- **Spec coverage:** §1 free-text override → Task 1. §2 dropdown + mutual exclusivity → Task 3. §2 backend sandwich + identity lock → Task 2. §3 data flow → covered by Tasks 2+3. Edge cases (no reference_url → filtered out of dropdown; no personas → only "Use text preset below"; Bulk Generate untouched) → covered (Task 3 Step 2 filters on `reference_url`; Bulk Generate not touched). Manual testing → Task 4.
- **No placeholders:** every step has the actual code/command.
- **Type consistency:** state `catalogAvatar` (null | persona name) used consistently in Task 3 (state, dropdown, `handleGenImage`, deps, `buildMsg`). Backend `reference_url` param already exists; no new types. `Pill` `disabled` prop already exists.
- **Known follow-up not in this plan:** Bulk Generate avatar selection; `poll_generations` auto-retry sending `imageUrl: []` (rarely fires with 8-min timeout).

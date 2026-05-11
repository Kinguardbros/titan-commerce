# Design: Persona avatars as reference for Product Catalog

**Date:** 2026-05-11
**Status:** Approved

## Context

Nano Banana (the image model behind Product Catalog) is an `/edit` model: when given a product photo that contains a model, it copies that person's face regardless of the text prompt. This is why Product Catalog ignores the selected model preset — a text description ("38-year-old woman, US 12-14, brunette...") cannot override a visual signal in a reference image. Prompt strengthening (already attempted) did not fix it.

The fix: use a **persona avatar** as the visual source of the model's face/body, via the existing **sandwich pattern** (`[avatar, product, avatar]` + identity-lock prompt) that already works for non–Product-Catalog styles. We also add a free-text override to AvatarBuilder so avatars can be created quickly from a freeform description.

**Intended outcome:** In Product Catalog, the user picks a reference model (a persona avatar) from a dropdown and the generated creative uses that avatar's face/body. If no avatar is picked, behaviour falls back to the current text-preset path.

## Decisions made during brainstorming

- **(B)** Avatars are created manually in AvatarBuilder from a freeform prompt (not auto-generated from the 3 catalog presets). The Product Catalog dropdown lets the user pick any persona avatar; the choice is independent of the model presets.
- **(C)** Model preset (`Model 1/2/3`) and the avatar dropdown are **mutually exclusive** — either a text preset OR an avatar, never both. The UI enforces this (picking an avatar disables the preset pills).
- **(B)** AvatarBuilder gets a single free-text textarea below the existing structured sliders; when filled, it overrides the structured builder. Minimal UI change.

## Architecture

Three touch points, all additive:

### 1. AvatarBuilder — free-text override

`apps/dashboard/src/components/AvatarBuilder.jsx`:
- Add a textarea **"Free-text description (overrides options above)"** below the structured controls. Placeholder: `"e.g. A 38-year-old woman, US size 12-14, warm brunette, apple-shaped, fair skin with freckles, gentle natural smile..."`. Hint: `"When filled, the options above are ignored."`
- `handleGenerate`: if the textarea is non-empty, prepend `"Full body reference photograph: "` to the user text and send that as the prompt; otherwise send `buildAvatarPrompt(...)` as today.
- **Why the prefix:** `generate_avatar` rewrites a prompt unless it starts with `"Professional"` or `"Full body"` (passthrough check). Prefixing `"Full body reference photograph: "` makes the free-text prompt pass through untouched. No backend change.

### 2. Product Catalog — avatar dropdown vs. model preset (mutually exclusive)

**Frontend (`apps/dashboard/src/components/CreativeStudio.jsx`):**
- Import `getAvatars` (already in `api.js`; used by `Studio.jsx` and `ProductWorkspace.jsx`). Load personas on mount, filter to those with a `reference_url` (`personas.filter(p => p.reference_url)`).
- New state `catalogAvatar` (`null` = use text preset; otherwise a persona name).
- In the Product Catalog block: add a `<Select>` **"Reference model"** — first option `"Use text preset below"` (value = `null`), then one option per filtered persona.
- Mutual exclusivity: when `catalogAvatar !== null`, the `CATALOG_MODELS` preset pills render disabled (visually greyed + `disabled` prop on `Pill`). When `null`, preset pills are active as today.
- `handleGenImage` (Product Catalog branch):
  - if `catalogAvatar` → `generateCreatives({ ..., style: "product_catalog", audience: catalogAvatar, custom_prompt: "[catalog_pose:...][catalog_framing:...]\n{poseAndFraming}" })` — i.e. **no `modelDesc`** in `custom_prompt`; the avatar replaces it.
  - if `null` → current behaviour: `custom_prompt` includes the chosen `CATALOG_MODELS` preset (`modelDesc`).
- Add `catalogAvatar` to the `useCallback` deps and the config-summary memo.

**Backend (`api/creatives/generate.js`):**
- Remove the `style !== 'product_catalog'` exclusion from the persona-avatar auto-injection block (currently it skips Product Catalog). When `audience` is set and style is `product_catalog`, look up `reference_url` from `persona_avatars` like other styles.
- In the `if (isProductCatalog)` branch:
  - if `reference_url` present → `refImages = [reference_url, ...images.slice(0,1), reference_url]` (sandwich); prepend the existing **identity-lock** prompt block (the one already used for non-catalog `reference_url` flows: "Image 1 AND last image = THE MODEL, use her exact face...").
  - if `reference_url` absent → unchanged: 1 product reference image + `modelDesc` from the preset.
  - the `modelDesc` line in the Product Catalog prompt: when an avatar is present, replace it with "The model is the woman shown in reference images 1 and the last image — use her exact face, hair, body, age." (no text description, since the avatar carries identity).
- `creative.metadata`: `audience` is already stored when present — no change needed.

### 3. (Out of scope this round)

Bulk Generate stays text-only (model preset). Not adding avatar selection there now.

## Data flow

**Avatar selected:**
```
CreativeStudio: catalogAvatar="Model 1" → handleGenImage
  → generateCreatives({ style:"product_catalog", audience:"Model 1",
       custom_prompt:"[catalog_pose:...][catalog_framing:...]\n<poseAndFraming>" })
  → api/creatives/generate.js:
    - audience + product_catalog → persona_avatars lookup → reference_url
    - isProductCatalog + reference_url → refImages = [reference_url, images[0], reference_url]
    - prompt: garment-only reference rules + "model = woman in ref img 1 & last"
              + pose/framing + FACE QUALITY + lighting + NEGATIVE
    - submitFalJob('fal-ai/nano-banana-pro/edit', prompt, refImages, resolution)
  → creative.metadata: { ..., audience:"Model 1", resolution, ... }
```

**No avatar (fallback):** unchanged — 1 product reference image, `modelDesc` from the selected `CATALOG_MODELS` preset.

## Edge cases

- Avatar selected but the persona has no `reference_url` (only `variants`, none set as reference) → such personas are not shown in the dropdown (filter on `reference_url`).
- Avatar reference URL: persona avatars are stored in Supabase Storage (permanent URLs, not fal.ai temp URLs) → no expiry concern.
- Store has no personas → dropdown shows only "Use text preset below"; behaviour unchanged.
- Free-text prompt that triggers a fal.ai safety filter (e.g. underwear wording) → same risk as today's structured builder; not addressed here.

## What does NOT change

Other styles (`ad_creative`, `lifestyle`, `realistic_beach`), their audience flow, model routing, the resolution selector, Bulk Generate, `poll_generations`.

## Testing

Manual:
1. Avatars tab → create a persona via the new free-text textarea → set a generated variant as its reference.
2. Studio → Product Catalog → "Reference model" dropdown → pick that persona → preset pills should grey out → Generate → the generated model should match the avatar (face/body), not a person from the product photo.
3. Fallback: set "Reference model" back to "Use text preset below" → preset pills active → Generate → behaves as today (model from preset description).
4. `npm test` — should pass unchanged (no routing changes).

## Known follow-ups (not in this spec)

- Avatar selection in Bulk Generate (if wanted later).
- The auto-retry path in `poll_generations` sends `imageUrl: []` and `prompt: meta.retry_prompt || c.hook_used` — for Product Catalog this would produce a broken regeneration. With the 8-min `MAX_JOB_AGE_MS` retry rarely fires; consider disabling retry for Product Catalog.

# Product Catalog v4 (Editorial Strobe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th Product Catalog style ("Product Catalog v4") that uses the user-provided 6500-character editorial-strobe prompt VERBATIM. Backend wraps the verbatim text with three injections only: (a) reference-image-roles prefix at the start, (b) `Product: ${product.title}` line, (c) HIGH-WAIST navel-hide block at the end (conditional on Isola or tummy-detect title). Studio UI is the most minimal of all catalog styles — Reference model (avatar, required) + Resolution + Count, nothing else. Single-shot generation through Nano Banana Pro with `[avatar, productPhoto, avatar]` sandwich, hardcoded 4:5, no post-process. v1, v2, v3, Realistic Beach, PhotoStory untouched.

**Architecture:** New `lib/v4-prompt.js` exports `V4_PROMPT_BODY` (verbatim user text as a string constant). `api/creatives/generate.js`: new `isProductCatalogV4` flag, extend `catalogHighWaist` + image filter + `refImages` + `outAspectRatio` + `falPrompt` to include v4, add a new `else if (isProductCatalogV4)` branch that builds `prompt = ${prefix}${V4_PROMPT_BODY}${highWaistBlock}`. Frontend (`CreativeStudio.jsx`): add to `STYLE_MAP` + `STYLE_CATEGORIES`, derive render-scope and handleGenImage-scope `isProductCatalogV4*` flags, extend `isAnyCatalogStyle` to include v4, add new minimal v4 UI block (only avatar Select), set `customInstr = ''` for v4, extend `generateCreatives` field overrides to include v4. No new deps, no DB schema change. `lib/actions/creatives.js` (`poll_generations`) untouched — v4 is single-shot, no chain, no `processCatalogImage`.

**Tech Stack:** Node.js (Vercel serverless), React 19 + Vite, fal.ai Nano Banana Pro, Vitest (27-test suite), git.

**Spec:** `Docs/superpowers/specs/2026-05-14-product-catalog-v4-editorial-strobe-design.md`

**Working directory:** All commands run from the repo root `/Users/dan/Desktop/Projects/titan-commerce` (NOT `/Users/dan/Desktop/Projects` — not a git repo). Repo on `main`; the user deploys via Vercel on push — intentional. Line numbers below are accurate as of commit `202af91`.

---

## File Structure

- **Create:** `lib/v4-prompt.js` — exports `V4_PROMPT_BODY` constant (verbatim user prompt). One responsibility, one export. ~150 lines (mostly the prompt string).
- **Modify:** `api/creatives/generate.js`:
  - Import `V4_PROMPT_BODY` (top of file).
  - Add `isProductCatalogV4` flag (~line 96).
  - Extend image filter (~line 118) to include v4.
  - Extend `catalogHighWaist` (~line 108) to include v4.
  - Add `else if (isProductCatalogV4) {...}` prompt branch (after the v3 branch, before the realistic_beach branch).
  - Extend `outAspectRatio` (~line 492), `refImages` (~line 496), `falPrompt` (~line 513) to include v4.
- **Modify:** `apps/dashboard/src/components/CreativeStudio.jsx`:
  - Add `"product-catalog-v4": "product_catalog_v4"` to `STYLE_MAP`.
  - Add v4 entry to `STYLE_CATEGORIES` "product-photos".
  - Add render-scope `isProductCatalogV4Style` flag, extend `isAnyCatalogStyle`.
  - Extend `handleGenImage` early-return guard + `isAnyCatalog` to include v4.
  - Add v4 branch to `customInstr` ternary (returns `''`).
  - Extend `generateCreatives` field overrides (`show_model`, `text_overlay`, `overlay_text`, `audience`, `aspect_ratio`, `reference_url`) to include v4.
  - Force `backendModel` to `fal_nano_banana_pro` for v4 (extend existing v1/v2/v3 force).
  - Add new v4 UI block (Reference model Select only, no Pose / Beach scene).
- **Unchanged:** v1/v2/v3 prompt branches, Realistic Beach, PhotoStory, `lib/avatar-crop.js`, `lib/v3-beach-scenes.js`, `lib/fal.js`, `lib/actions/creatives.js`, `apps/dashboard/src/lib/api.js`, `CATALOG_MODELS`/`CATALOG_FRAMINGS`/`CATALOG_POSES`/`CATALOG_BEACH_SCENES` arrays.

Three tasks. Task 1 (the new file with verbatim prompt) is mechanical — controller can do directly. Tasks 2 (backend) and 3 (frontend) get dispatched to subagents.

---

### Task 1: New `lib/v4-prompt.js` (verbatim user prompt)

**Files:**
- Create: `lib/v4-prompt.js`

- [ ] **Step 1: Create the file**

Use the `Write` tool to create `lib/v4-prompt.js` with exactly this content (the user's verbatim prompt, as a JS template literal so it survives apostrophes and quotes):

```js
// Product Catalog v4 — verbatim user-provided editorial-strobe prompt.
// User wants this text unmodified. Backend (api/creatives/generate.js v4 branch)
// wraps it with: (a) reference-roles prefix, (b) Product: ${product.title}, and
// (c) a conditional HIGH-WAIST navel-hide block. NO other edits to this body.
export const V4_PROMPT_BODY = `Ultra-realistic editorial fashion photograph of a confident, naturally beautiful woman wearing a swimsuit on a beach. This is a professional catalog studio shoot captured on location — premium DTC swimwear brand campaign aesthetic in the visual quality of Andie Swim, Hermoza, Aerie, Athleta, and J.Crew editorial campaigns. Studio-quality production values with professional strobe lighting on the model and natural beach environment as backdrop.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):

She is wearing the specified swimsuit. The suit fits her body well — it sits flush against her skin without bunching, gapping, or pulling. The fabric drapes naturally and shows its true texture, color, and construction. Every detail of the suit must be clearly visible and well-lit: the neckline, the cut, the waistband, any seams, ruching, twist details, fabric texture, color saturation. The swimsuit is the focal point of the image — the brightest, clearest, most defined element in the frame. The fabric color must read TRUE TO LIFE — not muddy, not washed out, not over-saturated. The viewer should be able to identify the exact color, silhouette, and key features of the swimsuit in less than 1 second.

POSE & EXPRESSION:

She is standing facing the camera with body roughly square to the lens, with a slight 5 to 15 degree turn to introduce natural body shape without obscuring the suit. Body weight shifted gently to one leg, creating a subtle relaxed hip line. Shoulders back, posture confident but not stiff. Her arms hang naturally at her sides with relaxed hands — fingers slightly curled, not perfectly straight, not stiff. Chin neutral, gaze directly at camera with confident grounded ease.

Her expression is warm and genuine — a soft, natural smile that reaches her eyes. Not overly bright, not sultry, not posed. The energy of a woman who feels good in her body and knows her worth. Bright, magnetic, present. Eyes alive and engaged. The face must read as REAL and beautiful simultaneously — natural skin texture preserved (subtle fine lines, real pores, natural skin variation, visible freckles where appropriate) while the overall impression is glowing and youthful-for-her-age.

SETTING:

An open beach during late golden hour. Soft cream-to-pale-gold sand stretches in the foreground, slightly out of focus near the edges of the frame. Gentle turquoise-blue ocean waves visible behind her in the middle ground, softly out of focus with natural motion. Soft warm sky in the upper third of the frame — pale gold blending into soft blue, no harsh sun visible, no heavy clouds. The horizon line of the ocean is visible behind her, sitting at approximately bust to mid-torso height in the frame.

The beach environment is clean and uncluttered — no other people visible, no beach umbrellas, no chairs, no debris. Just sand, ocean, sky.

LIGHTING — CRITICAL: PROFESSIONAL STUDIO STROBE ON MODEL, NATURAL BACKGROUND:

This image must look like a professional catalog studio shoot captured on location — NOT like a natural beach photograph. The model is lit by a powerful invisible studio strobe with softbox modifier, positioned in front of her, which is the DOMINANT light source on her face, body, and swimsuit. The strobe must clearly be doing the work — its lighting effect should be unmistakable in the image, even though the equipment itself is invisible in the frame.

THE STROBE EFFECT — what the studio light must produce on the model:

- BRIGHT, EVEN, DIMENSIONAL FRONT ILLUMINATION on her face and body, noticeably brighter than the natural ambient beach light. She is clearly "lit from the front" by an artificial light source.

- VISIBLE CATCHLIGHTS in her eyes — small bright reflections in both irises that prove a strobe softbox is positioned in front of her. These catchlights are essential and must be present in every generation. The eyes must look "lit," not flat.

- DEFINED BUT SOFT SHADOWS on the face — gentle shadow under the chin, under the nose, along the jawline edge. The face has shape and depth, not a flat even wash. NOT flat. NOT shadowless. NOT harsh either. Studio-quality dimensional lighting where the bone structure is visible through subtle shadow modeling.

- DIMENSIONAL BODY MODELING — soft shadows along the sides of the torso, under the bust line, on the inside of her arms, on the inner thighs. These shadows give the body shape and form. The body must NOT look flat or "filled in" by ambient light alone. Subtle highlights along the front of the body where the strobe hits most directly.

- BRIGHT TRUE-COLOR RENDERING of the swimsuit fabric — the strobe makes the suit color pop and renders the texture with maximum clarity. Every fabric detail of the suit is sharply visible because the strobe is lighting it directly. Ribbed textures, seams, neckline details, hardware all render crisply.

- LUMINOUS QUALITY on the skin from the strobe — healthy glow that looks like proper studio lighting on skin, not ambient natural light. Skin reads as "professionally lit" with subtle sheen and dimensional warmth. NOT plastic. NOT airbrushed. Just beautifully and intentionally lit.

THE NATURAL BACKGROUND — what the ambient does NOT do:

The natural beach golden hour light is RECESSIVE and exists ONLY to provide the warm color temperature of the environment and the soft ambient on the ocean, sand, and sky. The natural sun does NOT meaningfully light the model. The model is clearly artificially lit, while the environment is naturally lit. This contrast — studio-lit subject against naturally-lit environment — is the signature look of high-end on-location catalog photography.

THE EXPOSURE BALANCE:

The model is exposed correctly by the strobe — bright, clear, dimensional. The background is slightly underexposed relative to the model — the beach, ocean, and sky appear soft and slightly dimmer than the model. This subtle exposure difference is what creates the "studio shoot on location" look — the model is clearly the brightest, most exposed, most clearly defined element in the frame.

LIGHTING DIRECTION:

The strobe is positioned in FRONT of the model and slightly above, at roughly a 30-45 degree angle from her face. Light direction comes FROM camera-front, producing soft directional shadows that fall slightly downward and to one side. NOT from behind. NOT from directly above. NOT from below. NOT flat front without any shadow shaping.

THE EQUIPMENT — IMPORTANT:

NO lighting equipment appears in the frame. No softbox, no reflector, no umbrella, no light stand, no strobe head, no cables, no grip equipment, no diffuser, no scrim, no V-flat, no tripod, no camera. The studio lighting effect is fully visible in how it renders the model, but the equipment producing it is invisible. The viewer should see the result of professional studio lighting without seeing any of the apparatus.

COMPOSITION & FRAMING:

Vertical orientation, 4:5 aspect ratio (1080 x 1350 pixels equivalent). Model positioned center frame horizontally. The frame includes her full body from the top of her head down through her mid-thigh or knee — depending on swimsuit type. For one-pieces and high-waist bikinis, frame to mid-thigh. For lower-cut bottoms, frame to upper thigh. She occupies the central 55 to 65 percent of the vertical frame, leaving generous negative space above her head (sky, soft background) and below her mid-thigh (sand). The negative space above her head is essential — clean, uncluttered, suitable for text overlay if needed in post-production.

The model is sharp and in clear focus from head to thigh. The beach background is softly out of focus with natural bokeh on the ocean and sand — approximately f/2.8 to f/4 depth of field quality. The horizon line is gently blurred but recognizable.

PHOTOGRAPHIC STYLE & TECHNICAL SPECIFICATIONS:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining studio strobe lighting with natural golden hour environment. The image quality is 4K editorial — sharp focus on the subject, beautiful depth of field, true-to-life color rendering, full tonal range from highlights to shadows.

Photographic references: Andie Swim campaign imagery, Hermoza catalog photography, Aerie editorial style, Athleta on-location campaigns, J.Crew swimwear catalog shoots, Summersalt brand photography, Eres beach campaigns. Premium accessible aesthetic — luxurious but not intimidating, beautiful but real, polished but warm. The image must look like a finished published catalog photograph, not an AI generation, not a stock photo, not an amateur shoot.

COLOR GRADING & TONAL SIGNATURE:

Warm natural color grading with these specific qualities: skin tones lean slightly warm and glowing, with healthy natural pinks in the cheeks preserved. Sand reads as soft cream with hints of warm gold, not stark white and not orange. Ocean reads as natural turquoise-blue, with slight desaturation rather than tropical postcard saturation. Sky reads as soft warm pastel blue-gold, not electric blue and not heavy yellow.

Slight lift in the highlights for a soft luminous quality. Shadows preserved with detail — never crushed to pure black. Mid-tones slightly warm. Overall image has a gentle, premium editorial feel.

NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated colors, NO cool-blue color cast, NO orange-skin look, NO Instagram filter aesthetic. The color signature must be consistent and recognizable across every image generated with this prompt.

QUALITY REQUIREMENTS:

Ultra-realistic, photorealistic, professional editorial image quality. The image must look like a finished published photograph from a premium swimwear brand campaign.

Natural skin texture preserved consistently across face AND body — visible pores, subtle fine lines around the eyes, natural skin variations, visible freckles where appropriate — while maintaining a healthy glowing appearance. No plastic skin. No over-smoothing. No airbrushed unrealistic perfection. No smoothed legs while face has texture — body skin texture must match face skin texture for realism. The woman must read as a real person who is beautiful, not a synthetic ideal of beauty.

Hair has natural texture and movement — visible individual strands, natural shine, no plastic helmet hair. Eyes are sharp and alive with clear catchlights and natural reflections. Lips have natural texture and color.

The swimsuit fabric must render with realistic material properties — ribbed fabric should show its ribbed texture clearly, smooth fabric should look smooth, swim fabric should look like swim fabric (slight sheen where appropriate, matte where appropriate, based on the actual product specifications).

DO NOT GENERATE:
- Any visible photography lighting equipment (softboxes, reflectors, umbrellas, light stands, beauty dishes, scrims, diffusers, V-flats, cables, tripods, monitors, camera equipment)
- Flat, shadowless, ambient-only lighting on the model
- A model that looks "in good natural light" instead of "professionally lit by studio strobe"
- Absent or invisible catchlights in the eyes — catchlights MUST be present
- Harsh hard shadows from a direct sun source
- A backlit or silhouetted model — model must NEVER be darker than background
- Direct overhead midday sun creating harsh raccoon-eye shadows
- Sun positioned directly behind the model creating halo effect
- Shadows obscuring the swimsuit or any part of the body
- Plastic, over-smoothed, airbrushed unrealistic skin
- Smoothed body skin while face has natural texture (skin texture must be consistent head to toe)
- Generic stock-photo facial features
- Skinny, athletic-cut, runway-model body proportions
- Anyone obviously under 30 or obviously over 60
- Extra fingers, distorted hands, malformed limbs, asymmetrical eyes, melted features, anatomical errors
- Other people in the frame
- Beach clutter (umbrellas, chairs, towels, bags, debris, palm trees, boats)
- Visible watermarks, logos, brand markings, text of any kind, signatures
- Sunglasses on the model
- A crowded, overly busy background
- Multiple distinct directional light sources on the model (one unified front-lit look from the strobe)
- Wet skin, wet hair (model is on beach, NOT just out of water)
- Beach sand visibly stuck on the model's body
- Goosebumps, flushed skin, visible sunburn
- An overly seductive or sultry expression — keep warm and genuine
- An overly bright cartoonish smile — keep natural
- Tilted head poses, dramatic angles, fashion-model affectation
- Three-quarter or full side profile poses — model faces camera with only slight 5-15 degree turn
- Crossed arms over the chest or torso — never block the swimsuit
- Hands covering parts of the swimsuit
- Heavy makeup, dramatic eye makeup, bold lipstick
- Tropical postcard color saturation
- HDR processing artifacts
- Lens flare
- Vignetting or darkened image corners
- Cool-blue or teal color grading
- Orange-skin color grading
- Instagram or VSCO filter aesthetics
- A natural "candid beach photo" feel — must read as professional catalog studio shoot on location

REFERENCE: Match the visual aesthetic, lighting quality, and color grading of premium swimwear brands such as Andie Swim, Hermoza, Aerie, Athleta, and Summersalt. Editorial campaign photography quality. Studio shoot on location.`;
```

(Note on the template literal: the user's text doesn't contain backticks, but it contains apostrophes/quotes which are safe inside backticks. The text DOES contain `${...}`-shaped sequences? Re-read: no. Search the text manually — there are NO `${` sequences in the user's prompt. Backtick template literal is safe.)

- [ ] **Step 2: Syntax check**

Run: `node --check lib/v4-prompt.js`
Expected: exit 0, no output. If it fails, the most likely cause is an unescaped backtick or stray `${...}` in the body — neither is present in the user's prompt, but if Node complains, re-read the error.

- [ ] **Step 3: Smoke test (string export shape + content sanity)**

Run:
```bash
node -e "import('./lib/v4-prompt.js').then(m => {
  const p = m.V4_PROMPT_BODY;
  console.log('type:', typeof p);
  console.log('length:', p.length);
  console.log('starts:', p.slice(0, 40));
  console.log('ends:', p.slice(-40));
  console.log('contains LIGHTING — CRITICAL:', p.includes('LIGHTING — CRITICAL: PROFESSIONAL STUDIO STROBE'));
  console.log('contains DO NOT GENERATE:', p.includes('DO NOT GENERATE:'));
  console.log('contains REFERENCE:', p.includes('REFERENCE: Match the visual aesthetic'));
});"
```
Expected output:
```
type: string
length: 6XXX  (somewhere between 6300 and 7000)
starts: Ultra-realistic editorial fashion photogr
ends: photography quality. Studio shoot on location.
contains LIGHTING — CRITICAL: true
contains DO NOT GENERATE: true
contains REFERENCE: true
```

- [ ] **Step 4: Commit**

```bash
git add lib/v4-prompt.js
git commit -m "$(cat <<'EOF'
feat: lib/v4-prompt — verbatim user prompt for Product Catalog v4

Single export: V4_PROMPT_BODY (string). User-provided ~6500-char editorial-strobe
prompt for the v4 style. Backend wraps this body with reference-roles prefix,
Product: \${product.title}, and conditional HIGH-WAIST navel-hide block —
otherwise the body is sent verbatim to fal.ai.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 5: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 2: Backend — `api/creatives/generate.js` v4 prompt branch + routing

**Files:**
- Modify: `api/creatives/generate.js`

**Context for the engineer:** `api/creatives/generate.js` builds prompts for fal.ai. Around lines 92-95 it sets style flags (`isProductCatalog`/`V2`/`V3`). Around line 108 it derives `catalogHighWaist` (Isola always-on for v1/v2/v3 + tummy regex). Around line 118 the AI-creative image filter activates. The big `if (isProductCatalog) {...} else if (isProductCatalogV2) {...} else if (isProductCatalogV3) {...} else if (isRealisticBeach) {...}` chain (~lines 215-450) builds the prompt. Around lines 492-513 the Nano Banana routing assembles `outAspectRatio`, `refImages` (sandwich), and `falPrompt` (self-contained for catalog styles). Task 1 created `lib/v4-prompt.js` exporting `V4_PROMPT_BODY`. Make ONLY the changes below; do not touch v1/v2/v3 prompt branches, Realistic Beach, or `lib/actions/creatives.js`.

- [ ] **Step 1: Add the import**

Find the line `import { submitFalJob } from '../../lib/fal.js';` (near the top — around line 3-5). Use the `Edit` tool. `old_string`:
```
import { submitFalJob } from '../../lib/fal.js';
```
`new_string`:
```
import { submitFalJob } from '../../lib/fal.js';
import { V4_PROMPT_BODY } from '../../lib/v4-prompt.js';
```

- [ ] **Step 2: Add `isProductCatalogV4` flag (~line 95)**

Read line 95 to confirm `    const isProductCatalogV3 = style === 'product_catalog_v3';`. Use the `Edit` tool. `old_string`:
```
    const isProductCatalogV3 = style === 'product_catalog_v3';
```
`new_string`:
```
    const isProductCatalogV3 = style === 'product_catalog_v3';
    const isProductCatalogV4 = style === 'product_catalog_v4';
```

- [ ] **Step 3: Extend `catalogHighWaist` to include v4 (~line 108)**

Read line 108 to confirm:
```js
    const catalogHighWaist = ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3) && isIsola) || isHighWaistTummy;
```
Use the `Edit` tool. `old_string`:
```
    const catalogHighWaist = ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3) && isIsola) || isHighWaistTummy;
```
`new_string`:
```
    const catalogHighWaist = ((isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) && isIsola) || isHighWaistTummy;
```

- [ ] **Step 4: Extend image filter to include v4 (~line 118)**

Read line 118 to confirm:
```js
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3) {
```
Use the `Edit` tool. `old_string`:
```
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3) {
```
`new_string`:
```
    if (audience || isProductCatalog || isRealisticBeach || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) {
```

- [ ] **Step 5: Add the `else if (isProductCatalogV4)` prompt branch (after the v3 branch, before realistic_beach)**

Find the end of the v3 branch and the start of `else if (isRealisticBeach) {`. The v3 branch ends with `\`.trim();\n    } else if (isRealisticBeach) {`. Use the `Edit` tool. `old_string` (the closing of the v3 branch + the realistic_beach line — read lines around 388-391 to see the exact text):
```
    } else if (isRealisticBeach) {
      prompt = `Use the attached image as the style and quality reference. Generate a new image matching this exact level of realism, lighting, and photographic quality.
```
`new_string`:
```
    } else if (isProductCatalogV4) {
      // Product Catalog v4 — verbatim user prompt (editorial strobe + on-location beach).
      // Backend only injects: (a) reference-roles prefix, (b) Product: <title>, and (c) a
      // conditional HIGH-WAIST navel-hide block when catalogHighWaist. The user's prompt body
      // (V4_PROMPT_BODY) is sent unchanged.
      const v4Prefix = `REFERENCE IMAGES: image 1 AND the last image = THE MODEL (the SAME woman, shown twice — use her exact face, hair, skin tone, body shape, and age). Any image in between = THE GARMENT (cropped product shots — copy the swimsuit's color, cut, neckline, strap style, fabric texture, seaming, construction, coverage exactly; do NOT let it influence the model's face).\n\nProduct: ${product.title}\n\n`;
      const v4HighWaistBlock = catalogHighWaist
        ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n=== HIGH-WAIST TUMMY-CONTROL — MANDATORY, READ TWICE ===\nThis swimsuit is TUMMY CONTROL. The bottoms / one-piece waistline sits VERY HIGH — at the natural waist, WELL ABOVE the belly button. CRITICAL: the waistband sits NOTICEABLY HIGHER than it appears in the product reference photo — raise it up so the top edge reaches the natural waist / just below the bottom of the rib cage. The navel is buried several centimetres BELOW the top edge of the fabric, fully covered. The belly button is COMPLETELY, ENTIRELY hidden — not a peek, not a sliver, not partially — there is NO gap, NO cutout, NO bare skin between the bra/top and the high waistband where the navel could show. The fabric covers the entire stomach from the natural waist down, hugging and smoothing it. This is a FULL high-rise brief, NOT a mid-rise, NOT a low-rise. If you see ANY skin of the navel area above the waistband, the waistband is too low — raise it higher until the navel is fully hidden.\n━━━━━━━━━━━━━━━━━━━━━━━━`
        : '';
      prompt = `${v4Prefix}${V4_PROMPT_BODY}${v4HighWaistBlock}`;
    } else if (isRealisticBeach) {
      prompt = `Use the attached image as the style and quality reference. Generate a new image matching this exact level of realism, lighting, and photographic quality.
```

- [ ] **Step 6: Extend `outAspectRatio` to hardcode 4:5 for v4 (~line 492)**

Read line 492 to confirm:
```js
        const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3) ? '4:5' : aspect_ratio;
```
Use the `Edit` tool. `old_string`:
```
        const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3) ? '4:5' : aspect_ratio;
```
`new_string`:
```
        const outAspectRatio = (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4) ? '4:5' : aspect_ratio;
```

- [ ] **Step 7: Extend `refImages` sandwich to include v4 (~line 496)**

Read lines 495-498 to confirm:
```js
        const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
Use the `Edit` tool. `old_string`:
```
        const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```
`new_string`:
```
        const refImages = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4)
          ? (avatarRef ? [avatarRef, ...images.slice(0, 1), avatarRef] : images.slice(0, 1))
          : (avatarRef ? [avatarRef, ...productImages, avatarRef] : images.slice(0, 4));
```

- [ ] **Step 8: Extend `falPrompt` self-contained branch to include v4 (~line 513)**

Read line 513 to confirm:
```js
        const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
```
Use the `Edit` tool. `old_string`:
```
        const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3)
          ? prompt
```
`new_string`:
```
        const falPrompt = (isProductCatalog || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4)
          ? prompt
```

- [ ] **Step 9: Syntax check**

Run: `node --check api/creatives/generate.js`
Expected: exit 0, no output.

- [ ] **Step 10: Grep checks**

```bash
grep -c "isProductCatalogV4" api/creatives/generate.js                            # expect 7 (flag + catalogHighWaist + image filter + branch condition + outAspectRatio + refImages + falPrompt)
grep -c "V4_PROMPT_BODY" api/creatives/generate.js                                # expect 2 (import + use)
grep -c "else if (isProductCatalogV4)" api/creatives/generate.js                  # expect 1
grep -c "v4Prefix" api/creatives/generate.js                                      # expect 2 (def + use in template literal)
grep -c "v4HighWaistBlock" api/creatives/generate.js                              # expect 2 (def + use in template literal)
grep -c "isProductCatalogV3 = style" api/creatives/generate.js                    # expect 1 (v3 flag unchanged)
```

- [ ] **Step 11: Run the test suite**

Run: `npm test`
Expected: `Test Files  5 passed (5)`, `Tests  27 passed (27)`. (No tests touch this prompt logic; the test suite just confirms no other regressions.)

- [ ] **Step 12: Commit**

```bash
git add api/creatives/generate.js
git commit -m "$(cat <<'EOF'
feat: backend — Product Catalog v4 (editorial strobe) prompt branch

New isProductCatalogV4 flag + new else-if branch in the prompt chain that builds
prompt = reference-roles prefix + Product: <title> + V4_PROMPT_BODY (verbatim
user prompt) + conditional HIGH-WAIST navel-hide block (when catalogHighWaist).
Routing: same Nano Banana Pro sandwich [avatar, productPhoto, avatar] as v1/v2/v3,
hardcoded 4:5 (aspect_ratio + outAspectRatio), self-contained falPrompt (no extra
wrappers). catalogHighWaist + image filter extended to include v4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 13: Report the commit SHA** (`git rev-parse HEAD`).

---

### Task 3: Frontend — `apps/dashboard/src/components/CreativeStudio.jsx` v4 style + minimal UI

**Files:**
- Modify: `apps/dashboard/src/components/CreativeStudio.jsx`

**Context for the engineer:** `CreativeStudio.jsx` already has v1 / v2 / v3 Product Catalog styles. Each adds itself to `STYLE_MAP` (id → backend key, ~line 30), `STYLE_CATEGORIES` "product-photos" (the picker tile, ~line 110), render-scope flags (`isProductCatalogV1Style` / `V2Style` / `V3Style` + `isAnyCatalogStyle` ~line 522), `handleGenImage`-scope flags (`isProductCatalogV2` / `V3` + `isAnyCatalog` ~line 562), `customInstr` ternary (~line 587), `generateCreatives` field overrides (~line 603), and a per-style UI block (~lines 858, 904, 933). The Generate-button disabled guard is already `isAnyCatalogStyle && !catalogAvatar` — extending `isAnyCatalogStyle` automatically picks up v4. Same for the Aspect-ratio sub-gate `!isAnyCatalogStyle` in the catalog Count/Resolution row. We're adding "product-catalog-v4" mirroring v3 but with even more minimal UI: only Reference model (avatar Select), no Pose, no Beach scene. `customInstr` for v4 is `''` (empty — the prompt is fully server-side). `backendModel` is forced to `fal_nano_banana_pro` (same as v1/v2/v3 — verify the existing force already covers v4 once `isAnyCatalog` includes it).

Make ONLY the changes below. Use the `Edit` tool with EXACT `old_string`s. If you can't find one, report BLOCKED. Do not touch the v1, v2, v3 UI blocks, `CATALOG_MODELS`, `CATALOG_FRAMINGS`, `CATALOG_POSES`, `CATALOG_BEACH_SCENES`.

- [ ] **Step 1: Add v4 to `STYLE_MAP` (~line 30)**

Read lines 29-33 to confirm. Use the `Edit` tool. `old_string`:
```
const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "product-catalog-v3": "product_catalog_v3",
```
`new_string`:
```
const STYLE_MAP = {
  "product-catalog": "product_catalog",
  "product-catalog-v2": "product_catalog_v2",
  "product-catalog-v3": "product_catalog_v3",
  "product-catalog-v4": "product_catalog_v4",
```

- [ ] **Step 2: Add v4 to `STYLE_CATEGORIES` "product-photos" (~line 113-115)**

Read lines 112-117 to confirm. Use the `Edit` tool. `old_string`:
```
      { id: "product-catalog-v3", title: "Product Catalog v3", desc: "Studio shot → beach background (2-step)", icon: "🎬" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```
`new_string`:
```
      { id: "product-catalog-v3", title: "Product Catalog v3", desc: "Studio shot → beach background (2-step)", icon: "🎬" },
      { id: "product-catalog-v4", title: "Product Catalog v4", desc: "Editorial strobe + on-location beach (Andie Swim aesthetic)", icon: "📷" },
      { id: "realistic-beach", title: "Realistic Beach", desc: "Ultra-real curvy model, golden hour, no AI look", icon: "🏖" },
```

- [ ] **Step 3: Add render-scope `isProductCatalogV4Style` + extend `isAnyCatalogStyle` (~lines 522-526)**

Read lines 522-526 to confirm:
```jsx
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isProductCatalogV1Style = imgStyle === "product-catalog";
  const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
Use the `Edit` tool. `old_string`:
```
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isProductCatalogV1Style = imgStyle === "product-catalog";
  const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```
`new_string`:
```
  const isProductCatalogV3Style = imgStyle === "product-catalog-v3";
  const isProductCatalogV4Style = imgStyle === "product-catalog-v4";
  const isProductCatalogV1Style = imgStyle === "product-catalog";
  const isAnyCatalogStyle = isProductCatalogV1Style || imgStyle === "product-catalog-v2" || isProductCatalogV3Style || isProductCatalogV4Style;
  const isProductCatalogV2Style = imgStyle === "product-catalog-v2";
```

- [ ] **Step 4: Extend the `handleGenImage` early-return guard (~line 556)**

Read line 556 to confirm:
```jsx
    if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```
Use the `Edit` tool. `old_string`:
```
    if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```
`new_string`:
```
    if ((imgStyle === 'product-catalog' || imgStyle === 'product-catalog-v2' || imgStyle === 'product-catalog-v3' || imgStyle === 'product-catalog-v4') && !catalogAvatar) { toast.error("Select a reference model first"); return; }
```

- [ ] **Step 5: Extend `isProductCatalogV4` + `isAnyCatalog` in `handleGenImage` (~lines 561-564)**

Read lines 561-564 to confirm:
```jsx
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3;
```
Use the `Edit` tool. `old_string`:
```
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3;
```
`new_string`:
```
    const isProductCatalogV2 = imgStyle === 'product-catalog-v2';
    const isProductCatalogV3 = imgStyle === 'product-catalog-v3';
    const isProductCatalogV4 = imgStyle === 'product-catalog-v4';
    const isAnyCatalog = imgStyle === 'product-catalog' || isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4;
```

- [ ] **Step 6: Add v4 branch (returns `''`) to the `customInstr` ternary (~line 587-595)**

Read lines 586-596 to confirm the current `customInstr` ternary. Use the `Edit` tool. `old_string`:
```
    const customInstr = isProductCatalogV3
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```
`new_string`:
```
    const customInstr = isProductCatalogV4
      ? '' // v4: prompt is fully server-side; no [catalog_*] tags or UI text injection
      : isProductCatalogV3
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}][catalog_beach:${catalogBeach}]\n${catalogPosePrompt}`
      : isProductCatalogV2
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : isProductCatalogStyle
      ? `[catalog_model:${catalogModelLabel}][catalog_pose:${catalogPoseLabel}]\n${catalogPosePrompt}`
      : `${colorPrefix}${poseHint}${bodyHint}${framingHint}${sceneHint}${imgInstructions}${negHint}`.trim();
```

- [ ] **Step 7: Extend the `generateCreatives` field overrides for v4 (~lines 603-614)**

Read lines 602-615 to confirm. Use the `Edit` tool. `old_string`:
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
`new_string`:
```
            show_model: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle) ? true : subject === "On model",
            text_overlay: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle) ? "none" : (textMode === "No text" ? "none" : textMode === "Auto" ? "auto" : "custom"),
            overlay_text: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle) ? "" : (textMode === "Custom" ? customText : ""),
            audience: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle)
              ? (catalogAvatar || undefined)
              : (useAudience && audience !== "auto" ? audience : undefined),
            aspect_ratio: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle) ? "4:5" : imgRatio,
            resolution: backendModel.includes("nano_banana") ? imgResolution : undefined,
            reference_url: (isProductCatalogV2 || isProductCatalogV3 || isProductCatalogV4 || isProductCatalogStyle) ? undefined : colorRef,
```

(All five existing ternaries gain `|| isProductCatalogV4`. Same pattern as v3.)

- [ ] **Step 8: Verify `backendModel` covers v4 (read-only check)**

Search the file for `backendModel`. There should be an existing line that forces it to `fal_nano_banana_pro` for v1/v2/v3 — likely keyed on `isAnyCatalog`. Run:
```bash
grep -n "backendModel" apps/dashboard/src/components/CreativeStudio.jsx | head -5
```
If `backendModel` is set via `isAnyCatalog ? 'fal_nano_banana_pro' : ...`, then Step 5's extension of `isAnyCatalog` already covers v4 — no edit needed. If it's set via an explicit list of styles (e.g. `imgStyle === 'product-catalog' || ...`), extend the list to include `'product-catalog-v4'`. Report which case applies and what (if anything) you changed.

- [ ] **Step 9: Add the v4 UI block (after the v3 block, ~line 950)**

Find the end of the v3 UI block (`{imgStyle === "product-catalog-v3" && (...<>...avatar Select + Pose pills + Beach scene pills...</>...)}`). It ends with `</>` on one line then `)}` on the next. Read lines 933-970 to find the exact boundary. Use the `Edit` tool — `old_string` should be the last 3-4 lines of the v3 block plus the first 1-2 lines of whatever follows (so the anchor is unambiguous). The v4 block to insert right after the v3 block's `)}`:
```jsx
          {/* Catalog v4 controls — Reference model only (everything else is hardcoded server-side) */}
          {imgStyle === "product-catalog-v4" && (
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
          )}
```

(Match the indentation of the surrounding JSX — appears to be 10 spaces.)

If you can't make the `old_string` unambiguous (e.g. multiple identical 3-4-line patterns), STOP and report what you found — don't guess.

- [ ] **Step 10: Build the frontend**

Run: `cd apps/dashboard && npm run build`
Expected: build succeeds, no NEW errors referencing `CreativeStudio.jsx`. Pre-existing dynamic-import warning is fine. If it fails on undefined variable, check scope: `imgStyle` (state), `isProductCatalogV4Style` / `TEXT_MID` (render-scope / module), `isProductCatalogV4` (handleGenImage scope), `catalogAvatar` (state).

- [ ] **Step 11: Commit**

```bash
cd /Users/dan/Desktop/Projects/titan-commerce
git add apps/dashboard/src/components/CreativeStudio.jsx
git commit -m "$(cat <<'EOF'
feat: Studio — "Product Catalog v4" style (editorial strobe, minimal UI)

New style pill in Product photos. Selecting it shows ONLY: Reference model
(avatar Select, required — no __preset__, empty-state hint), Resolution, Count.
Nothing else (no Pose, no Beach scene, no Framing, no Aspect ratio). AI model
forced to Nano Banana Pro. customInstr is empty — the prompt is fully built
server-side from V4_PROMPT_BODY. v1, v2, v3 untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
DO NOT push.

- [ ] **Step 12: Report the commit SHA** (`git rev-parse HEAD`).

---

## Post-implementation: manual verification (after Vercel deploy, ~2-3 min)

For the user — not part of the automated plan:

1. Studio → open a product → select the style pill **"Product Catalog v4"**. Verify the UI shows ONLY:
   - **Reference model** (a dropdown — NOT 3 pills, NOT a `__preset__` "Use text preset below" option)
   - **Resolution** pills
   - **Count**
   - Nothing else. No Pose, no Beach scene, no Framing, no Aspect ratio.
2. With no avatar picked → Generate is greyed/disabled + hint "Select a reference model above to generate."
3. Pick a persona avatar + 2K + Count = 1 → Generate. Output: editorial strobe-lit model, late golden hour beach background, identity matches the chosen avatar, swimsuit copied from the product reference, 4:5 vertical, navel covered (Isola). Generate 2-3× to gauge variance.
4. Vercel logs: `[generate] Submitting fal.ai Nano Banana (has reference), ref images: 3, has persona: true, productCatalog: false` — `productCatalog: false` is expected (the log key tracks v1, not v4).
5. **Regression:** select "Product Catalog" (v1), "Product Catalog v2", "Product Catalog v3" — all three still show their existing UIs and generate normally.
6. Edge: store with no persona avatars → v4 shows hint "No persona avatars yet — create one in the Avatars tab to use this style." Generate disabled.

---

## Self-Review

**Spec coverage:** Spec §"Nový soubor `lib/v4-prompt.js`" → Task 1 ✓. Spec §"Změny v `api/creatives/generate.js`" item 1 (import) → Task 2 Step 1 ✓; item 2 (`isProductCatalogV4` flag) → Step 2 ✓; item 3 (image filter) → Step 4 ✓; item 4 (`catalogHighWaist` extended) → Step 3 ✓; item 5 (new prompt branch with prefix + V4_PROMPT_BODY + HIGH-WAIST block) → Step 5 ✓; item 6 (`outAspectRatio`) → Step 6 ✓; item 7 (`refImages`) → Step 7 ✓; item 8 (`falPrompt`) → Step 8 ✓; item 9 (configMeta — no new fields needed) → not touched, verified ✓; item 10 (ai_model enforcement via frontend) → covered in Task 3 Step 8 (verify backendModel forces nano_banana_pro for v4 via existing `isAnyCatalog` ternary) ✓. Spec §"Změny v `CreativeStudio.jsx`" items 1-10 → Task 3 Steps 1-9 ✓ (Step 9 is the new UI block; Steps 7/8 cover field overrides + backendModel verification). Spec §"poll_generations beze změny" → not touched ✓. Spec §Verifikace → manual verification section ✓.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". The Task 3 Step 8 "verify backendModel covers v4" is a real implementation step (read-only check + conditional fix), not a placeholder. Task 3 Step 9 has explicit "if you can't make `old_string` unambiguous, STOP and report" guidance — that's an instruction, not a placeholder. ✓

**Type consistency:** Backend new identifiers: `isProductCatalogV4` (Task 2 Step 2, used in Steps 3/4/6/7/8 + the prompt branch in Step 5). `V4_PROMPT_BODY` import (Task 2 Step 1, used in Step 5). `v4Prefix` and `v4HighWaistBlock` are local to the new prompt branch (Step 5). Frontend new identifiers: `isProductCatalogV4Style` (render scope, Task 3 Step 3, used in `isAnyCatalogStyle`). `isProductCatalogV4` (handleGenImage scope, Task 3 Step 5, used in Steps 6/7). `customInstr = ''` for v4 (Step 6) — the backend never reads it for v4 (the prompt branch builds prompt from scratch via V4_PROMPT_BODY, doesn't parse `custom_prompt`). The catalog tag regexes (`catalogModelMatch`/`catalogPoseMatch`/`catalogFramingMatch`/`catalogBeachMatch` if any) won't match v4's empty `customInstr` → no metadata pollution. ✓

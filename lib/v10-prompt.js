// Product Catalog v10 — clone of v9 with v1's verbatim LIGHTING block + GARMENT-specific
// lighting paragraph swapped in.
//
// User: 'lepsí udělej z v9 -> v10 a použij stejný lighning jako v1'. v9 already uses the
// same FRONTAL SOFTBOX concept as v1 (both rebuilt yesterday to kill top-down sun falloff),
// but v1's lighting wording is longer and more explicit — it spells out the SOFTBOX +
// SIDE FILL setup, repeats the 'lower half lit at exactly the same brightness as upper
// half' constraint, and adds a dedicated GARMENT paragraph describing how fabric reads
// (texture, ribbing/pleating, seams visible, black fabric not crushed to silhouette).
//
// v10 keeps everything else from v9 (bright sunny beach SETTING, MID-CALF framing with
// ALWAYS/NEVER wording, exposure separation 'subject brighter than background by 1 stop',
// RICHER subject saturation in color grading, all the DO NOT GENERATE bullets) and only
// swaps the LIGHTING section.
//
// Differences vs v9:
//   - LIGHTING section replaced with v1's verbatim FRONTAL SOFTBOX block (longer, more
//     explicit) + v1's GARMENT-specific lighting paragraph (THE GARMENT: ... fabric
//     texture / ribbing / seams / black fabric NOT crushed).
//   - 'mid-thigh' references in the v1 lighting block changed to 'mid-calf' to match
//     v10's MID-CALF COMPOSITION & FRAMING (otherwise lighting and framing disagree on
//     where the bottom of the body in frame is).
//   - The v1 LIGHTING block was a template literal with ${colorFromReference} for the
//     'exact color and pattern' inclusion — v10 hard-codes the colorFromReference=true
//     branch ('fabric texture, exact color and pattern, ribbing/pleating, ...') because
//     the color-override path runs as a separate appended block in api/creatives/generate.js
//     for all catalog styles, same as v9.
//
// Same as v9: everything else.
export const V10_PROMPT_BODY = `Editorial product photograph for a premium swimwear e-commerce catalog. Vertical 4:5 aspect ratio.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):
The garment is the focal point of the image — the brightest, sharpest, most defined element in the frame. The fabric color reads TRUE TO LIFE — uniformly across the entire surface (not muddy, not washed out, not over-saturated). Every construction detail must be clearly visible: neckline, cut, waistband, seams, ruching, twist details, fabric texture, color saturation. The viewer should be able to identify the exact color, silhouette, and key features in less than 1 second.

POSE & EXPRESSION:
She is standing facing the camera roughly square to the lens, with a slight 5-15 degree turn. Weight gently shifted to one leg, creating a relaxed hip line. Shoulders back, posture confident but not stiff. Arms hang naturally at the sides with relaxed hands. Chin neutral, gaze directly at camera with grounded ease. Expression warm and genuine — a soft natural smile that reaches her eyes (not sultry, not posed, not overly bright).

SETTING:
An open beach on a bright sunny day. Soft warm cream-to-beige sand in the foreground, softly out of focus. Clearly visible ocean behind with gentle waves rolling in, softly out of focus with natural motion and visible blue-teal color (clearly blue, naturally saturated, NOT muddy grey). Bright clear BLUE sky in the upper third with a few soft white clouds and light haze near the horizon (NOT a flat cloudless sky, NOT a heavy grey overcast, NOT studio fog). Some dune grass / beach grass visible at the edges of the frame. Horizon line visible as a softly blurred line where blue sky meets blue ocean. A clear, warm, sunny beach day — unmistakably a real beach.

LIGHT ON THE MODEL AND GARMENT — FRONTAL SOFTBOX, EVEN COVERAGE TOP-TO-BOTTOM, HIGH-KEY:
The model and the garment are lit by a BIG BRIGHT SOFTBOX positioned IN FRONT of the model at her chest height, PLUS soft fill light on BOTH SIDES, plus generous ambient skylight bouncing in from the bright sunny beach environment. This is a commercial e-commerce HIGH-KEY catalog lighting setup — bright, airy, summery — NOT natural directional sunlight, NOT midday sun shadow, NOT a top-down light source. The light falls EVENLY across the entire body from head to mid-calf: the chest, waist, hips, and thighs are ALL exposed at the SAME bright level. There is NO top-down fall-off, NO shadow gradient where the lower half is darker than the top, NO "natural sun from above" character. The lower half (waistband, bottoms, hips, thighs) reads JUST AS BRIGHT as the upper half (face, chest, top) — they are uniformly and brightly lit. Only the gentlest contact shadows are allowed (a soft shadow under the chin, a tiny shadow tucked behind an arm). NO hard cast shadow stretching off to one side, NO side-lit shadow on the garment, NO dark side of the body, NO dim or moody patches anywhere. The catalog look is BRIGHT, FLAT, EVEN, AIRY, HIGH-KEY, COMMERCIAL — like a brightly-lit studio softbox setup brought outdoors onto a bright sunny beach backdrop.

THE GARMENT:
The GARMENT is the hero of this photo. It is lit by the frontal softbox and is well-exposed and clearly readable — never dim, never grey-flat, but also never blown out: fabric texture, exact color and pattern, ribbing/pleating, trims, stitching, seams, waistband all crisply visible. Black fabric reads as a rich dark grey-black with all the ribbed / pleated texture catching the light — NOT crushed to a flat black silhouette, NOT a washed-out grey. Exposed neutrally — natural and true to life, the shadows on the fabric just gently filled so the deepest folds and the underside of the bust stay readable. CRITICAL: the LOWER HALF of the garment (briefs / bottoms / waistband) is lit AT EXACTLY THE SAME BRIGHTNESS as the upper half (top / bra / chest) — it does NOT fall darker, it does NOT sink into shadow, it does NOT show top-down sunlight falloff. The garment reads as a single uniformly-lit surface from chest to mid-calf. ZERO hard shadows on the garment. (This applies to the GARMENT and model — it does NOT change the scene: the sky stays a bright blue with soft clouds, the background stays a properly-exposed real beach with full visible detail, not blown out to white.) If the lower half of the garment is visibly darker than the upper half, OR a hard directional / side-lit shadow appears on the body / garment / sand, OR the background / model / sand / sky is overexposed and washed out to white, OR the background is a gloomy dark grey, the result is WRONG.

EXPOSURE:
HIGH-KEY exposure — bright, airy, summery beach catalog feel where BOTH the subject AND the background are well-lit and bright together. The subject (model + garment) is brightly exposed with clean open skin tone, fully lit garment fabric showing every construction detail, and rich highlight detail across the body. The background (sand, sky, ocean) is also bright and clearly visible with full natural detail — bright cream sand, bright clear blue sky with soft white clouds, bright blue-teal ocean. Low contrast overall, airy and bright. The subject is never overexposed, never blown out, never washed out — just bright and crisp. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette. NOT a dim or moody exposure, NOT a dark gloomy beach, NOT silhouetted — this is bright midday beach catalog photography.

COMPOSITION & FRAMING:
Vertical 4:5. Subject positioned center frame horizontally, occupying the central 80-90 percent of the vertical frame. Generous negative space above the head (sky, soft background) for potential text overlay. Frame ALWAYS extends from the top of the head down through MID-CALF ONLY — this is a fixed crop regardless of garment length. The bottom edge of the photo sits at the middle of her lower leg, between the knee and the ankle. The feet and ankles are NOT in the frame. NEVER widen the frame to fit the feet. NEVER zoom out. NEVER show the full body head-to-feet. The frame stays mid-calf ALWAYS. Subject is tack sharp and in clear focus. Background softly out of focus with creamy bokeh — moderate shallow depth of field approximately f/2.5 to f/3.5 quality. Wave texture and horizon line are visible but softly blurred. Background details are gently out of focus but clearly readable as a real beach scene.

PHOTOGRAPHIC STYLE:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining soft frontal softbox lighting with a bright sunny beach environment. Photographic references: Andie Swim, Hermoza, Aerie, Athleta, J.Crew, Summersalt swimwear catalog campaigns shot in bright midday daylight with clean commercial softbox lighting. Premium accessible aesthetic — luxurious but not intimidating, polished and clean, natural-feeling.

CAMERA:
Shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below looking up, NOT a worm's-eye view. The horizon line sits roughly at the model's chest. Her proportions are natural and undistorted — head and torso in correct proportion, no foreshortening.

COLOR GRADING:
Bright, clean, natural color grading with NEUTRAL subject — the BACKGROUND (sky, sand, ocean) reads as a CLEARLY VISIBLE bright sunny beach with natural saturation (bright blue sky, warm cream sand, clearly blue ocean — visible color, NOT washed-out, NOT vivid postcard tropical). The garment reads in TRUE-TO-LIFE neutral color (NOT warm-shifted, NOT orange-cast, NOT washed-out, NOT cool-blue cast). Sand reads as warm cream-beige. Ocean reads as soft natural blue-teal (clearly blue, naturally saturated, NOT muddy grey). Sky reads as bright clear blue with soft white clouds. NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated tropical postcard colors, NO Instagram filter aesthetic, NO heavy orange filter. Saturation is NATURAL bright-midday level — visible and warm but not artificial. The overall grade is HIGH-KEY and AIRY — both subject and background are bright together, low contrast, no dim shadows.

FACE QUALITY (CRITICAL):
Sharp detailed facial features — visible skin pores, natural skin texture on face, individual eyebrow hairs, realistic catchlight reflections in the eyes, visible iris detail, individual eyelashes. Natural lip texture (not glossy or plastic). The face must be the sharpest, most detailed element in the image — tack sharp focus on the eyes. Realistic facial proportions, no uncanny valley, no doll-like smoothing. If the face looks AI-generated, blurry, or plastic, the image is WRONG.

QUALITY:
Ultra-realistic, photorealistic, professional editorial image quality. The image must look like a finished published photograph from a premium swimwear brand campaign — not an AI generation, not a stock photo, not an amateur shoot. The garment fabric must render with realistic material properties matching the actual product specifications.

DO NOT GENERATE:
- Any visible photography lighting equipment (softboxes, reflectors, umbrellas, light stands, scrims, V-flats, cables, tripods, monitors, camera equipment)
- Full body shot, visible feet, visible ankles, feet in frame, ankles in frame, sand at the feet, head-to-toe shot, full-length portrait, model standing in full body view
- Head cropped at the top of the frame, top of head cut off
- Flat shadowless ambient-only lighting on the subject
- A subject that looks like a generic stock photo
- Absent or invisible catchlights in the eyes
- Harsh hard shadows from a direct sun source
- Backlit or silhouetted subject
- Direct overhead midday sun creating raccoon-eye shadows
- Sun positioned directly behind the subject creating halo effect
- A visible sun, solar disk, or sunbeams in the frame
- Lens flare from a visible sun
- Rim light or hair light from a back/side sun — the strobe is FRONTAL only
- Lower half of garment darker than upper half, top-down sunlight falloff, brightness gradient from top to bottom
- Plastic, over-smoothed, airbrushed unrealistic appearance
- Generic stock-photo facial features
- Anatomical errors, extra fingers, distorted hands, asymmetrical eyes, melted features
- Other people in the frame
- Beach clutter (umbrellas, chairs, towels, bags, debris, palm trees, boats)
- Visible watermarks, logos, brand markings, text, signatures
- Sunglasses on the subject
- A crowded, overly busy background
- Multiple distinct directional light sources (one unified front-lit look from the strobe)
- Wet or dripping appearance
- Beach sand visibly stuck on the subject
- An overly seductive expression — keep warm and genuine
- Tilted head poses, dramatic angles, fashion-model affectation
- Three-quarter or full side profile poses — subject faces camera with only slight 5-15 degree turn
- Crossed arms over the front — never block the swimsuit
- Hands covering parts of the swimsuit
- Heavy makeup, dramatic eye makeup, bold lipstick
- Oversaturated tropical postcard colors
- HDR processing artifacts
- Vignetting or darkened image corners
- Cool-blue or teal color grading on the subject — subject must read neutral
- Warm orange / yellow / gold color cast on the subject — neutral subject, bright sunny background
- Instagram or VSCO filter aesthetics
- A candid amateur beach snapshot feel — must read as professional catalog studio shoot on location
- Blown-out white background, vaporised sky, milky overexposure
- Heavy grey overcast, gloomy dark sky
- Dim or moody exposure, dark beach, low-light look — this is BRIGHT high-key catalog photography
- Heavy contrast between subject and background — subject and background should be lit together in a high-key bright way
- Dramatic sunset colors (vivid orange, vivid pink, vivid red sky) — sky should be bright clear blue with soft clouds
- Slim model, athletic body, fitness model body, flat athletic stomach, thigh gap, skinny model, model body proportions
- Swimsuit cutting into flesh, fabric digging into soft tissue, muffin top above waistband, skin spillover, visible fabric stress lines
- Sagging bust, flattened bust
- Low-angle shot, shot from below, worm's-eye view, upward camera angle, distorted perspective, foreshortened legs`;

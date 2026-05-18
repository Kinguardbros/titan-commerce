// Product Catalog v9 — clean monolithic prompt for a bright sunny beach catalog shot.
//
// Built as a direct response to v1 becoming a 15+ KB convolute (modelDesc + customInstr +
// catalog tags + framingBlock + LIGHTING tirades + GARMENT × BODY block + FACE QUALITY +
// CAMERA + NEGATIVE list) that Nano Banana couldn't follow consistently — the framing
// instruction kept getting drowned out by the other content.
//
// v9 mirrors v7/v8 structure: one monolithic body (~6 KB), strictly sectioned (WARDROBE,
// POSE, SETTING, LIGHTING, EXPOSURE, COMPOSITION & FRAMING, PHOTOGRAPHIC STYLE, COLOR
// GRADING, QUALITY, DO NOT GENERATE), with the v7/v8 'ALWAYS / NEVER, frame extends from
// top of head down through MID-CALF ONLY' pattern that consistently produced 3/4 body
// crops on Nano Banana's first try.
//
// Difference vs v7: SETTING is bright sunny beach (blue sky, white clouds, warm sand) not
// soft warm afterglow. EXPOSURE is bright natural daylight not balanced afterglow.
// Same as v7/v8: WARDROBE, POSE, LIGHTING (frontal softbox), COMPOSITION & FRAMING,
// PHOTOGRAPHIC STYLE structure.
//
// Same NSFW-safe vocabulary as v5/v6/v7/v8 (no body/skin/torso triggers).
export const V9_PROMPT_BODY = `Editorial product photograph for a premium swimwear e-commerce catalog. Vertical 4:5 aspect ratio.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):
The garment is the focal point of the image — the brightest, sharpest, most defined element in the frame. The fabric color reads TRUE TO LIFE — uniformly across the entire surface (not muddy, not washed out, not over-saturated). Every construction detail must be clearly visible: neckline, cut, waistband, seams, ruching, twist details, fabric texture, color saturation. The viewer should be able to identify the exact color, silhouette, and key features in less than 1 second.

POSE & EXPRESSION:
She is standing facing the camera roughly square to the lens, with a slight 5-15 degree turn. Weight gently shifted to one leg, creating a relaxed hip line. Shoulders back, posture confident but not stiff. Arms hang naturally at the sides with relaxed hands. Chin neutral, gaze directly at camera with grounded ease. Expression warm and genuine — a soft natural smile that reaches her eyes (not sultry, not posed, not overly bright).

SETTING:
An open beach on a bright sunny day. Soft warm cream-to-beige sand in the foreground, softly out of focus. Clearly visible ocean behind with gentle waves rolling in, softly out of focus with natural motion and visible blue-teal color (clearly blue, naturally saturated, NOT muddy grey). Bright clear BLUE sky in the upper third with a few soft white clouds and light haze near the horizon (NOT a flat cloudless sky, NOT a heavy grey overcast, NOT studio fog). Some dune grass / beach grass visible at the edges of the frame. Horizon line visible as a softly blurred line where blue sky meets blue ocean. A clear, warm, sunny beach day — unmistakably a real beach.

LIGHTING:
Commercial e-commerce catalog lighting — a BIG SOFTBOX positioned DIRECTLY IN FRONT of the subject at her chest height (max 10-15 degrees off-axis), plus soft fill light on BOTH SIDES, producing FLAT FRONTAL ILLUMINATION across the entire body. The light is clean, even, well-defined — the subject and garment are clearly lit from head to mid-calf with NO top-down sunlight falloff, NO shadow gradient where the lower half is darker, NO 'natural sun from above' character. The lower half (waistband, bottoms, hips, thighs) reads JUST AS BRIGHT as the upper half (face, chest, top). Only the gentlest contact shadows are allowed (a soft shadow under the chin, a tiny shadow tucked behind an arm). NO hard cast shadow stretching to one side, NO side-lit shadow on the garment, NO dark side of the body, NO rim light, NO backlight. Subtle catchlights in the eyes. The catalog look is FLAT, EVEN, COMMERCIAL — like a studio softbox setup brought outdoors onto a beach backdrop.

EXPOSURE:
Bright, balanced, true-to-life exposure — the model and garment are clearly readable from head to mid-calf, never dim and never dark, but also never overexposed, never blown out, never washed out. The background (sand, sky, ocean) is also properly exposed with full visible detail — NOT vaporised to white, NOT a foggy haze, NOT a gloomy dark grey. Black fabric reads as a rich dark grey-black with the ribbed texture / pleating / seams clearly visible — NOT crushed to a flat black silhouette.

COMPOSITION & FRAMING:
Vertical 4:5. Subject positioned center frame horizontally, occupying the central 80-90 percent of the vertical frame. Generous negative space above the head (sky, soft background) for potential text overlay. Frame ALWAYS extends from the top of the head down through MID-CALF ONLY — this is a fixed crop regardless of garment length. The bottom edge of the photo sits at the middle of her lower leg, between the knee and the ankle. The feet and ankles are NOT in the frame. NEVER widen the frame to fit the feet. NEVER zoom out. NEVER show the full body head-to-feet. The frame stays mid-calf ALWAYS. Subject is tack sharp and in clear focus. Background softly out of focus with creamy bokeh — moderate shallow depth of field approximately f/2.5 to f/3.5 quality. Wave texture and horizon line are visible but softly blurred. Background details are gently out of focus but clearly readable as a real beach scene.

PHOTOGRAPHIC STYLE:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining soft frontal softbox lighting with a bright sunny beach environment. Photographic references: Andie Swim, Hermoza, Aerie, Athleta, J.Crew, Summersalt swimwear catalog campaigns shot in bright midday daylight with clean commercial softbox lighting. Premium accessible aesthetic — luxurious but not intimidating, polished and clean, natural-feeling.

CAMERA:
Shot at the model's chest height, lens parallel to the ground — a straight, eye-level catalog perspective. NOT a low-angle shot, NOT shot from below looking up, NOT a worm's-eye view. The horizon line sits roughly at the model's chest. Her proportions are natural and undistorted — head and torso in correct proportion, no foreshortening.

COLOR GRADING:
Bright, clean, natural color grading with NEUTRAL subject — the BACKGROUND (sky, sand, ocean) reads as a CLEARLY VISIBLE bright sunny beach with natural saturation (bright blue sky, warm cream sand, clearly blue ocean — visible color, NOT washed-out, NOT vivid postcard tropical). The garment reads in TRUE-TO-LIFE neutral color (NOT warm-shifted, NOT orange-cast, NOT washed-out, NOT cool-blue cast). Sand reads as warm cream-beige. Ocean reads as soft natural blue-teal (clearly blue, naturally saturated, NOT muddy grey). Sky reads as bright clear blue with soft white clouds. NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated tropical postcard colors, NO Instagram filter aesthetic, NO heavy orange filter. Saturation is NATURAL bright-midday level — visible and warm but not artificial.

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
- Dramatic sunset colors (vivid orange, vivid pink, vivid red sky) — sky should be bright clear blue with soft clouds
- Slim model, athletic body, fitness model body, flat athletic stomach, thigh gap, skinny model, model body proportions
- Swimsuit cutting into flesh, fabric digging into soft tissue, muffin top above waistband, skin spillover, visible fabric stress lines
- Sagging bust, flattened bust
- Low-angle shot, shot from below, worm's-eye view, upward camera angle, distorted perspective, foreshortened legs`;

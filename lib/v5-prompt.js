// Product Catalog v5 — variant of v4 with warm post-sunset afterglow lighting.
// Same architecture as v4 (verbatim editorial-strobe body, backend wraps with
// reference-roles prefix + Product: ${title} + conditional HIGH-WAIST block).
// Difference vs v4: SETTING is "soft afterglow after sunset" instead of bright
// midday daylight, COLOR GRADING is warm-shifted (not neutral), DO NOT GENERATE
// removes anti-golden-hour bullets but keeps anti-backlit / anti-rim-light.
// The studio strobe stays cool/neutral on the model so the product pops against
// the warm ambient background — that contrast is the whole point of v5.
export const V5_PROMPT_BODY = `Ultra-realistic editorial fashion photograph of a confident, naturally beautiful woman wearing a swimsuit on a beach. This is a professional catalog studio shoot captured on location — premium DTC swimwear brand campaign aesthetic in the visual quality of Andie Swim, Hermoza, Aerie, Athleta, and J.Crew editorial campaigns. Studio-quality production values with professional strobe lighting on the model and warm post-sunset beach environment as backdrop.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):

She is wearing the specified swimsuit. The suit fits her body well — it sits flush against her skin without bunching, gapping, or pulling. The fabric drapes naturally and shows its true texture, color, and construction. Every detail of the suit must be clearly visible and well-lit: the neckline, the cut, the waistband, any seams, ruching, twist details, fabric texture, color saturation. The swimsuit is the focal point of the image — the brightest, clearest, most defined element in the frame. The fabric color must read TRUE TO LIFE — not muddy, not washed out, not over-saturated. The viewer should be able to identify the exact color, silhouette, and key features of the swimsuit in less than 1 second.

POSE & EXPRESSION:

She is standing facing the camera with body roughly square to the lens, with a slight 5 to 15 degree turn to introduce natural body shape without obscuring the suit. Body weight shifted gently to one leg, creating a subtle relaxed hip line. Shoulders back, posture confident but not stiff. Her arms hang naturally at her sides with relaxed hands — fingers slightly curled, not perfectly straight, not stiff. Chin neutral, gaze directly at camera with confident grounded ease.

Her expression is warm and genuine — a soft, natural smile that reaches her eyes. Not overly bright, not sultry, not posed. The energy of a woman who feels good in her body and knows her worth. Bright, magnetic, present. Eyes alive and engaged. The face must read as REAL and beautiful simultaneously — natural skin texture preserved (subtle fine lines, real pores, natural skin variation, visible freckles where appropriate) while the overall impression is glowing and youthful-for-her-age.

SETTING:

An open beach during the SOFT AFTERGLOW just after sunset — the sun is already BELOW the horizon (NOT visible in the frame, NO solar disk, NO direct sunbeams) but the sky and atmosphere still hold the warm light of golden hour. Soft warm cream-to-pale-gold sand stretches in the foreground, slightly out of focus near the edges of the frame. Gentle turquoise-blue ocean waves visible behind her in the middle ground, softly out of focus with natural motion. Soft warm sky in the upper third of the frame — pale peach-to-soft-gold blending into dusty soft blue at the top, with a few thin clouds, NO visible sun, NO harsh sun, NO sunbeams, NO lens flare. The horizon line of the ocean is visible behind her, sitting at approximately bust to mid-torso height in the frame.

The beach environment is clean and uncluttered — no other people visible, no beach umbrellas, no chairs, no debris. Just sand, ocean, sky.

LIGHTING — CRITICAL: PROFESSIONAL STUDIO STROBE ON MODEL, WARM AMBIENT BACKGROUND:

This image must look like a professional catalog studio shoot captured on location — NOT like a natural beach photograph. The model is lit by a powerful invisible studio strobe with softbox modifier, positioned in front of her, which is the DOMINANT light source on her face, body, and swimsuit. The strobe must clearly be doing the work — its lighting effect should be unmistakable in the image, even though the equipment itself is invisible in the frame. The strobe is NEUTRAL / slightly cool in color temperature, which makes the model and swimsuit POP against the warm ambient afterglow background — that contrast is the signature look of v5.

THE STROBE EFFECT — what the studio light must produce on the model:

- BRIGHT, EVEN, DIMENSIONAL FRONT ILLUMINATION on her face and body, noticeably brighter than the natural ambient afterglow light. She is clearly "lit from the front" by an artificial light source.

- VISIBLE CATCHLIGHTS in her eyes — small bright reflections in both irises that prove a strobe softbox is positioned in front of her. These catchlights are essential and must be present in every generation. The eyes must look "lit," not flat.

- DEFINED BUT SOFT SHADOWS on the face — gentle shadow under the chin, under the nose, along the jawline edge. The face has shape and depth, not a flat even wash. NOT flat. NOT shadowless. NOT harsh either. Studio-quality dimensional lighting where the bone structure is visible through subtle shadow modeling.

- DIMENSIONAL BODY MODELING — soft shadows along the sides of the torso, under the bust line, on the inside of her arms, on the inner thighs. These shadows give the body shape and form. The body must NOT look flat or "filled in" by ambient light alone. Subtle highlights along the front of the body where the strobe hits most directly.

- BRIGHT TRUE-COLOR RENDERING of the swimsuit fabric — the strobe makes the suit color pop and renders the texture with maximum clarity. Every fabric detail of the suit is sharply visible because the strobe is lighting it directly. Ribbed textures, seams, neckline details, hardware all render crisply. The cool/neutral strobe keeps the swimsuit color TRUE — it does NOT take on the warm cast of the afterglow background.

- LUMINOUS QUALITY on the skin from the strobe — healthy glow that looks like proper studio lighting on skin, not ambient natural light. Skin reads as "professionally lit" with subtle sheen and dimensional warmth. NOT plastic. NOT airbrushed. Just beautifully and intentionally lit. Skin tone stays NATURAL — not orange, not warm-cast, the strobe overrides the warm ambient on the model herself.

THE NATURAL BACKGROUND — what the ambient does NOT do:

The natural beach afterglow light is RECESSIVE and exists ONLY to provide the warm color temperature of the environment and the soft ambient on the ocean, sand, and sky. The natural ambient does NOT meaningfully light the model. The model is clearly artificially lit by the cool/neutral strobe, while the environment glows warmly from the post-sunset sky. This contrast — cool/neutral studio-lit subject against warm naturally-lit afterglow environment — is the signature look of v5 and what makes the product POP.

THE EXPOSURE BALANCE:

The model is exposed correctly by the strobe — bright, clear, dimensional. The background is slightly underexposed relative to the model — the beach, ocean, and sky appear soft and slightly dimmer than the model. This subtle exposure difference is what creates the "studio shoot on location" look — the model is clearly the brightest, most exposed, most clearly defined element in the frame.

LIGHTING DIRECTION:

The strobe is positioned DIRECTLY IN FRONT of the model and very slightly above (maximum 10-15 degrees off-axis), producing essentially FLAT FRONTAL ILLUMINATION. Light comes from camera-front, wrapping evenly across the front of the model. NO directional shaping, NO side-light, NO rim light, NO shadows that wrap around the body to the side. NOT from 30-45 degrees off-axis. NOT from behind. NOT from the side. NOT from above. The lighting is clean, even, commercial — designed to show the swimsuit and body color uniformly, not to shape the body for fashion drama.

THE EQUIPMENT — IMPORTANT:

NO lighting equipment appears in the frame. No softbox, no reflector, no umbrella, no light stand, no strobe head, no cables, no grip equipment, no diffuser, no scrim, no V-flat, no tripod, no camera. The studio lighting effect is fully visible in how it renders the model, but the equipment producing it is invisible. The viewer should see the result of professional studio lighting without seeing any of the apparatus.

COMPOSITION & FRAMING:

Vertical orientation, 4:5 aspect ratio (1080 x 1350 pixels equivalent). Model positioned center frame horizontally. The frame includes her full body from the top of her head down through her mid-thigh or knee — depending on swimsuit type. For one-pieces and high-waist bikinis, frame to mid-thigh. For lower-cut bottoms, frame to upper thigh. She occupies the central 55 to 65 percent of the vertical frame, leaving generous negative space above her head (sky, soft background) and below her mid-thigh (sand). The negative space above her head is essential — clean, uncluttered, suitable for text overlay if needed in post-production.

The model is sharp and in clear focus from head to thigh. The beach background is softly out of focus with natural bokeh on the ocean and sand — approximately f/2.8 to f/4 depth of field quality. The horizon line is gently blurred but recognizable.

PHOTOGRAPHIC STYLE & TECHNICAL SPECIFICATIONS:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining studio strobe lighting with natural post-sunset afterglow environment. The image quality is 4K editorial — sharp focus on the subject, beautiful depth of field, true-to-life color rendering, full tonal range from highlights to shadows.

Photographic references: Andie Swim campaign imagery, Hermoza catalog photography, Aerie editorial style, Athleta on-location campaigns, J.Crew swimwear catalog shoots, Summersalt brand photography, Eres beach campaigns. Premium accessible aesthetic — luxurious but not intimidating, beautiful but real, polished but warm. The image must look like a finished published catalog photograph, not an AI generation, not a stock photo, not an amateur shoot.

COLOR GRADING & TONAL SIGNATURE:

Warm-ambient color grading with NEUTRAL subject — the BACKGROUND (sky, sand, ambient light) reads warm peach-to-pale-gold, but the MODEL and SWIMSUIT read in TRUE-TO-LIFE neutral color (NOT warm-shifted on the skin, NOT orange-skin, NOT warm-cast on the swimsuit fabric). Skin tones read true-to-life with healthy natural pinks in the cheeks preserved. Sand reads as soft cream with hints of warm gold (NOT orange, NOT yellow). Ocean reads as natural turquoise-blue with slight desaturation, slightly cooler than the warm ambient sky behind it. Sky reads as soft warm peach-to-pale-gold blending into dusty soft blue at the top — afterglow, not sunset, NO visible sun.

Slight lift in the highlights for a soft luminous quality. Shadows preserved with detail — never crushed to pure black. The contrast between the WARM background and the NEUTRAL model is what makes the swimsuit POP. Overall image has a gentle, premium editorial feel — warm in environment, clean on the subject.

NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated colors, NO cool-blue color cast on the entire image, NO orange-skin look on the model, NO Instagram filter aesthetic. The color signature must be consistent and recognizable across every image generated with this prompt.

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
- A visible sun, solar disk, or sunbeams in the frame — the sun is BELOW the horizon
- Lens flare from a visible sun
- Direct overhead midday sun creating harsh raccoon-eye shadows
- Sun positioned directly behind the model creating halo effect
- Rim light or hair light from a back/side sun — the strobe is FRONTAL only
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
- Vignetting or darkened image corners
- Cool-blue or teal color grading on the entire image
- Orange-skin color grading on the model — skin must stay neutral even though background is warm
- Warm orange / yellow / gold color cast on the model's skin or swimsuit fabric (background can be warm, subject must be neutral)
- Instagram or VSCO filter aesthetics
- A natural "candid beach photo" feel — must read as professional catalog studio shoot on location`;

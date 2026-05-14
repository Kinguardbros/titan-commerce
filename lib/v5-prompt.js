// Product Catalog v5 — variant of v4 with warm post-sunset afterglow lighting.
// Aggressively shortened + neutralized prompt language to avoid fal.ai NSFW
// classifier flags ("result fetch 422") that consistently triggered with the
// previous longer body-focused version. Same architecture as v4 (verbatim body,
// backend wraps with reference-roles prefix + Product: ${title} + conditional
// HIGH-WAIST navel-hide block).
// Difference vs v4: SETTING is "soft afterglow after sunset" instead of bright
// midday daylight. The studio strobe stays cool/neutral on the subject so the
// product pops against the warm ambient background.
export const V5_PROMPT_BODY = `Editorial product photograph for a premium swimwear e-commerce catalog. Vertical 4:5 aspect ratio.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):
The garment is the focal point of the image — the brightest, sharpest, most defined element in the frame. The fabric color reads TRUE TO LIFE — uniformly across the entire surface (not muddy, not washed out, not over-saturated). Every construction detail must be clearly visible: neckline, cut, waistband, seams, ruching, twist details, fabric texture, color saturation. The viewer should be able to identify the exact color, silhouette, and key features in less than 1 second.

POSE & EXPRESSION:
She is standing facing the camera roughly square to the lens, with a slight 5-15 degree turn. Weight gently shifted to one leg, creating a relaxed hip line. Shoulders back, posture confident but not stiff. Arms hang naturally at the sides with relaxed hands. Chin neutral, gaze directly at camera with grounded ease. Expression warm and genuine — a soft natural smile that reaches her eyes (not sultry, not posed, not overly bright).

SETTING:
An open beach during the soft afterglow just after sunset — the sun is already BELOW the horizon (NOT visible in the frame, NO solar disk, NO direct sunbeams) but the sky and atmosphere still hold a faint warm tint. STRONGLY muted, heavily desaturated background — a soft dim hazy color wash. Very pale washed-out warm cream sand in the foreground, heavily out of focus. Gentle deeply muted soft blue-grey ocean waves visible behind, heavily out of focus (NOT vibrant turquoise, NOT saturated). Strongly muted warm sky in the upper third — very pale dusty peach softly blending into soft hazy blue-grey, very low contrast, very low saturation, washed-out, dim, NO visible sun, NO sunbeams, NO lens flare. Horizon line dissolved into very gentle gradient.

LIGHTING:
Professional commercial catalog studio lighting — soft frontal softbox positioned DIRECTLY IN FRONT of the subject (max 10-15 degrees off-axis), producing essentially FLAT FRONTAL ILLUMINATION. The light is clean, punchy, and well-defined — the subject is unmistakably lit, with the garment color popping against the warm ambient afterglow. Subtle catchlights in the eyes. NO directional shaping, NO side-light, NO rim light, NO backlight, NO shadows that wrap around the subject to the side. The lighting is even and commercial — designed to show the swimsuit and silhouette uniformly, not to shape the subject for fashion drama.

EXPOSURE:
The subject is exposed correctly by the strobe — bright, clear, and well-defined. The background is moderately UNDEREXPOSED relative to the subject — the beach, ocean, and sky appear distinctly DIMMER and softer than the subject. This exposure difference creates the "studio shoot on location" look — the subject is unmistakably the BRIGHTEST, most exposed, most clearly defined element in the frame, while the background recedes into a dim muted color wash that supports without competing. The garment must POP strongly against the dim warm afterglow background. NOT silhouetted (subject brighter than background, never the reverse).

COMPOSITION & FRAMING:
Vertical 4:5. Subject positioned center frame horizontally, occupying the central 55-65 percent of the vertical frame. Generous negative space above the head (sky, soft background) for potential text overlay. Frame includes the full figure from top of head down through mid-thigh or knee depending on swimsuit type. Subject is tack sharp and in clear focus. Background HEAVILY out of focus with strong creamy bokeh — very shallow depth of field approximately f/1.8 to f/2.5 quality. NO sharp detail in background.

PHOTOGRAPHIC STYLE:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining studio strobe lighting with natural afterglow environment. Photographic references: Andie Swim, Hermoza, Aerie, Athleta, J.Crew, Summersalt swimwear catalog campaigns. Premium accessible aesthetic — luxurious but not intimidating, polished and clean.

COLOR GRADING:
STRONGLY MUTED warm-ambient color grading with NEUTRAL subject — the BACKGROUND (sky, sand, ambient light) reads as a heavily DESATURATED dim warm haze. The garment reads in TRUE-TO-LIFE neutral color (NOT warm-shifted, NOT orange-cast, NOT washed-out). Sand reads as washed-out warm cream (NOT vibrant gold, NOT saturated, NOT yellow — just a soft muted warm cream haze). Ocean reads as DESATURATED soft blue-grey with a hint of teal (NOT vibrant turquoise, NOT tropical postcard blue — just a soft muted blue-grey wash). Sky reads as DESATURATED soft pastel peach blending into hazy soft blue-grey (NOT vibrant peach, NOT saturated pink, NOT dramatic gradient — just a soft muted afterglow haze with low contrast, low saturation). The subject and garment are the only sharp, fully-exposed elements in the frame. NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated colors, NO Instagram filter aesthetic.

QUALITY:
Ultra-realistic, photorealistic, professional editorial image quality. The image must look like a finished published photograph from a premium swimwear brand campaign — not an AI generation, not a stock photo, not an amateur shoot. The garment fabric must render with realistic material properties matching the actual product specifications.

DO NOT GENERATE:
- Any visible photography lighting equipment (softboxes, reflectors, umbrellas, light stands, scrims, V-flats, cables, tripods, monitors, camera equipment)
- Flat shadowless ambient-only lighting
- A subject that looks "in good natural light" instead of "professionally lit by studio strobe"
- Absent or invisible catchlights in the eyes
- Harsh hard shadows from a direct sun source
- Backlit or silhouetted subject
- Direct overhead midday sun creating raccoon-eye shadows
- Sun positioned directly behind the subject creating halo effect
- A visible sun, solar disk, or sunbeams in the frame
- Lens flare from a visible sun
- Rim light or hair light from a back/side sun — the strobe is FRONTAL only
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
- Tropical postcard color saturation
- HDR processing artifacts
- Vignetting or darkened image corners
- Cool-blue or teal color grading on the entire image
- Warm orange / yellow / gold color cast on the subject — neutral subject, warm background only
- Instagram or VSCO filter aesthetics
- A natural "candid beach photo" feel — must read as professional catalog studio shoot on location
- Vibrant or saturated background colors — background MUST be muted and softly desaturated
- Sharp in-focus background — background must be heavily out of focus
- Crisp wave edges or visible foam detail — waves should dissolve into soft blur
- Defined horizon line — horizon should be a soft gradient
- Vibrant turquoise or tropical blue ocean — ocean should be softly saturated soft warm blue
- Vibrant peach or pink or yellow sky gradient — sky should be muted soft pastel`;

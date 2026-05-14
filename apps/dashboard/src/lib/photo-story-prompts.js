// Photo Story prompt templates — extracted from ISOLA-MASTER-PROMPT-SYSTEM.md
// Each shot's buildPrompt(product, heroColor) returns a custom_prompt string for generateCreatives()

// Consistency instruction appended to every shot (except material close-up)
const MODEL_CONSISTENCY = `\n\nCRITICAL MODEL CONSISTENCY: The FIRST reference image shows the EXACT model to use — match her face, hair color and style, skin tone, body type, and age PRECISELY. She must be recognizable as the same person. Do NOT change the model. IMPORTANT: Follow the GAZE direction specified above — each shot has a DIFFERENT eye/head direction. Do NOT default to looking at camera for every shot.`;

export const STORY_SHOTS = [
  {
    key: 'hero',
    label: 'Hero Shot',
    order: 1,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Three-quarter angle full body shot. Model positioned at 30-degree angle to camera, facing slightly left. GAZE: Looking directly at camera with warm confident eye contact. Weight on right hip, creating natural S-curve silhouette. Arms relaxed at sides, fingers slightly apart. Model fills approximately 70% of vertical frame. Head to just below knees visible.

Swimsuit: ${p.title} in ${color}.
${p.description ? `Product details: ${p.description}` : ''}
Fabric sitting smoothly on body with zero bunching, zero rolling at waistband.

This is the ANCHOR image. All subsequent images must match this lighting and THIS EXACT MODEL.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'lifestyle',
    label: 'Lifestyle',
    order: 3,
    defaultOn: true,
    suggestedStyle: 'lifestyle',
    cost: 0.14,
    buildPrompt: (p, color) => `Full body shot, slightly wider framing. SAME MODEL as the hero shot. Model walking slowly toward camera at slight angle, one foot ahead of other, natural stride. Arms swinging gently or one hand lightly touching hair. GAZE: Looking slightly past camera to the right, as if noticing something interesting — NOT looking at camera. Genuine relaxed smile. Wind catching hair slightly.

Swimsuit: ${p.title} in ${color}.
Full product visible from neckline to mid-thigh. Fabric moving naturally with body motion. Waistband staying in place during movement.

Environment more visible — background fills 40% of frame. Shot feels candid, as if photographer captured a genuine moment.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'detail',
    label: 'Detail / Focus',
    order: 4,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Tightly cropped shot. SAME MODEL as the hero shot. Frame from just below bust to mid-thigh ONLY. No face visible. Model standing straight, slight left hip tilt. Both hands relaxed at sides, not touching swimsuit.

Swimsuit: ${p.title} in ${color}.

CRITICAL FOCUS AREA: Wide ruched high-waist panel sitting smoothly across the stomach with no rolling or folding. Tummy control band lying completely flat with no digging.

Fabric texture sharp and highly detailed. Skin texture natural and visible. Warm side light from left creates subtle shadow defining the waist shaping effect.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'back',
    label: 'Back View',
    order: 5,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Three-quarter back view. SAME MODEL as the hero shot. Model facing away from camera at roughly 160-degree angle. GAZE: Looking over right shoulder toward camera with slight playful smile — a glance back. Natural standing pose, weight evenly distributed.

Full body from shoulders to just below knees.
Swimsuit: ${p.title} in ${color}.
FOCUS: Back coverage — how bottom sits without riding up, waistband without rolling, straps flat at back. Fabric smooth, no bunching at lower back.

Same warm left-side lighting. Background soft bokeh.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'profile',
    label: 'Side Profile',
    order: 6,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Full side profile shot. SAME MODEL as the hero shot. Model facing camera-left, standing straight with slight natural arch in lower back. One hand lightly on hip. GAZE: Looking straight ahead in the direction she is facing — chin slightly lifted, profile visible. NOT looking at camera.

Full body from head to knees.
Swimsuit: ${p.title} in ${color}.
FOCUS: Silhouette — the shaping effect of the high-waist panel visible in profile. Smooth line from ribcage to hip.

Warm left-side lighting creates definition along the body's edge. Background soft bokeh.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'material',
    label: 'Material Close-up',
    order: 7,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Extreme close-up. Frame shows approximately 15×15cm area of fabric ON the model's body (stomach area or hip area). Skin visible at edges of fabric.

FOCUS: Fabric weave texture at macro level. Individual threads visible. Elastic waistband edge — clean finish, no fraying. Stitching line — even, consistent spacing. Fabric lying flat against skin without pilling or snagging.

Swimsuit: ${p.title} in ${color}.

Warm directional light from left creating texture shadows in fabric weave. Shallow depth of field — center of fabric tack sharp, edges gently soft.

This shot proves the product is high quality. Every stitch must look intentional.`,
  },
  {
    key: 'before_after',
    label: 'Before / After',
    order: 8,
    defaultOn: false,
    suggestedStyle: 'static_split',
    cost: 0.14,
    buildPrompt: (p, color) => `Split-screen before/after comparison in ONE single image. Clean white seamless studio backdrop. Flat even lighting. Same model in both halves. DRAMATIC visible difference between before and after.

LEFT HALF — BEFORE: Woman wearing a cheap, ill-fitting generic black one-piece swimsuit. CLEARLY VISIBLE problems: waistband rolled down and folded over, fabric bunching and wrinkling at hips, obvious muffin-top spilling over the waistband, straps digging into shoulders leaving red marks, fabric pulling and stretching across stomach showing every bump. Posture: hunched shoulders, arms awkwardly trying to cover stomach, uncomfortable frustrated expression, looking down avoiding camera. Unflattering harsh overhead lighting that emphasizes every flaw. She looks like she wants to hide.

RIGHT HALF — AFTER: SAME woman, DRAMATIC transformation. Standing tall, shoulders back, beaming confident smile, direct eye contact with camera. Wearing ${p.title} in ${color}. The difference is STRIKING: waistband completely flat and smooth, tummy visibly sculpted and held, fabric draping beautifully with zero bunching, straps sitting comfortably with no digging. She looks 10 pounds slimmer. Warm flattering golden-hour style lighting. Her whole body language screams confidence — hands on hips, chin up, radiating joy.

A clean thin vertical divider line separates the two halves. Both sides shot from head to mid-thigh with identical framing.

ADD TEXT LABELS: The word "BEFORE" in clean white sans-serif font (like Montserrat or Helvetica) at the top center of the LEFT half. The word "AFTER" in the same font at the top center of the RIGHT half. Text should be subtle, elegant, not too large — just clear enough to read. No other text, no arrows, no badges.${MODEL_CONSISTENCY}`,
  },
  {
    key: 'feature_callout',
    label: 'Feature Callout',
    order: 2,
    defaultOn: false,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Front-facing full body shot. Model standing straight, arms slightly away from body (not covering any part of the swimsuit). Neutral confident expression, direct eye contact with camera. Model fills approximately 75% of vertical frame. Head to mid-shin visible.

Swimsuit: ${p.title} in ${color}.
Every construction detail must be clearly visible and unobstructed: straps, neckline/bust construction, waistband, side details, overall fit and silhouette.

Clean, neutral studio-style background (warm beige or light gray). Even flat lighting from both sides — minimal shadows so all product details are equally visible.

Leave clear space on both sides of the model for callout labels in post-production.${MODEL_CONSISTENCY}`,
  },
];

// ─── STUDIO SHOTS — clean white studio, e-commerce product photography ───
const STUDIO_CONSISTENCY = `\n\nCRITICAL MODEL CONSISTENCY: The FIRST reference image shows the EXACT model to use — match her face, hair color and style, skin tone, body type, and age PRECISELY. She must be recognizable as the same person across ALL shots. Do NOT change the model. Clean white/light grey seamless studio backdrop. Flat even diffused lighting, zero harsh shadows. Professional e-commerce photography quality.`;

export const STUDIO_SHOTS = [
  {
    key: 'studio_hero',
    label: 'Hero Front',
    order: 1,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Full body front view in clean white studio. Model standing straight, slight weight shift to right hip creating natural S-curve. Both hands relaxed at sides or one hand lightly on hip. GAZE: Direct confident eye contact with camera. Neutral confident expression — not smiling, editorial fashion look. Head to bare feet visible, model fills ~70% of vertical frame.

Swimsuit: ${p.title} in ${color}.
${p.description ? `Product details: ${p.description}` : ''}
Fabric sitting smoothly on body, zero bunching, zero rolling at waistband. Product is the star — clean, sharp, every detail visible.

This is the ANCHOR image for the studio set. All subsequent shots must match this model exactly.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_34_front',
    label: '3/4 Angle',
    order: 2,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Three-quarter angle view in clean white studio. SAME MODEL as hero. Model positioned at 30-degree angle to camera, facing slightly left. One hand on hip, other relaxed. GAZE: Looking directly at camera with warm confident eye contact. Natural S-curve silhouette visible. Head to bare feet.

Swimsuit: ${p.title} in ${color}.
Shows side profile of the fit — how waistband sits, how top contours the body. Fabric smooth and flat.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_back',
    label: 'Back View',
    order: 3,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Full body back view in clean white studio. SAME MODEL. Standing straight, arms relaxed at sides. GAZE: Looking slightly over right shoulder. Head to bare feet visible.

Swimsuit: ${p.title} in ${color}.
Shows back construction: strap design, back coverage, waistband from behind. Every strap and seam clearly visible.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_back_34',
    label: 'Back 3/4',
    order: 4,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Three-quarter back view in clean white studio. SAME MODEL. Hands behind back or one hand touching opposite shoulder. GAZE: Looking over shoulder toward camera. Body at 30-degree angle showing back strap architecture.

Swimsuit: ${p.title} in ${color}.
Cross-back straps, back band detail, and rear fit clearly visible.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_arms_up',
    label: 'Arms Up',
    order: 5,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Full body front view, arms raised above head in clean white studio. SAME MODEL. Both arms up, hands touching or near hair. GAZE: Direct eye contact, confident expression. Shows underarm fit, how top moves with body, strap behavior when arms are raised.

Swimsuit: ${p.title} in ${color}.
Demonstrates freedom of movement — no riding up, no gaps, straps stay in place.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_detail_top',
    label: 'Detail: Top',
    order: 6,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Close-up crop from shoulders to waist in clean white studio. SAME MODEL. Front view showing top construction detail: twist/knot front detail, neckline shape, strap width, elastic trim pattern, fabric texture. Hands relaxed at sides. Sharp focus on product construction.

Swimsuit: ${p.title} in ${color}.
Individual thread weave visible on trim. Show the quality and craftsmanship.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_detail_back_straps',
    label: 'Detail: Back Straps',
    order: 7,
    defaultOn: false,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Close-up crop of upper back in clean white studio. SAME MODEL from behind. Focus on strap architecture — cross-back design, adjustable straps, how they connect to the band. Sharp macro-level detail. Back band with ethnic/striped elastic trim visible.

Swimsuit: ${p.title} in ${color}.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_detail_waistband',
    label: 'Detail: Waistband',
    order: 8,
    defaultOn: false,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Close-up crop of midsection in clean white studio. SAME MODEL. Model's hands pulling/stretching the waistband slightly outward to demonstrate elasticity and tummy control. Shows how the high-waist band sits flat, smooths the midsection, and how the elastic trim stretches.

Swimsuit: ${p.title} in ${color}.
Demonstrates the fit and stretch of the shapewear waistband.${STUDIO_CONSISTENCY}`,
  },
  {
    key: 'studio_detail_bottom_back',
    label: 'Detail: Bottom Back',
    order: 9,
    defaultOn: false,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Close-up crop from waist to mid-thigh, back view in clean white studio. SAME MODEL. Shows rear coverage, how the high-waist bottom fits from behind, seam construction, fabric smoothness. No face visible in this crop.

Swimsuit: ${p.title} in ${color}.${STUDIO_CONSISTENCY}`,
  },
];

// ─── CELESTE SHOTS — close-up studio with warm warm color backdrop (intimate apparel style) ───
// Inspired by celeste-dor.com — close-up framing (mid-chin to mid-torso), solid warm peach/cream
// backdrop, flat frontal softbox lighting, no outdoor, no horizon, no fashion drama.
const CELESTE_CONSISTENCY = `\n\nCRITICAL MODEL CONSISTENCY: The FIRST reference image shows the EXACT model to use — match her face, hair color and style, skin tone, body type, and age PRECISELY. She must be recognizable as the same person across ALL shots. Do NOT change the model. The product fabric color must read TRUE TO LIFE (NOT warm-shifted by the backdrop, NOT orange-cast, NOT washed out).`;

const CELESTE_BACKDROP_AND_LIGHT = `BACKDROP: Solid soft warm color backdrop — pale peach / dusty cream / soft beige (a single warm neutral that complements the product color WITHOUT competing). Very subtle gradient (slightly lighter at top). Heavily out of focus, gentle even tone. NO seamless paper edges, NO visible floor line, NO outdoor, NO props, NO objects, NO textures, NO patterns. The backdrop is purely supportive — a soft warm color wash.\n\nLIGHTING: Soft frontal softbox positioned directly in front of the model, max 10-15 degrees off-axis. FLAT, EVEN front fill across the entire body and garment. NO side shadows on the fabric, NO rim light, NO dimensional body modeling, NO directional shaping. The garment color reads UNIFORMLY across its entire surface so every detail (neckline, cut, fabric texture, seaming, waistband) is sharply visible. Subtle natural highlights on hair and skin from the front strobe.\n\nNEGATIVE: full body shot, legs, hips, knees, feet, horizon line, outdoor, beach, sand, ocean, sky, sunset, golden hour, lifestyle scene, props, furniture, side shadows on fabric, rim light, backlit model, dramatic lighting, theatrical lighting, fashion editorial drama, white seamless paper backdrop, gradient backdrop with visible bands, vibrant background colors, dimensional body shaping shadows, hot side / dark side, harsh shadows, blown out highlights, plastic skin, doll face, anatomical errors, extra fingers, distorted hands, watermarks, logos.`;

export const CELESTE_SHOTS = [
  {
    key: 'celeste_hero',
    label: 'Hero Close-up',
    order: 1,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP studio shot. Frame goes from mid-chin/mouth down to mid-torso/waist (NO legs, NO hips, NO horizon, NO outdoor). Model facing camera straight-on, body roughly square to the lens. Both shoulders visible, decolleté and full bra/swimsuit top visible. Mid-arms visible down to elbows. The product fills approximately 60-70% of the vertical frame. Vertical 4:5 aspect ratio.

Soft confident expression with gentle natural smile. GAZE: Looking directly at camera with warm warm eye contact. Catchlights in the eyes.

Swimsuit: ${p.title} in ${color}.
${p.description ? `Product details: ${p.description}` : ''}
Fabric sitting smoothly on body, zero bunching. Product is the focal point — clean, sharp, every detail crisp.

This is the ANCHOR image for the Celeste set. All subsequent shots must match this model and this backdrop exactly.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_34_angle',
    label: '3/4 Angle Close-up',
    order: 2,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP at three-quarter angle. SAME MODEL as hero. Body turned approximately 30 degrees to the left. Same crop — mid-chin/mouth down to mid-torso/waist. One hand resting gently at the collarbone or near the shoulder strap (coquette gesture). GAZE: Looking directly at camera with soft confident expression, gentle smile.

Swimsuit: ${p.title} in ${color}.
The slight angle shows side profile of the cup / neckline / strap how it sits on the body.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_hand_on_strap',
    label: 'Hand on Strap',
    order: 3,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP, hand-on-strap detail. SAME MODEL. Same crop — mid-chin down to mid-torso. One hand raised, fingers gently touching the shoulder strap or hovering near it (a soft natural coquette gesture, NOT pulling, NOT awkward). Other arm relaxed at side. GAZE: Looking slightly past camera with a soft introspective expression, OR looking down at the strap.

Swimsuit: ${p.title} in ${color}.
The hand draws attention to the strap construction, neckline cut, and shoulder fit.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_side_profile',
    label: 'Side Profile Close-up',
    order: 4,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP, side profile. SAME MODEL. Body fully turned to the side (90 degrees), but frame still cropped close — from mid-jaw down to mid-torso. Side of face visible (eye, cheek, jawline). Hair softly behind the shoulder. Arms relaxed at side. GAZE: Looking straight ahead in the direction she is facing — NOT at camera.

Swimsuit: ${p.title} in ${color}.
FOCUS: Side seam, side cup shape, how the neckline curves around the bust from profile.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_back_close',
    label: 'Back Close-up',
    order: 5,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP, back view. SAME MODEL facing away from camera. Frame goes from top of head/hair down to mid-back. One arm raised, hand lightly touching the back of the head or sweeping hair to the side. GAZE: Looking down or away (face not visible from camera angle).

Swimsuit: ${p.title} in ${color}.
FOCUS: Back band, clasp, cross-back straps, back-smoothing fit. The raised arm shows underarm fit and band stability.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_macro_fabric',
    label: 'Material Macro',
    order: 6,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `EXTREME close-up macro shot of the fabric ON the model's body. Frame shows approximately 20×25cm area — focused on the neckline edge and upper cup of the bra/swimsuit. Tiny portion of skin visible at edges of fabric (collarbone, decolleté edge). Face NOT visible in this crop (frame is below the chin).

Swimsuit: ${p.title} in ${color}.
FOCUS: Fabric weave texture at macro level. Individual stitch line along the neckline edge. Elastic trim if any. Tack sharp on the fabric, very shallow depth of field on the edges.

This shot proves the product is high quality. Every stitch must look intentional.

${CELESTE_BACKDROP_AND_LIGHT}`,
  },
  {
    key: 'celeste_underbust',
    label: 'Underbust Detail',
    order: 7,
    defaultOn: true,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP, underbust detail. SAME MODEL. Frame goes from just below the chin down to upper hip/waist. Slight 15-degree turn for visual interest. Hands relaxed at sides or one hand gently resting at the hip below the bra band. GAZE: Soft looking down OR looking at camera with soft confident expression.

Swimsuit: ${p.title} in ${color}.
FOCUS: Underbust band, where the bra/swimsuit meets the torso, the band's smoothing effect. Skin around the band visible to show fit (no digging, no rolling).

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
  {
    key: 'celeste_feature_callout',
    label: 'Feature Callout',
    order: 8,
    defaultOn: false,
    suggestedStyle: 'product_shot',
    cost: 0.14,
    buildPrompt: (p, color) => `Cropped CLOSE-UP, hero front view with feature callout space. SAME MODEL. Same crop as hero — mid-chin down to mid-torso. Body straight, both shoulders square, hands relaxed. GAZE: Direct confident eye contact with camera, soft natural smile. Model positioned slightly OFF-CENTER (shifted to the right of the frame) to leave clear NEGATIVE SPACE on the LEFT side of the frame for text callouts in post-production.

Swimsuit: ${p.title} in ${color}.
The product is fully visible and unobstructed. Construction details (neckline, straps, cup shape, fabric) are sharp and crisp.

NO text, NO callouts, NO arrows, NO badges, NO labels in the image itself — just leave clean negative space on the left side suitable for text overlay added later in post.

${CELESTE_BACKDROP_AND_LIGHT}${CELESTE_CONSISTENCY}`,
  },
];

export function buildColorVariantPrompt(product, color) {
  return `Three-quarter angle full body shot. SAME MODEL as the hero shot — IDENTICAL face, hair, skin tone, body type. IDENTICAL POSE — 30-degree angle to left, weight on right hip, relaxed arms. Model fills 70% of frame.

Swimsuit: ${product.title} in ${color}.

Fabric smooth and sitting correctly on body. Same lighting as Hero Shot. Background identical framing.
This image MUST look like it was shot in the same session as the Hero image — same woman, same setting, only the color changes.${MODEL_CONSISTENCY}`;
}

export function buildUGCPrompt(product, color) {
  return `STYLE OVERRIDE — this image intentionally breaks the polished look:

Shot on iPhone 15 Pro. Slightly warm color cast. Natural daylight, not styled. Minor lens flare acceptable. Composition slightly off-center (intentional).

Casual relaxed expression — mid-laugh or looking away from camera. Hair messy/natural (wind, water). No professional makeup. Visible tan lines acceptable.

Location: REAL environment — backyard pool with visible deck furniture, OR busy public beach with other people slightly blurred in background, OR hotel balcony.

Candid three-quarter shot. Model not perfectly posed — caught mid-moment. Phone-quality depth of field.

Swimsuit: ${product.title} in ${color}.
Product visible and recognizable but this is NOT a fashion photo.
This is "my friend took this pic of me on vacation" energy.

NO studio lighting. NO perfect skin. NO fashion posing.`;
}

export const DEFAULT_COST_PER_IMAGE = 0.14;

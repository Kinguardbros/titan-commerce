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
    buildPrompt: (p, color) => `Split-screen before/after comparison in ONE single image. Clean white seamless studio backdrop. Flat even lighting. Same model in both halves.

LEFT HALF — BEFORE: Woman wearing a generic plain black one-piece swimsuit (no branding, basic). Visible fit problems: waistband rolling down, fabric bunching at hips, slight muffin-top effect. Posture: shoulders slightly forward, stomach relaxed, subtle discomfort. NOT exaggerated or mocking.

RIGHT HALF — AFTER: Same woman, same framing, same backdrop. Upright confident posture, shoulders back, slight warm smile. Wearing ${p.title} in ${color}. Swimsuit sitting perfectly: waistband completely flat, no bunching, fabric smooth across stomach and thighs, body supported and shaped NOT squeezed. Natural skin texture visible.

A clean thin vertical divider line separates the two halves. Both sides shot from head to mid-thigh with identical framing. NO text, NO labels, NO arrows — just the two images side by side.${MODEL_CONSISTENCY}`,
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

// Product Catalog v8 — color-class-conditional lighting variant of v7. The LIGHTING and
// DO NOT blocks are templated by color class (print / dark / solid) so dark fabrics and
// solid pastels render with subtle dimensional shading instead of flat silhouettes.

export const V8_PROMPT_BODY_TEMPLATE = `Editorial product photograph for a premium swimwear e-commerce catalog. Vertical 4:5 aspect ratio.

WARDROBE — THE SWIMSUIT (PRIMARY SUBJECT):
The garment is the focal point of the image — the brightest, sharpest, most defined element in the frame. The fabric color reads TRUE TO LIFE — uniformly across the entire surface (not muddy, not washed out, not over-saturated). Every construction detail must be clearly visible: neckline, cut, waistband, seams, ruching, twist details, fabric texture, color saturation. The viewer should be able to identify the exact color, silhouette, and key features in less than 1 second.

POSE & EXPRESSION:
She is standing facing the camera roughly square to the lens, with a slight 5-15 degree turn. Weight gently shifted to one leg, creating a relaxed hip line. Shoulders back, posture confident but not stiff. Arms hang naturally at the sides with relaxed hands. Chin neutral, gaze directly at camera with grounded ease. Expression warm and genuine — a soft natural smile that reaches her eyes (not sultry, not posed, not overly bright).

SETTING:
An open beach during the SOFT WARM AFTERGLOW of late afternoon / early evening — the sun is LOW or just BELOW the horizon (NOT visible in the frame, NO solar disk, NO direct sunbeams in frame, NO lens flare) but the sky and atmosphere hold a clearly VISIBLE warm tint. Warm cream-to-beige sand in the foreground, softly out of focus with visible warm tone. Soft blue-grey ocean waves visible behind, softly out of focus with creamy bokeh and natural motion (NOT vibrant turquoise, but clearly blue, visible color presence). Warm soft sky in the upper third — beige-to-soft-peach gradient blending into pale warm blue, gentle natural saturation, clearly visible color (NOT washed-out, NOT dim, NOT vivid). Horizon line visible as a softly blurred line where warm sky meets soft blue ocean.

LIGHTING:
__V8_LIGHTING_BLOCK__

EXPOSURE:
Balanced exposure — the subject is exposed correctly and clearly visible, the background is also well-exposed and clearly visible, with only a SUBTLE difference (subject just slightly brighter and sharper than the background through focus and frontal lighting). The image reads as a natural late-afternoon beach shoot — both subject and background well-lit, but the subject is the clear focal point through SHARPNESS and POSITION (center, sharp focus, soft frontal lighting), not through dramatic exposure separation. NOT silhouetted, NOT backlit, NOT a dim background. The garment color reads cleanly against the warm visible afterglow background.

COMPOSITION & FRAMING:
Vertical 4:5. Subject positioned center frame horizontally, occupying the central 55-65 percent of the vertical frame. Generous negative space above the head (sky, soft background) for potential text overlay. Frame ALWAYS extends from the top of the head down through MID-THIGH ONLY — this is a fixed crop regardless of garment length. If the garment is longer than mid-thigh (e.g. maxi skirt, long dress, flowing cover-up), the garment is CROPPED by the bottom of the frame at mid-thigh — the rest of the garment continues out of frame, NOT shown. NEVER widen the frame to fit the entire garment. NEVER zoom out. The frame stays mid-thigh ALWAYS. Subject is tack sharp and in clear focus. Background softly out of focus with creamy bokeh — moderate shallow depth of field approximately f/2.5 to f/3.5 quality. Wave texture and horizon line are visible but softly blurred. Background details are gently out of focus but clearly readable as a beach scene.

PHOTOGRAPHIC STYLE:
Shot as if captured on a Hasselblad H6D-100c medium format camera, 85mm lens, f/2.8 aperture. Professional location editorial photography combining natural-feeling soft strobe lighting with warm late-afternoon environment. Photographic references: Andie Swim, Hermoza, Aerie, Athleta, J.Crew, Summersalt swimwear catalog campaigns shot in late golden hour with natural soft lighting. Premium accessible aesthetic — luxurious but not intimidating, polished and clean, natural-feeling.

COLOR GRADING:
WARM-AMBIENT NATURAL color grading with NEUTRAL subject — the BACKGROUND (sky, sand, ambient light) reads as a CLEARLY VISIBLE warm afterglow with natural saturation (warm beige-peach sky, warm cream sand, soft blue ocean — visible color, NOT washed-out, NOT muted, NOT dim). The garment reads in TRUE-TO-LIFE neutral color (NOT warm-shifted, NOT orange-cast, NOT washed-out). Sand reads as warm cream-beige with visible warm tone. Ocean reads as soft natural blue with subtle teal hint (clearly blue, naturally saturated, NOT vivid turquoise, NOT dim grey). Sky reads as warm beige-peach gradient blending into soft warm pale blue (clearly visible warm tone, gentle natural saturation). NO heavy contrast, NO HDR look, NO over-sharpening, NO oversaturated tropical postcard colors, NO Instagram filter aesthetic. Saturation is NATURAL late-afternoon level — visible and warm but not artificial.

QUALITY:
Ultra-realistic, photorealistic, professional editorial image quality. The image must look like a finished published photograph from a premium swimwear brand campaign — not an AI generation, not a stock photo, not an amateur shoot. The garment fabric must render with realistic material properties matching the actual product specifications.

DO NOT GENERATE:
- __V8_DO_NOT__
- Any visible photography lighting equipment (softboxes, reflectors, umbrellas, light stands, scrims, V-flats, cables, tripods, monitors, camera equipment)
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
- Plastic, over-smoothed, airbrushed unrealistic appearance
- Generic stock-photo facial features
- Anatomical errors, extra fingers, distorted hands, asymmetrical eyes, melted features
- Other people in the frame
- Beach clutter (umbrellas, chairs, towels, bags, debris, palm trees, boats)
- Visible watermarks, logos, brand markings, text, signatures
- Sunglasses on the subject
- A crowded, overly busy background
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
- Warm orange / yellow / gold color cast on the subject — neutral subject, warm visible background
- Instagram or VSCO filter aesthetics
- A natural "candid beach photo" feel — must read as professional catalog studio shoot on location
- Dim or heavily muted background colors — background MUST be a clearly visible warm afterglow (not washed-out, not dim)
- Dramatically dark or underexposed background — exposure should be balanced (subject only slightly brighter)
- Sharp in-focus background — background must be softly out of focus (but clearly visible)
- Crisp wave edges or visible foam detail — waves should be softly blurred with creamy bokeh
- Bright midday harsh daylight — this is LATE AFTERNOON / SOFT AFTERGLOW (warm visible tone)
- Dramatic sunset colors (vivid orange, vivid pink, vivid red sky) — sky should be soft warm beige-peach
- Vivid bright blue sky — sky should have visible warm tone (beige-peach blending into pale warm blue)`;

export const V8_LIGHTING_PRINT = `Natural-looking commercial catalog lighting — soft frontal softbox positioned DIRECTLY IN FRONT of the subject (max 10-15 degrees off-axis), producing essentially FLAT FRONTAL ILLUMINATION. The light is clean and well-defined but with a SOFTER, MORE NATURAL feel — the subject is clearly lit but the lighting blends naturally with the warm ambient (not dramatic punchy strobe). Subtle catchlights in the eyes. NO directional shaping, NO side-light, NO rim light, NO backlight, NO shadows that wrap around the subject to the side. The lighting is even and commercial — designed to show the swimsuit and silhouette uniformly, not to shape the subject for fashion drama.`;

export const V8_LIGHTING_DARK = ({ fillPct, angleDeg }) => `Natural-looking commercial catalog lighting — soft frontal softbox positioned DIRECTLY IN FRONT of the subject (max 10-15 degrees off-axis) as the primary light source. To reveal the construction detail of the DARK fabric, a SECONDARY soft fill light is positioned slightly above and ${angleDeg} degrees to camera-left, with intensity approximately ${fillPct}% of the main frontal light. This subtle off-axis fill produces gentle gradient shading across the dark fabric — slightly brighter on the camera-left side, slightly deeper on the camera-right side — revealing the three-dimensional form of the garment. Subtle catchlights in the eyes. The dark fabric shows clear TONAL VARIATION across its surface (visible mid-tones, deeper folds, subtle highlights on raised seams and ruched gathers) — NOT a uniform flat black. NO rim light, NO backlight, NO dramatic side-shaping. The fill is gentle and frontal-offset only.`;

export const V8_LIGHTING_SOLID = ({ fillPct, angleDeg }) => `Natural-looking commercial catalog lighting — soft frontal softbox positioned DIRECTLY IN FRONT of the subject (max 10-15 degrees off-axis) as the primary light source. To reveal subtle dimension in the SOLID-color fabric, a VERY GENTLE secondary fill light is positioned slightly above and ${angleDeg} degrees to camera-left, with intensity approximately ${fillPct}% of the main frontal light. This barely perceptible off-axis fill produces subtle gradient shading across the fabric — revealing the three-dimensional form of the garment, fabric drape (under bust, at waist), and construction detail (seams, ruching, straps). The dimensional shading MUST NOT shift the fabric color — hue remains constant across the surface, only perceived brightness varies subtly with form. Lit areas are NOT a brighter/whiter version, shadow areas are NOT a darker/muddier version. NO rim light, NO backlight, NO dramatic side-shaping. The fill is gentle and frontal-offset only.`;

export const V8_DO_NOT_PRINT = "- Multiple distinct directional light sources (one unified front-lit look from the strobe)\n- NO directional shaping, NO side-light, NO rim light, NO backlight";

export const V8_DO_NOT_DARK = "- Dramatic directional side-shaping or hot-side/dark-side lighting\n- Rim light, hair light, or backlight on the garment\n- Garment rendered as flat uniform black silhouette\n- Loss of seam, strap, neckline, or construction detail in the darkness\n- Garment looks like a 2D cutout shape pasted onto the model\n- Wet, plastic, latex, or vinyl appearance on the dark fabric";

export const V8_DO_NOT_SOLID = "- Dramatic directional side-shaping or hot-side/dark-side lighting\n- Rim light, hair light, or backlight on the garment\n- Garment rendered as flat uniform color shape with no dimension\n- Lit areas washed out brighter than the true color, or shadow areas muddied darker\n- Color shift between lit/shadow areas (hue must remain constant)\n- Wet, plastic, latex, or vinyl appearance on the fabric";

export const DARK_COLORS = ['black', 'navy', 'charcoal', 'midnight', 'onyx', 'jet', 'noir', 'deep brown', 'espresso', 'forest green', 'deep emerald', 'dark green', 'wine', 'burgundy', 'oxblood', 'plum', 'eggplant'];

export const PRINT_KEYWORDS = ['leopard', 'cheetah', 'zebra', 'snake', 'python', 'tiger', 'floral', 'flower', 'paisley', 'tropical', 'palm', 'stripe', 'striped', 'checker', 'plaid', 'gingham', 'polka', 'dot', 'geometric', 'abstract', 'tie-dye', 'tiedye', 'print', 'pattern', 'patterned', 'multicolor', 'multi-color', 'color-block', 'colorblock', 'ombre', 'gradient'];

export const SOLID_COLOR_KEYWORDS = ['white', 'cream', 'ivory', 'pearl', 'champagne', 'pink', 'rose', 'blush', 'coral', 'salmon', 'red', 'crimson', 'cherry', 'scarlet', 'orange', 'peach', 'apricot', 'terracotta', 'yellow', 'mustard', 'gold', 'honey', 'green', 'sage', 'mint', 'olive', 'lime', 'blue', 'teal', 'turquoise', 'aqua', 'sky', 'cobalt', 'royal', 'purple', 'lavender', 'lilac', 'violet', 'mauve', 'gray', 'grey', 'silver', 'taupe', 'beige', 'tan', 'nude', 'brown', 'mocha', 'caramel', 'chocolate', 'rust'];

export const V8_FILL_INTENSITY_MAP = {
  light:  { dark: 20, solid: 12, angle: 15 },
  medium: { dark: 30, solid: 20, angle: 25 },
  strong: { dark: 45, solid: 30, angle: 30 },
};

export function detectV8ColorClass(product, product_color) {
  if (product_color) {
    const v = product_color.toLowerCase();
    if (PRINT_KEYWORDS.some(k => v.includes(k))) return 'print';
    if (DARK_COLORS.some(c => v.includes(c))) return 'dark';
    return 'solid';
  }

  const haystack = [
    product?.title || '',
    product?.product_type || '',
    Array.isArray(product?.tags) ? product.tags.join(' ') : (product?.tags || ''),
  ].join(' ').toLowerCase();

  // Word-boundary match in the title fallback path to avoid substring collisions
  // (e.g. "tan" inside "Tankini", "rose" inside "rosemary").
  const hasWord = (kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);

  if (PRINT_KEYWORDS.some(hasWord)) return 'print';
  if (DARK_COLORS.some(hasWord)) return 'dark';
  if (SOLID_COLOR_KEYWORDS.some(hasWord)) return 'solid';

  return 'print';
}

export function buildV8LightingBlock(colorClass, fillIntensity) {
  const cfg = V8_FILL_INTENSITY_MAP[fillIntensity] || V8_FILL_INTENSITY_MAP.medium;
  if (colorClass === 'dark') return V8_LIGHTING_DARK({ fillPct: cfg.dark, angleDeg: cfg.angle });
  if (colorClass === 'solid') return V8_LIGHTING_SOLID({ fillPct: cfg.solid, angleDeg: cfg.angle });
  return V8_LIGHTING_PRINT;
}

export function buildV8DoNotBlock(colorClass) {
  if (colorClass === 'dark') return V8_DO_NOT_DARK;
  if (colorClass === 'solid') return V8_DO_NOT_SOLID;
  return V8_DO_NOT_PRINT;
}

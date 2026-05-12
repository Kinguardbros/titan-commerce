// Beach-background prompts for Product Catalog v3 step 2 (Ideogram v3 replace-background).
// The model gets a finished clean-studio shot of the model in the swimsuit; this prompt tells
// it to swap ONLY the background — keep the subject, pose, garment, and the lighting on her
// exactly as they are. Keys match the CATALOG_BEACH_SCENES ids in CreativeStudio.jsx.
const SCENES = {
  sunny: 'Replace the plain studio background with a real sandy beach: ocean with gentle waves on one side, soft dry sand with a few dune grasses and a low dune line, bright blue sky with a few soft white clouds, light haze at the horizon. Bright natural daylight from the front, matching the studio lighting already on the model. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright. The background holds full detail — NOT blown out to white, NOT washed out, NOT a hazy bright wash.',
  golden: 'Replace the plain studio background with a real beach at golden hour: a warm low sun behind the camera, soft golden light, calm sea, dry sand with dune grass catching the warm light, soft warm sky. The warm light gently grades the scene — keep it natural, not a heavy orange filter, not overexposed. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright.',
  dune: 'Replace the plain studio background with a real beach behind a sand dune: tall beach grass on both sides framing the model, soft dry sand, glimpses of ocean and a bright sky beyond, bright midday daylight from the front. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright; the background holds full detail, not blown out.',
  cove: 'Replace the plain studio background with a quiet rocky cove: turquoise water, smooth pebbles and sand, a soft cliff face in the bokeh, bright natural daylight from the front. Background softly out of focus; the model stays tack sharp and EXACTLY as she is — do not change her face, hair, body, pose, the swimsuit, or the lighting on her. Keep her fully and evenly lit and bright; the background holds full detail, not blown out.',
};

export function buildV3BeachPrompt(sceneKey) {
  return SCENES[sceneKey] || SCENES.sunny;
}

import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { generateFal } from '../fal.js';
import { generateImage } from '../higgsfield.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET: list persona avatars for a store
export async function persona_avatars(req, res) {
  const { store_id } = req.query;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const { data, error } = await supabase
    .from('persona_avatars')
    .select('*')
    .eq('store_id', store_id)
    .order('persona_name');

  if (error) throw error;
  return res.status(200).json(data || []);
}

// POST: generate 4 avatar variants via fal.ai
export async function generate_avatar(req, res) {
  const { store_id, persona_name, description } = req.body;
  if (!store_id || !persona_name || !description) {
    return res.status(400).json({ error: 'store_id, persona_name, and description required' });
  }

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const storeName = store.slug || store.name;

  // Load full persona details from audience-personas skill
  let fullDescription = description;
  if (!description.startsWith('Professional') && !description.startsWith('Full body')) {
    const { data: skill } = await supabase.from('store_skills').select('content')
      .eq('store_id', store_id).eq('skill_type', 'audience-personas').is('product_name', null).single();
    if (skill?.content) {
      // Extract full section for this persona
      const regex = new RegExp(`###[^#]*?${persona_name}[\\s\\S]*?(?=###|$)`, 'i');
      const match = skill.content.match(regex);
      if (match) fullDescription = match[0].trim();
    }
  }

  // Extract visual attributes from persona — age + body details (skip emotions, quotes)
  const ageMatch = fullDescription.match(/Age[:\s]*(\d+)/i);
  const age = ageMatch ? ageMatch[1] : '40';
  const detailsMatch = fullDescription.match(/Specific details[:\s]*([^\n]+)/i);
  const bodyDetails = detailsMatch
    ? detailsMatch[1].replace(/['"]/g, '').replace(/,\s*avoiding.*$/i, '').trim()
    : 'natural curvy body type';

  // Deterministic visual markers per persona — same name always produces same look.
  // Hash the lowercased name to indices across hair/eyes/face/skin/build palettes so
  // different personas never collide into the same generic face.
  const nameHash = (() => {
    let h = 0;
    const s = (persona_name || '').toLowerCase();
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  })();
  const pick = (arr) => arr[nameHash % arr.length];
  const pickOffset = (arr, offset) => arr[(nameHash + offset) % arr.length];

  const hair = pick([
    'short brunette bob with natural texture',
    'long dark blonde waves past the shoulders',
    'shoulder-length auburn hair',
    'straight black hair tied in a loose ponytail',
    'medium-length chestnut brown hair',
    'wavy honey-blonde hair tucked behind ears',
    'short ash-brown pixie cut',
    'long straight light brown hair',
  ]);
  const eyes = pickOffset(['blue eyes', 'warm brown eyes', 'green eyes', 'hazel eyes', 'dark brown eyes', 'grey-green eyes'], 1);
  const faceShape = pickOffset(['oval face', 'round face with soft cheeks', 'heart-shaped face', 'slightly angular face'], 2);
  const skin = pickOffset([
    'fair skin with light freckles across the nose',
    'olive Mediterranean skin tone',
    'warm tan skin',
    'pale porcelain skin',
    'medium neutral skin tone with natural warmth',
    'lightly sun-weathered skin',
  ], 3);
  const build = pickOffset([
    'average slim build',
    'curvy natural build with soft midsection',
    'athletic build with broader shoulders',
    'petite short frame',
    'tall and slender build',
    'average build with wider hips',
  ], 4);
  const appearance = `Appearance: ${hair}, ${eyes}, ${faceShape}, ${skin}, ${build}.`;

  const ageNum = parseInt(age, 10);
  const faceDescriptor = ageNum >= 50
    ? "Her face shows clear maturity: visible fine lines and crow's feet, some grey hair strands, slightly softer jawline, mature skin texture with pores and natural uneven tone, age spots. Clearly a woman in her 50s or 60s."
    : ageNum >= 40
    ? "Her face shows mid-life maturity: visible fine lines around eyes and mouth, skin pores, slightly uneven skin tone, natural skin texture, fully mature facial structure. Clearly a woman in her 40s — not a 20-something but also not elderly."
    : ageNum >= 30
    ? "Her face shows early adult maturity: smooth skin overall, first subtle fine lines starting to appear around the eyes when smiling, healthy complexion, fully adult facial structure but still youthful. No deep wrinkles, no grey hair. She clearly looks in her 30s, not 40s."
    : "Her face shows youthful features: smooth skin, even complexion, healthy glow, no visible wrinkles. Some natural skin texture with pores, maybe slight blemishes — but a clearly young adult face.";

  // Stretch marks only for personas with mom/pregnancy context; otherwise skip to avoid aging bias
  const isMomPersona = /mom|pregnancy|pregnant|post.partum/i.test(bodyDetails);
  const bodyImperfections = isMomPersona
    ? "pores, freckles, uneven tone, stretch marks, natural body imperfections"
    : "pores, freckles, uneven tone, natural body imperfections";

  const prompt = fullDescription.startsWith('Professional') || fullDescription.startsWith('Full body')
    ? fullDescription
    : `Full body reference photograph of a ${age}-year-old woman standing in front of a plain wall at home. Natural amateur photo, not a professional shoot. ${appearance} ${bodyDetails}. FULL BODY shot — head to bare feet fully visible, feet at the bottom of the frame. Do NOT crop at the knees or waist. She is a regular ${age}-year-old woman, neither a model nor particularly photogenic. Wearing plain nude/skin-toned matching underwear set — simple nude bra and nude briefs, no patterns, no lace, no decorations, matching her natural skin tone. Bare feet, no shoes. Arms relaxed at sides. Neutral indoor lighting, slightly uneven, like a normal hallway or bedroom. Plain beige or off-white wall background, no props, no furniture. ${faceDescriptor} No makeup or minimal natural makeup, no styled hair, no posed smile. Subtly neutral expression — she is not posing, just standing for a reference photo. Photograph shows imperfect real skin texture with ${bodyImperfections}. Snapshot quality, plain and unremarkable. Do NOT make her look like a model, influencer, swimsuit catalog, or professional photo. FINAL CHECK: The woman in this photograph is exactly ${age} years old — not older, not younger.`;

  // Check if persona already has a reference — use Nano Banana edit with it, otherwise text-to-image
  const { data: existingAvatar } = await supabase.from('persona_avatars').select('reference_url')
    .eq('store_id', store_id).eq('persona_name', persona_name).single();

  const hasReference = existingAvatar?.reference_url;
  const imageUrl = hasReference ? existingAvatar.reference_url : undefined;

  // 1. Front view FIRST (anchor) — Nano Banana 2 for more natural, less plastic output than Flux Schnell
  // Note: Flux Kontext Pro only accepts these ratios: 21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21
  const frontModel = hasReference ? 'fal-ai/nano-banana-2/edit' : 'fal-ai/nano-banana-2';
  const frontResult = await generateFal({
    model: frontModel,
    prompt: `${prompt} Front view, facing camera directly.`,
    imageUrl,
    numImages: 1,
    aspectRatio: '9:16',
  });

  // Download front image and upload to Storage for permanent URL
  const frontResp = await fetch(frontResult.url);
  const frontBuf = Buffer.from(await frontResp.arrayBuffer());
  const frontPath = `${storeName}/Avatars/${persona_name}/front_${Date.now()}.jpg`;
  await supabase.storage.from('store-docs').upload(frontPath, frontBuf, { contentType: 'image/jpeg', upsert: true });
  const { data: frontUrlData } = supabase.storage.from('store-docs').getPublicUrl(frontPath);
  const frontUrl = frontUrlData?.publicUrl;

  // 2. Remaining 3 angles PARALLEL — use Flux Kontext Pro for identity preservation
  const remainingAngles = [
    'Show the EXACT SAME woman from the reference image, now from the back. Back view, facing away from camera, looking over right shoulder. Same hair, same skin, same body, same clothing. FULL BODY shot from head to bare feet — entire body visible with feet at the bottom of the frame. Do NOT crop at the knees.',
    'Show the EXACT SAME woman from the reference image, now from the left side. Left profile view. Same hair, same skin, same body, same clothing. FULL BODY shot from head to bare feet — entire body visible with feet at the bottom of the frame. Do NOT crop at the knees.',
    'Show the EXACT SAME woman from the reference image, now from the right side. Right profile view. Same hair, same skin, same body, same clothing. FULL BODY shot from head to bare feet — entire body visible with feet at the bottom of the frame. Do NOT crop at the knees.',
  ];
  const remainingSettled = await Promise.allSettled(
    remainingAngles.map(anglePrompt =>
      generateFal({
        model: 'fal-ai/flux-pro/kontext',
        prompt: anglePrompt,
        imageUrl: frontUrl,
        numImages: 1,
        aspectRatio: '9:16',
      })
    )
  );
  const remainingResults = remainingSettled
    .filter((r) => r.status === 'fulfilled' && r.value?.url)
    .map((r) => r.value);
  remainingSettled
    .filter((r) => r.status === 'rejected')
    .forEach((r, i) => console.error(`[avatar] angle ${i} generation failed:`, r.reason?.message || r.reason));

  const results = [frontResult, ...remainingResults];

  // Download from fal.ai (temporary) and re-upload to Supabase Storage.
  // Skip any variant whose fetch or upload fails — don't push a broken URL into DB.
  const permanentUrls = [];
  for (let i = 0; i < results.length; i++) {
    const falUrl = results[i].url;
    try {
      const resp = await fetch(falUrl);
      if (!resp.ok) throw new Error(`fal download ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000) throw new Error(`buffer too small (${buf.length} bytes)`);

      const path = `${storeName}/Avatars/${persona_name}/gen_${Date.now()}_${i}.jpg`;
      const { error: uploadErr } = await supabase.storage.from('store-docs').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) throw new Error(`storage upload: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
      if (urlData?.publicUrl) permanentUrls.push(urlData.publicUrl);
    } catch (err) {
      console.error(`[avatar] variant ${i} copy failed:`, err.message);
    }
  }

  // Upsert: append new variants to existing record or create new one
  const { data: existing } = await supabase
    .from('persona_avatars')
    .select('id, variants')
    .eq('store_id', store_id)
    .eq('persona_name', persona_name)
    .single();

  const allVariants = [...(existing?.variants || []), ...permanentUrls];

  if (existing) {
    await supabase
      .from('persona_avatars')
      .update({ variants: allVariants })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('persona_avatars')
      .insert({ store_id, persona_name, description, variants: allVariants });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AVATAR', level: 'info', store_id,
    message: `Generated 4 avatar variants for ${persona_name}`,
  });

  return res.status(200).json({ variants: permanentUrls });
}

// POST: upload a user-provided avatar image
export async function upload_avatar(req, res) {
  const { store_id, persona_name, base64, media_type } = req.body;
  if (!store_id || !persona_name || !base64) {
    return res.status(400).json({ error: 'store_id, persona_name, and base64 required' });
  }

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const storeName = store.slug || store.name;
  const ext = (media_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const path = `${storeName}/Avatars/${persona_name}/upload_${Date.now()}.${ext}`;
  const buf = Buffer.from(base64, 'base64');

  await supabase.storage.from('store-docs').upload(path, buf, { contentType, upsert: true });
  const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
  const publicUrl = urlData?.publicUrl;

  // Upsert: set as reference and append to variants
  const { data: existing } = await supabase
    .from('persona_avatars')
    .select('id, variants')
    .eq('store_id', store_id)
    .eq('persona_name', persona_name)
    .single();

  const allVariants = [...(existing?.variants || []), publicUrl];

  if (existing) {
    await supabase
      .from('persona_avatars')
      .update({ reference_url: publicUrl, variants: allVariants })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('persona_avatars')
      .insert({ store_id, persona_name, reference_url: publicUrl, variants: allVariants });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AVATAR', level: 'info', store_id,
    message: `Uploaded avatar reference for ${persona_name}`,
  });

  return res.status(200).json({ reference_url: publicUrl, persona_name });
}

// POST: set a specific variant as the reference avatar
export async function set_avatar_reference(req, res) {
  const { store_id, persona_name, url } = req.body;
  if (!store_id || !persona_name || !url) {
    return res.status(400).json({ error: 'store_id, persona_name, and url required' });
  }

  let permanentUrl = url;

  // If URL is a temporary fal.ai URL, download and re-upload to Supabase Storage
  if (url.includes('fal.run') || url.includes('fal.ai')) {
    const store = await getStore(store_id);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const storeName = store.slug || store.name;
    const resp = await fetch(url);
    if (!resp.ok) return res.status(400).json({ error: 'Failed to download image from temporary URL' });
    const buf = Buffer.from(await resp.arrayBuffer());
    const path = `${storeName}/Avatars/${persona_name}/ref_${Date.now()}.jpg`;
    await supabase.storage.from('store-docs').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
    permanentUrl = urlData?.publicUrl;
  }

  const { error } = await supabase
    .from('persona_avatars')
    .update({ reference_url: permanentUrl })
    .eq('store_id', store_id)
    .eq('persona_name', persona_name);

  if (error) throw error;
  return res.status(200).json({ reference_url: permanentUrl });
}

// POST: delete a persona avatar and its storage files
export async function delete_avatar(req, res) {
  const { store_id, persona_name } = req.body;
  if (!store_id || !persona_name) {
    return res.status(400).json({ error: 'store_id and persona_name required' });
  }

  const { error } = await supabase
    .from('persona_avatars')
    .delete()
    .eq('store_id', store_id)
    .eq('persona_name', persona_name);

  if (error) throw error;

  // Try to clean up storage files (best-effort)
  const store = await getStore(store_id);
  if (store) {
    const storeName = store.slug || store.name;
    const prefix = `${storeName}/Avatars/${persona_name}/`;
    try {
      const { data: files } = await supabase.storage.from('store-docs').list(prefix.replace(/\/$/, ''));
      if (files?.length) {
        const paths = files.map((f) => `${prefix}${f.name}`);
        await supabase.storage.from('store-docs').remove(paths);
      }
    } catch (storageErr) {
      console.warn('[delete_avatar] Storage cleanup failed:', { store_id, persona_name, error: storageErr.message });
    }
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AVATAR', level: 'info', store_id,
    message: `Deleted avatar persona ${persona_name}`,
  });

  return res.status(200).json({ deleted: true });
}

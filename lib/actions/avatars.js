import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { generateFal, submitFalJob, checkFalJob } from '../fal.js';
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
  const weightMatch = fullDescription.match(/Weight[:\s]*(\d+)\s*kg/i);
  const weight = weightMatch ? weightMatch[1] : null;
  const detailsMatch = fullDescription.match(/Specific details[:\s]*([^\n]+)/i);
  const bodyDetails = detailsMatch
    ? detailsMatch[1].replace(/['"]/g, '').replace(/,\s*avoiding.*$/i, '').trim()
    : 'natural curvy body type';
  const weightDesc = weight ? ` She weighs approximately ${weight} kg — her body shape and proportions MUST clearly reflect this weight for a woman of average height (165 cm).` : '';

  // Deterministic visual markers per persona — same name always produces same look.
  // Hash the lowercased name to indices across hair/eyes/face/skin/build palettes so
  // different personas never collide into the same generic face.
  // Deterministic visual markers per persona — prime-offset hash for maximum diversity.
  const nameHash = (() => {
    let h = 0;
    const s = (persona_name || '').toLowerCase();
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  })();
  const primes = [1, 7, 13, 19, 29, 37, 43];
  const pick = (arr, dim) => arr[(nameHash * primes[dim]) % arr.length];

  const hair = pick([
    'short brunette bob with natural texture',
    'long platinum blonde straight hair',
    'shoulder-length auburn wavy hair',
    'straight black hair tied in a loose ponytail',
    'tight dark curly afro-textured hair',
    'wavy honey-blonde hair tucked behind ears',
    'short ash-brown pixie cut',
    'long red curly hair',
    'medium-length silver-grey hair',
    'braided dark brown hair past shoulders',
    'sandy blonde beach waves',
    'jet black sleek chin-length bob',
  ], 0);
  const eyes = pick(['bright blue eyes', 'warm brown eyes', 'green eyes', 'hazel eyes', 'dark brown almost black eyes', 'grey-green eyes', 'amber eyes'], 1);
  const faceShape = pick(['oval face', 'round face with soft cheeks', 'heart-shaped face', 'slightly angular face', 'diamond-shaped face', 'long narrow face'], 2);
  const skin = pick([
    'fair skin with light freckles across the nose',
    'olive Mediterranean skin tone',
    'warm tan skin',
    'pale porcelain skin',
    'medium neutral skin tone with natural warmth',
    'lightly sun-weathered skin',
    'deep brown skin with warm undertones',
    'light golden skin tone',
    'rich caramel skin tone',
  ], 3);
  const build = pick([
    'average slim build',
    'curvy natural build with soft midsection',
    'athletic build with broader shoulders',
    'petite short frame (155cm)',
    'tall and slender build (178cm)',
    'average build with wider hips',
    'compact muscular build',
    'soft pear-shaped build',
  ], 4);
  const ethnicity = pick([
    'European Caucasian features',
    'Latin/Hispanic features',
    'East Asian features',
    'Mediterranean features',
    'Mixed race features',
    'Slavic features',
    'Scandinavian features',
  ], 5);
  const appearance = `Appearance: ${ethnicity}, ${hair}, ${eyes}, ${faceShape}, ${skin}, ${build}.`;

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
    : `A real ${age}-year-old woman, identity reference photograph for an AI catalog generation system.

WHO SHE IS: ${ethnicity}. ${hair}. ${eyes}. ${faceShape}. ${skin}. ${build}. ${bodyDetails}.${weightDesc}

${faceDescriptor}

POSE & FRAMING: Standing relaxed against a plain wall, head-to-toe FULL BODY framed vertically — head with breathing room at top, BARE FEET FULLY VISIBLE at the bottom. Do NOT crop at the knees or waist. Arms hanging naturally at her sides. Weight evenly distributed. Looking directly at camera with a neutral, relaxed expression — slight half-smile or relaxed mouth. NOT posing, NOT modeling.

CLOTHING: Plain fitted neutral-tone activewear — a simple fitted tank top and simple fitted bike shorts (or fitted leggings to the knee). Solid neutral color (heather grey, light dusty sage, soft taupe, or muted dusty rose). No patterns, no graphics, no logos, no brand markings. Bare feet, no shoes. The clothing reveals her real body proportions clearly without being revealing.

ENVIRONMENT: Plain off-white or light beige interior wall. Soft natural daylight from an off-camera side window. Bedroom or hallway setting. No furniture, no plants, no decorations, no props.

PHOTO STYLE: Shot on a modern smartphone (iPhone-style portrait), even exposure, natural skin tone reproduction, slightly desaturated soft modern aesthetic. Clean and contemporary — NOT amateur snapshot, NOT studio glamour, NOT fashion shoot. The kind of photo a friend would take of her as a reference.

QUALITY: Real skin texture preserved (${bodyImperfections}). She looks like a real ${age}-year-old someone might photograph as a fit-test reference — a normal person, not an Instagram model, not a stock photo, not a professional fashion shoot.

DO NOT GENERATE: glamour pose, posed smile, makeup contouring, heavy makeup, styled hair, fashion runway energy, professional studio lighting, ring lights in eyes, beauty filter, smoothed plastic skin, model-thin or athletic-cut body, Instagram aesthetic, perfect symmetry, cinematic lighting, dramatic shadows, swimwear, lingerie, underwear, revealing clothing, hands on hips, hands behind head.

FINAL CHECK: The woman is exactly ${age} years old (not younger). Her body proportions match the description above precisely — including her natural weight and build. The framing is FULL BODY, head to bare feet, not cropped.`;

  // Check if persona already has a reference — use Nano Banana edit with it, otherwise text-to-image
  const { data: existingAvatar } = await supabase.from('persona_avatars').select('reference_url')
    .eq('store_id', store_id).eq('persona_name', persona_name).single();

  const hasReference = existingAvatar?.reference_url;
  const imageUrl = hasReference ? existingAvatar.reference_url : undefined;

  // When regenerating from an existing photo, use identity-preservation prompt
  // instead of the generic avatar prompt — keeps the same face/hair/body from the uploaded photo
  const finalPrompt = hasReference
    ? `Recreate the EXACT same woman from the reference image. Keep her EXACT face, hair color, hair style, skin tone, AGE, and BODY PROPORTIONS — she must be immediately recognizable as the same person.

CRITICAL BODY PRESERVATION: Match her ACTUAL body shape and weight from the reference photo EXACTLY. Do NOT slim her down. Do NOT thin her waist. Do NOT narrow her hips. Do NOT reduce her arm or thigh thickness. Do NOT make her more athletic, more toned, or more model-shaped than she actually is in the reference. If she has a soft midsection in the reference, keep the soft midsection. If she has full hips, keep the full hips. If she has natural thigh thickness, keep that thickness. The generated body must look LIKE THE REFERENCE BODY, not a slimmed-down idealized version. Real women have real bodies — preserve hers as-is.

POSE & FRAMING: FULL BODY shot from head to bare feet, standing in front of a plain beige or off-white wall. Arms relaxed at sides, neutral expression, facing camera directly. Feet at the bottom of the frame.

CLOTHING: Plain fitted neutral-tone activewear — simple fitted tank top + simple fitted bike shorts (or fitted leggings) in a solid neutral color (heather grey, light sage, taupe, or muted dusty rose). No patterns, no logos. Bare feet.

PHOTO STYLE: Modern smartphone-style portrait, natural indoor lighting, clean contemporary look — not amateur snapshot, not studio glamour.

IDENTITY LOCK: The generated woman MUST look identical to the reference — same person, same face, same features, SAME BODY.`
    : prompt;

  // FIRE-AND-FORGET PATTERN: submit front shot to fal.ai, persist requestId + pollBase into
  // persona_avatars row, return immediately. poll_avatar_generations action checks status
  // periodically (called from frontend polling) and finalizes when fal completes.
  // Nano Banana Pro can take 60-90s for /edit calls which exceeds Vercel 60s timeout —
  // fire-and-forget is the only way.
  // Front view ONLY — user requested no 3/4 angle (saves ~30s wait + $0.08 cost per avatar).
  const frontModel = hasReference ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro';

  let frontJob;
  try {
    frontJob = await submitFalJob({
      model: frontModel,
      prompt: `${finalPrompt} Front view, facing camera directly.`,
      imageUrl,
      numImages: 1,
      aspectRatio: '9:16',
    });
  } catch (err) {
    console.error('[generate_avatar] fal submit failed:', err.message);
    return res.status(500).json({ error: `fal.ai submit failed: ${err.message}` });
  }

  if (!frontJob.requestId || !frontJob.pollBase) {
    return res.status(500).json({ error: 'fal.ai submit returned no requestId/pollBase' });
  }

  // Upsert persona_avatars row with status='generating' + front request tracking.
  // poll_avatar_generations picks this up, downloads/uploads front image, then submits
  // the 3/4 angle, then completes the row.
  const genMetadata = {
    prompt_front: `${finalPrompt} Front view, facing camera directly.`,
    front_model: frontModel,
    store_slug: storeName,
    submitted_at: new Date().toISOString(),
    has_reference: !!hasReference,
    reference_image_url: imageUrl || null,
  };

  const { data: existing } = await supabase
    .from('persona_avatars')
    .select('id')
    .eq('store_id', store_id)
    .eq('persona_name', persona_name)
    .single();

  if (existing) {
    await supabase
      .from('persona_avatars')
      .update({
        status: 'generating',
        front_request_id: frontJob.requestId,
        front_poll_base: frontJob.pollBase,
        gen_metadata: genMetadata,
        description: description,  // refresh latest description
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('persona_avatars')
      .insert({
        store_id,
        persona_name,
        description,
        variants: [],
        status: 'generating',
        front_request_id: frontJob.requestId,
        front_poll_base: frontJob.pollBase,
        gen_metadata: genMetadata,
      });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AVATAR', level: 'info', store_id,
    message: `Submitted avatar generation for ${persona_name} (front: ${frontModel})`,
  });

  // Return immediately. Frontend polls for completion.
  return res.status(200).json({
    status: 'generating',
    front_request_id: frontJob.requestId,
    persona_name,
  });
}

// Process all in-flight avatar generations for a store. Called periodically by frontend.
// Two-stage: status='generating' (front in-flight) → status='angles' (front done, 3/4 in-flight) → status=NULL (all done) or 'failed'.
export async function poll_avatar_generations(req, res) {
  const { store_id } = req.query;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const { data: pending, error: pErr } = await supabase
    .from('persona_avatars')
    .select('*')
    .eq('store_id', store_id)
    .in('status', ['generating', 'angles']);

  if (pErr) {
    console.error('[poll_avatar_generations] query error:', pErr.message);
    return res.status(500).json({ error: pErr.message });
  }

  if (!pending || pending.length === 0) {
    return res.status(200).json({ checked: 0, completed: 0, failed: 0 });
  }

  const storeName = (await getStore(store_id))?.slug || (await getStore(store_id))?.name || 'unknown';
  let checked = 0, completed = 0, failed = 0;

  for (const row of pending) {
    checked++;
    const meta = typeof row.gen_metadata === 'string' ? JSON.parse(row.gen_metadata || '{}') : (row.gen_metadata || {});

    try {
      // STAGE 1: front shot in flight
      if (row.status === 'generating') {
        if (!row.front_poll_base || !row.front_request_id) {
          await supabase.from('persona_avatars').update({ status: 'failed', gen_metadata: { ...meta, error: 'missing front poll info' } }).eq('id', row.id);
          failed++;
          continue;
        }

        const result = await checkFalJob(row.front_poll_base, row.front_request_id);

        if (result.status === 'pending') {
          continue;  // still in flight, keep waiting
        }

        if (result.status === 'failed') {
          await supabase.from('persona_avatars').update({ status: 'failed', gen_metadata: { ...meta, error: `front gen failed: ${result.error}` } }).eq('id', row.id);
          failed++;
          console.error('[poll_avatar_generations] front failed for', row.persona_name, '—', result.error);
          continue;
        }

        // result.status === 'completed' → download + upload to Storage
        const resp = await fetch(result.url);
        if (!resp.ok) throw new Error(`fal download ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1000) throw new Error(`buffer too small (${buf.length} bytes)`);

        const frontPath = `${storeName}/Avatars/${row.persona_name}/front_${Date.now()}.jpg`;
        const { error: uploadErr } = await supabase.storage.from('store-docs').upload(frontPath, buf, { contentType: 'image/jpeg', upsert: true });
        if (uploadErr) throw new Error(`storage upload: ${uploadErr.message}`);
        const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(frontPath);
        const frontUrl = urlData?.publicUrl;
        if (!frontUrl) throw new Error('no public URL from Storage');

        // Front view ONLY — append to variants, mark complete (no 3/4 angle, per user request).
        const allVariants = [...(row.variants || []), frontUrl];
        await supabase.from('persona_avatars').update({
          status: null,
          variants: allVariants,
          gen_metadata: { ...meta, front_completed_at: new Date().toISOString(), front_url: frontUrl, completed_at: new Date().toISOString() },
        }).eq('id', row.id);
        completed++;
        console.log('[poll_avatar_generations] front done for', row.persona_name, '— total variants:', allVariants.length);

        await supabase.from('pipeline_log').insert({
          agent: 'AVATAR', level: 'info', store_id,
          message: `Avatar generation completed for ${row.persona_name} (front view, ${allVariants.length} variants)`,
        });
      }
    } catch (err) {
      console.error('[poll_avatar_generations] check failed for', row.persona_name, err.message);
      await supabase.from('persona_avatars').update({
        status: 'failed',
        gen_metadata: { ...meta, error: err.message },
      }).eq('id', row.id);
      failed++;
    }
  }

  return res.status(200).json({ checked, completed, failed });
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

// POST: activate / deactivate a persona avatar (inactive ones are hidden from pickers)
export async function set_avatar_active(req, res) {
  const { store_id, persona_name, is_active } = req.body;
  if (!store_id || !persona_name || typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'store_id, persona_name, and boolean is_active required' });
  }
  const { error } = await supabase
    .from('persona_avatars')
    .update({ is_active })
    .eq('store_id', store_id)
    .eq('persona_name', persona_name);
  if (error) throw error;
  return res.status(200).json({ persona_name, is_active });
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

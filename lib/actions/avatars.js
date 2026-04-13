import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { generateFal } from '../fal.js';

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

  const prompt = fullDescription.startsWith('Professional') || fullDescription.startsWith('Full body')
    ? fullDescription
    : `Full body photograph of a real woman. Head to knees visible. Standing naturally in a neutral studio with warm soft lighting. She is NOT a fashion model — she looks like a real person you'd meet at the beach.

Based on this persona description, create a REALISTIC woman:
${fullDescription}

CRITICAL RULES:
- Show FULL BODY from head to at least knees. NOT a headshot. NOT cropped at shoulders.
- She must look like a REAL PERSON — natural skin texture, natural body shape, visible imperfections
- Age-appropriate face — wrinkles, expression lines matching her age
- Body type must match the description — do NOT make her slimmer or more athletic than described
- Natural relaxed pose, weight on one hip, arms at sides
- Warm, genuine expression — she looks comfortable and confident
- Natural hair, minimal makeup
- Wearing simple neutral underwear (plain bra and briefs, no logos, nude or black) so her body shape is clearly visible
- 4:5 aspect ratio, shot on 85mm lens, soft bokeh background

The goal is to create a RECOGNIZABLE reference model that will be used consistently across product photos.`;

  // Use FLUX Schnell for text-to-image avatar generation (no reference needed)
  // Edit models (nano-banana, flux-2-pro) require image_urls — can't use for pure text-to-image
  const variantPromises = Array.from({ length: 4 }, () =>
    generateFal({ model: 'fal-ai/flux/schnell', prompt, numImages: 1, aspectRatio: '4:5' })
  );
  const results = await Promise.all(variantPromises);

  // Download from fal.ai (temporary) and re-upload to Supabase Storage
  const permanentUrls = [];
  for (let i = 0; i < results.length; i++) {
    const falUrl = results[i].url;
    const resp = await fetch(falUrl);
    const buf = Buffer.from(await resp.arrayBuffer());
    const path = `${storeName}/Avatars/${persona_name}/gen_${Date.now()}_${i}.jpg`;
    await supabase.storage.from('store-docs').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
    permanentUrls.push(urlData?.publicUrl);
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

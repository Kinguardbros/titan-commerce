import { createClient } from '@supabase/supabase-js';
import dns from 'node:dns/promises';
import net from 'node:net';
import { getStore } from '../store-context.js';
import { scrapeProduct } from '../scraper-utils.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// SSRF guard for scrape_style (P2, AUDIT-2026-08). `url` — and, transitively, the
// image URLs scrapeProduct() extracts from that page — is fully attacker-supplied:
// any dashboard user with creatives:generate can point this serverless function at
// an internal address (127.0.0.1, 169.254.169.254 cloud metadata, RFC1918 ranges)
// and read the response back as "scraped style images". Unlike reviews-amazon.js's
// ALLOWED_PHOTO_HOSTS (a fixed CDN allow-list — review photos only ever come from a
// handful of known domains), scrape_style has to accept arbitrary public websites,
// so this is a blocklist of private/loopback/link-local ranges instead of an
// allow-list. Checked twice: once on the literal hostname/IP in the URL, once on
// every IP the hostname resolves to (DNS-rebinding resistant — a hostname that's
// public when this check runs but gets pointed at 127.0.0.1 by fetch time).
const PRIVATE_IPV4_RANGES = [
  /^127\./,                       // loopback
  /^10\./,                        // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,   // RFC1918 172.16.0.0/12
  /^192\.168\./,                  // RFC1918
  /^169\.254\./,                  // link-local, incl. cloud metadata (169.254.169.254)
  /^0\./,                         // "this" network
];

function isPrivateIp(ip) {
  if (!ip) return true; // fail closed
  if (net.isIPv4(ip)) return PRIVATE_IPV4_RANGES.some((re) => re.test(ip));
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — re-check the embedded IPv4.
      const mapped = lower.split(':').pop();
      return net.isIPv4(mapped) ? PRIVATE_IPV4_RANGES.some((re) => re.test(mapped)) : true;
    }
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local addresses
    if (lower.startsWith('fe80:')) return true;         // link-local
    return false;
  }
  return true; // not a recognizable IP format — fail closed
}

// Throws Error({statusCode, message}) on rejection, resolves the parsed URL on
// success. Exported for direct unit testing.
export async function assertUrlIsSafeToFetch(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { statusCode: 400 });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Only https:// URLs are allowed'), { statusCode: 400 });
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw Object.assign(new Error('URL host not allowed'), { statusCode: 400 });
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw Object.assign(new Error('URL host not allowed'), { statusCode: 400 });
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw Object.assign(new Error('Could not resolve URL host'), { statusCode: 400 });
  }
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw Object.assign(new Error('URL host not allowed'), { statusCode: 400 });
  }
  return parsed;
}

// GET: custom_styles
export async function custom_styles(req, res) {
  const storeId = req.query.store_id;
  if (!storeId) return res.status(400).json({ error: 'store_id required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  const { data, error } = await supabase.from('store_skills')
    .select('id, skill_type, title, metadata, generated_at')
    .eq('store_id', storeId)
    .like('skill_type', 'custom-style-%')
    .is('product_name', null)
    .order('generated_at', { ascending: false });
  if (error) throw error;
  return res.status(200).json((data || []).map(s => ({
    style_key: s.metadata?.style_key || `cs_${s.skill_type.replace('custom-style-', '')}`,
    name: s.title,
    color_palette: s.metadata?.color_palette || [],
    reference_images: s.metadata?.reference_images || [],
    created_at: s.generated_at,
  })));
}

// POST: analyze_style
export async function analyze_style(req, res) {
  const { store_id, images = [], urls = [] } = req.body;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  if (!hasPermission(req.user, 'creatives:generate')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  // Collect images from base64 inputs + fetched URLs
  const allImages = [...images];
  for (const url of urls.slice(0, 8)) {
    try {
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      allImages.push({ base64: buf.toString('base64'), media_type: contentType.split(';')[0] });
    } catch (e) { console.warn('[system/analyze_style] Failed to fetch URL:', { url, error: e.message }); }
  }

  if (allImages.length < 1) return res.status(400).json({ error: 'At least 1 image required' });
  const limited = allImages.slice(0, 8);

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageBlocks = limited.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type, data: img.base64 },
  }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: `Analyze these ${limited.length} reference photos collectively. Focus ONLY on the ENVIRONMENT, SETTING, and VISUAL ATMOSPHERE — ignore the models/people and specific products in the photos. We want to recreate this same environment/backdrop for our own products and models.\n\nReturn ONLY valid JSON:\n{\n  "style_name_suggestion": "short descriptive name for this scene/environment (2-4 words)",\n  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],\n  "lighting": "lighting setup and quality — direction, color temperature, shadows, highlights",\n  "composition": "typical camera framing, depth of field, focal length feel",\n  "setting": "detailed description of the environment, location, background elements, props, surfaces, textures",\n  "mood": "emotional atmosphere of the scene — warm, cool, energetic, calm, luxurious, casual...",\n  "camera_angle": "camera position, distance, perspective",\n  "color_grading": "overall color treatment, tones, contrast, saturation",\n  "distinguishing_features": "what makes this environment unique — specific elements that define the look",\n  "prompt_template": "A complete image generation prompt that recreates this EXACT environment/scene for a fashion product photo. Use {product_name} and {price} as placeholders. Focus on describing the setting, lighting, atmosphere, colors, and background — NOT the model or product. The model and product will be added separately. Be very specific — 8-15 sentences."\n}`,
        },
      ],
    }],
  });

  let analysisText = response.content[0].text.trim();
  if (analysisText.startsWith('```')) analysisText = analysisText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const analysis = JSON.parse(analysisText);

  return res.status(200).json({ analysis, image_count: limited.length });
}

// POST: create_custom_style
export async function create_custom_style(req, res) {
  const { store_id, name, description, analysis, reference_images = [] } = req.body;
  if (!store_id || !name || !analysis) return res.status(400).json({ error: 'store_id, name, analysis required' });
  if (!hasPermission(req.user, 'creatives:generate')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const styleKey = `cs_${slug}`;
  const store = await getStore(store_id);
  // Storage path uses store.slug (immutable, unique, kebab-case) — NOT store.name,
  // which is mutable display text that may contain spaces/special chars and isn't
  // guaranteed unique (P2, AUDIT-2026-08). Defensive fallback to store.id (UUID,
  // always unique) if slug is ever null/empty; store_id itself is guaranteed
  // non-empty here (validated at the top of this handler).
  const storeFolder = store?.slug || store?.id || store_id;

  // Upload reference images to Storage
  const uploadedUrls = [];
  for (let i = 0; i < reference_images.length && i < 8; i++) {
    const img = reference_images[i];
    const path = `${storeFolder}/Styles/${slug}/ref_${i}.jpg`;
    const buf = Buffer.from(img.base64, 'base64');
    const { error: upErr } = await supabase.storage.from('store-docs').upload(path, buf, {
      contentType: img.media_type || 'image/jpeg', upsert: true,
    });
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('store-docs').getPublicUrl(path);
      if (urlData?.publicUrl) uploadedUrls.push(urlData.publicUrl);
    }
  }

  // Build skill content
  const palette = (analysis.color_palette || []).join(', ');
  const refList = uploadedUrls.map(u => `- ${u}`).join('\n');
  const content = `# Custom Style: ${name}\n\nREQUIRES: audience-personas skill\nREQUIRES: brand-voice skill\n\n${description || ''}\n\n## VISUAL ANALYSIS\n- **Color palette:** ${palette}\n- **Lighting:** ${analysis.lighting || ''}\n- **Composition:** ${analysis.composition || ''}\n- **Setting:** ${analysis.setting || ''}\n- **Mood:** ${analysis.mood || ''}\n- **Camera:** ${analysis.camera_angle || ''}\n- **Color grading:** ${analysis.color_grading || ''}\n- **Unique:** ${analysis.distinguishing_features || ''}\n\n## PROMPT TEMPLATE\n${analysis.prompt_template || ''}\n\n## REFERENCE IMAGES\n${refList}`;

  // Upsert into store_skills
  const skillType = `custom-style-${slug}`;
  const { data: skill, error: skillErr } = await supabase.from('store_skills').upsert({
    store_id, skill_type: skillType, title: name, content, product_name: null,
    metadata: { reference_images: uploadedUrls, color_palette: analysis.color_palette || [], style_key: styleKey },
  }, { onConflict: 'store_id,skill_type,product_name' }).select().single();
  if (skillErr) throw skillErr;

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'STYLE_GEN', level: 'success',
    message: `Created custom style: ${name}`,
    metadata: { style_key: styleKey, ref_count: uploadedUrls.length },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ style_key: styleKey, skill_id: skill.id });
}

// POST: delete_custom_style
export async function delete_custom_style(req, res) {
  const { store_id, style_key } = req.body;
  if (!store_id || !style_key) return res.status(400).json({ error: 'store_id, style_key required' });
  if (!hasPermission(req.user, 'creatives:generate')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  if (!style_key.startsWith('cs_')) return res.status(400).json({ error: 'Invalid style_key — must start with cs_' });

  const slug = style_key.slice(3);
  const skillType = `custom-style-${slug}`;
  const store = await getStore(store_id);
  const storeFolder = store?.slug || store?.id || store_id;
  const legacyStoreFolder = store?.name || 'Store';

  // Delete from store_skills
  await supabase.from('store_skills').delete().eq('store_id', store_id).eq('skill_type', skillType);

  // Delete reference images from Storage. Dual-path (P2, AUDIT-2026-08): styles
  // created before the store.slug path migration live under the legacy store.name
  // folder; styles created after live under store.slug. There's no storage_path
  // column to disambiguate up front, so try both — listing an empty/nonexistent
  // prefix is a cheap no-op. Follow-up cleanup once burn-in confirms nothing still
  // resolves under the legacy name path: drop the legacyStoreFolder branch below.
  async function removeStyleFiles(folder) {
    const { data: files } = await supabase.storage.from('store-docs').list(`${folder}/Styles/${slug}`);
    if (files?.length) {
      await supabase.storage.from('store-docs').remove(files.map(f => `${folder}/Styles/${slug}/${f.name}`));
    }
  }
  try {
    await removeStyleFiles(storeFolder);
    if (legacyStoreFolder !== storeFolder) await removeStyleFiles(legacyStoreFolder);
  } catch (e) { console.warn('[system/delete_custom_style] Storage cleanup:', { error: e.message }); }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'STYLE_GEN', level: 'info',
    message: `Deleted custom style: ${style_key}`,
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ deleted: true });
}

// POST: describe_style
export async function describe_style(req, res) {
  const { store_id, description } = req.body;
  if (!store_id || !description) return res.status(400).json({ error: 'store_id and description required' });
  if (!hasPermission(req.user, 'creatives:generate')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Based on this description, create a complete SCENE/ENVIRONMENT definition for fashion product photography. Focus on the SETTING, BACKDROP, and ATMOSPHERE — not the model or product. We will place our own models and products into this scene.\n\nDescription: ${description}\n\nReturn ONLY valid JSON:\n{\n  "style_name_suggestion": "short descriptive name for this scene (2-4 words)",\n  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],\n  "lighting": "lighting setup — direction, color temperature, quality, shadows",\n  "composition": "camera framing, depth of field, focal length feel",\n  "setting": "detailed environment description — location, background, surfaces, props, textures",\n  "mood": "emotional atmosphere — warm, cool, energetic, calm, luxurious...",\n  "camera_angle": "camera position, distance, perspective",\n  "color_grading": "color treatment, tones, contrast, saturation",\n  "distinguishing_features": "what makes this environment unique",\n  "prompt_template": "A complete image generation prompt that recreates this EXACT scene/environment for a fashion photo. Use {product_name} and {price} as placeholders. Focus on setting, lighting, atmosphere, colors, background. The model and product will be specified separately. Be very specific — 8-15 sentences."\n}`,
    }],
  });

  let text = response.content[0].text.trim();
  if (text.startsWith('```')) text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const analysis = JSON.parse(text);

  return res.status(200).json({ analysis });
}

// POST: scrape_style
export async function scrape_style(req, res) {
  const { url, store_id } = req.body;
  if (!url || !store_id) return res.status(400).json({ error: 'url and store_id required' });
  if (!hasPermission(req.user, 'creatives:generate')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires creatives:generate permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  try {
    await assertUrlIsSafeToFetch(url);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message || 'URL not allowed' });
  }

  const scraped = await scrapeProduct(url);
  const imageUrls = (scraped?.image_urls || scraped?.images || []).slice(0, 8);
  if (!imageUrls.length) return res.status(400).json({ error: 'No images found on URL' });

  // Fetch images and convert to base64
  const images = [];
  for (const imgUrl of imageUrls) {
    try {
      // Re-check each extracted image URL — the scraped page is attacker-controlled
      // (it's whatever `url` the caller pointed us at) and could embed an <img> src
      // pointing at an internal address even when `url` itself was a legit public site.
      await assertUrlIsSafeToFetch(imgUrl);
      const resp = await fetch(imgUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      images.push({ url: imgUrl, base64: buf.toString('base64'), media_type: contentType.split(';')[0] });
    } catch (e) { console.warn('[system/scrape_style] Failed to fetch image:', { url: imgUrl, error: e.message }); }
  }

  if (!images.length) return res.status(400).json({ error: 'Failed to fetch any images from URL' });

  // Run Claude Vision analysis
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageBlocks = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type, data: img.base64 },
  }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: `Analyze these ${images.length} reference photos collectively. Focus ONLY on the ENVIRONMENT, SETTING, and VISUAL ATMOSPHERE — ignore the models/people and specific products in the photos. We want to recreate this same environment/backdrop for our own products and models.\n\nReturn ONLY valid JSON:\n{\n  "style_name_suggestion": "short descriptive name for this scene/environment (2-4 words)",\n  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],\n  "lighting": "lighting setup and quality — direction, color temperature, shadows, highlights",\n  "composition": "typical camera framing, depth of field, focal length feel",\n  "setting": "detailed description of the environment, location, background elements, props, surfaces, textures",\n  "mood": "emotional atmosphere of the scene — warm, cool, energetic, calm, luxurious, casual...",\n  "camera_angle": "camera position, distance, perspective",\n  "color_grading": "overall color treatment, tones, contrast, saturation",\n  "distinguishing_features": "what makes this environment unique — specific elements that define the look",\n  "prompt_template": "A complete image generation prompt that recreates this EXACT environment/scene for a fashion product photo. Use {product_name} and {price} as placeholders. Focus on describing the setting, lighting, atmosphere, colors, and background — NOT the model or product. The model and product will be added separately. Be very specific — 8-15 sentences."\n}`,
        },
      ],
    }],
  });

  let analysisText = response.content[0].text.trim();
  if (analysisText.startsWith('```')) analysisText = analysisText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  const analysis = JSON.parse(analysisText);

  return res.status(200).json({ analysis, images: images.map(({ base64, ...rest }) => rest) });
}

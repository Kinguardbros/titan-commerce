import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Exported helper — used by docs.js and other modules
export async function upsertSkill(supabaseClient, storeId, skillType, title, newInsights, prompt, anthropic, productName = null) {
  const query = supabaseClient.from('store_skills').select('content')
    .eq('store_id', storeId).eq('skill_type', skillType);
  if (productName) query.eq('product_name', productName);
  else query.is('product_name', null);
  const { data: existing } = await query.single();

  let content;
  if (existing?.content) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 4000,
      messages: [{ role: 'user', content: `You are updating a brand knowledge document. Merge the existing content with new insights. Keep all existing specific data, add new information, refine if there are updates. Remove duplicates. Return the complete merged document in markdown.\n\nEXISTING DOCUMENT:\n${existing.content}\n\nNEW INSIGHTS TO MERGE:\n${newInsights.slice(0, 6000)}\n\nReturn the full merged document:` }],
    });
    content = response.content[0].text;
  } else {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 4000,
      messages: [{ role: 'user', content: `${prompt}\n\nSource insights:\n${newInsights.slice(0, 8000)}\n\nReturn as structured markdown with bullet points. Only include specific, actionable insights.` }],
    });
    content = response.content[0].text;
  }

  const sourceCount = (newInsights.match(/^[-•*]/gm) || []).length || 1;
  await supabaseClient.from('store_skills').upsert({
    store_id: storeId, skill_type: skillType, title, product_name: productName || null,
    content, source_count: sourceCount, generated_at: new Date().toISOString(),
  }, { onConflict: 'store_id,skill_type,product_name' });

  return content;
}

// GET: get_skills
export async function get_skills(req, res) {
  const storeId = req.query.store_id;
  if (!storeId) return res.status(400).json({ error: 'store_id required' });
  const { data: skills } = await supabase.from('store_skills').select('*')
    .eq('store_id', storeId).order('skill_type');
  const { data: knowledge } = await supabase.from('store_knowledge')
    .select('category').eq('store_id', storeId);
  const categories = [...new Set((knowledge || []).map((k) => k.category))];
  return res.status(200).json({ skills: skills || [], available_categories: categories });
}

// POST: save_skill — inline edit a skill's content directly
export async function save_skill(req, res) {
  const { store_id, skill_type, content, product_name } = req.body;
  if (!store_id || !skill_type || content === undefined) return res.status(400).json({ error: 'store_id, skill_type, and content required' });

  const query = supabase.from('store_skills').select('id')
    .eq('store_id', store_id).eq('skill_type', skill_type);
  if (product_name) query.eq('product_name', product_name);
  else query.is('product_name', null);
  const { data: existing } = await query.single();

  if (existing) {
    await supabase.from('store_skills').update({ content, generated_at: new Date().toISOString() }).eq('id', existing.id);
  } else {
    await supabase.from('store_skills').insert({
      store_id, skill_type, content, title: skill_type,
      product_name: product_name || null, source_count: 0,
      generated_at: new Date().toISOString(),
    });
  }

  return res.status(200).json({ ok: true, skill_type });
}

// POST: generate_skills
export async function generate_skills(req, res) {
  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const { data: knowledge } = await supabase.from('store_knowledge')
    .select('category, insights, product_name').eq('store_id', store_id)
    .order('processed_at', { ascending: false });

  if (!knowledge?.length) return res.status(200).json({ generated: 0, skills: [] });

  const SKILL_MAP = {
    Ads: { type: 'ad-hooks', title: 'Ad Hooks & Copy', prompt: `From these ad transcripts and ad library analyses for "${store.name}", extract: winning hooks (exact quotes), failing hooks, hook patterns/structures, ad frameworks, CTA styles. Be maximally specific — include exact examples.` },
    Creative: { type: 'creative-direction', title: 'Creative Direction', prompt: `From these creative playbooks for "${store.name}", extract: visual rules (colors, settings, model types, lighting), what works vs what doesn't, testing framework, KPI benchmarks, format guidelines.` },
    Audience: { type: 'audience-personas', title: 'Audience Personas', prompt: `From these audience docs for "${store.name}", extract: detailed personas (name, age, core emotion, exact quotes), pain points, objections, trigger phrases, customer language patterns. Be maximally specific.` },
    Brand: { type: 'brand-voice', title: 'Brand Voice', prompt: `From these brand docs for "${store.name}", extract: brand positioning statement, voice & tone rules, messaging do's and don'ts, taglines, key messages, brand story elements.` },
  };

  // Separate store-level (non-product) and product-level insights
  const storeLevel = {};
  const productLevel = {};
  for (const k of knowledge) {
    if (k.category === 'Products' && k.product_name) {
      if (!productLevel[k.product_name]) productLevel[k.product_name] = [];
      productLevel[k.product_name].push(k.insights);
    } else if (SKILL_MAP[k.category]) {
      if (!storeLevel[k.category]) storeLevel[k.category] = [];
      storeLevel[k.category].push(k.insights);
    }
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = [];

  // Store-level skills
  for (const [category, insightsList] of Object.entries(storeLevel)) {
    const mapping = SKILL_MAP[category];
    const insightsText = insightsList.join('\n\n');
    await upsertSkill(supabase, store_id, mapping.type, mapping.title, insightsText, mapping.prompt, anthropic);
    results.push({ skill_type: mapping.type, title: mapping.title, source_count: insightsList.length });
  }

  // Per-function studio skills (split from Creative insights)
  if (storeLevel.Creative?.length) {
    const creativeText = storeLevel.Creative.join('\n\n');
    const FUNC_SKILLS = [
      { type: 'product-photo', title: 'Product Photo', prompt: 'Rules for product photography: backgrounds, lighting, angles, props, product styling' },
      { type: 'lifestyle-photo', title: 'Lifestyle Photo', prompt: 'Rules for lifestyle photos: settings, model type/age/body, mood, colors, scenarios' },
      { type: 'ad-creative', title: 'Ad Creative', prompt: 'Rules for ad creatives: composition, text placement, hook style, before/after, social proof' },
      { type: 'ugc-content', title: 'UGC Content', prompt: 'Rules for UGC/review content: authenticity cues, smartphone look, testimonial style' },
    ];
    const splitResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 4000,
      messages: [{ role: 'user', content: `From these creative insights for "${store.name}", split the rules by generation type. For each type that has relevant rules, output a section. Skip types with no relevant data.

Types:
${FUNC_SKILLS.map((f) => `- ${f.type}: ${f.prompt}`).join('\n')}

Source insights:
${creativeText.slice(0, 8000)}

Output format — use EXACTLY these headers:
## product-photo
(rules here)

## lifestyle-photo
(rules here)

## ad-creative
(rules here)

## ugc-content
(rules here)

Only include sections that have specific, actionable rules from the sources.` }],
    });

    const splitText = splitResponse.content[0].text;
    for (const func of FUNC_SKILLS) {
      const regex = new RegExp(`##\\s*${func.type}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
      const match = splitText.match(regex);
      if (match?.[1]?.trim()) {
        await upsertSkill(supabase, store_id, func.type, func.title, match[1].trim(), func.prompt, anthropic);
        results.push({ skill_type: func.type, title: func.title, source_count: storeLevel.Creative.length });
      }
    }
  }

  // Per-product skills
  for (const [productName, insightsList] of Object.entries(productLevel)) {
    const skillType = `product-${productName.toLowerCase().replace(/\s+/g, '-')}`;
    const prompt = `Generate product knowledge for "${productName}" by ${store.name}. Include: unique mechanism, key features with benefits, belief statements, objection counters, sizing, materials. Be specific to THIS product only.`;
    const insightsText = insightsList.join('\n\n');
    await upsertSkill(supabase, store_id, skillType, productName, insightsText, prompt, anthropic, productName);
    results.push({ skill_type: skillType, title: productName, product_name: productName, source_count: insightsList.length });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SKILL_GEN',
    message: `Generated ${results.length} skills for ${store.name}`,
    level: 'success', metadata: { skills: results.map((r) => r.skill_type) },
  });

  return res.status(200).json({ generated: results.length, skills: results });
}

// POST: regenerate_skill
export async function regenerate_skill(req, res) {
  const { store_id, skill_type, product_name } = req.body;
  if (!store_id || !skill_type) return res.status(400).json({ error: 'store_id and skill_type required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const STORE_SKILL_MAP = {
    'ad-hooks': { category: 'Ads', title: 'Ad Hooks & Copy', prompt: `From these ad transcripts and ad library analyses for "${store.name}", extract: winning hooks (exact quotes), failing hooks, hook patterns/structures, ad frameworks, CTA styles. Be maximally specific.` },
    'creative-direction': { category: 'Creative', title: 'Creative Direction', prompt: `From these creative playbooks for "${store.name}", extract: visual rules, what works vs doesn't, testing framework, KPI benchmarks.` },
    'audience-personas': { category: 'Audience', title: 'Audience Personas', prompt: `From these audience docs for "${store.name}", extract: detailed personas, pain points, objections, trigger phrases, customer language.` },
    'brand-voice': { category: 'Brand', title: 'Brand Voice', prompt: `From these brand docs for "${store.name}", extract: positioning, voice & tone rules, messaging do/don't, taglines.` },
    'product-photo': { category: 'Creative', title: 'Product Photo', prompt: `From these creative docs for "${store.name}", extract rules for product photography: backgrounds, lighting, angles, props, product styling.` },
    'lifestyle-photo': { category: 'Creative', title: 'Lifestyle Photo', prompt: `From these creative docs for "${store.name}", extract rules for lifestyle photos: settings, model type/age/body, mood, colors, scenarios.` },
    'ad-creative': { category: 'Creative', title: 'Ad Creative', prompt: `From these creative docs for "${store.name}", extract rules for ad creatives: composition, text placement, hook style, before/after, social proof.` },
    'ugc-content': { category: 'Creative', title: 'UGC Content', prompt: `From these creative docs for "${store.name}", extract rules for UGC/review content: authenticity, smartphone look, testimonial style.` },
  };

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let query, prompt, title;

  if (skill_type.startsWith('product-') && product_name) {
    query = supabase.from('store_knowledge').select('insights')
      .eq('store_id', store_id).eq('product_name', product_name)
      .order('processed_at', { ascending: false });
    prompt = `Generate product knowledge for "${product_name}" by ${store.name}. Include: unique mechanism, key features, belief statements, objection counters, sizing, materials. Be specific to THIS product only.`;
    title = product_name;
  } else {
    const mapping = STORE_SKILL_MAP[skill_type];
    if (!mapping) return res.status(400).json({ error: `Unknown skill_type: ${skill_type}` });
    query = supabase.from('store_knowledge').select('insights')
      .eq('store_id', store_id).eq('category', mapping.category)
      .order('processed_at', { ascending: false });
    prompt = mapping.prompt;
    title = mapping.title;
  }

  const { data: knowledge } = await query;
  if (!knowledge?.length) return res.status(200).json({ error: 'No insights found for this skill' });

  const insightsText = knowledge.map((k) => k.insights).join('\n\n');
  const content = await upsertSkill(supabase, store_id, skill_type, title, insightsText, prompt, anthropic, product_name || null);

  return res.status(200).json({ skill_type, title, product_name, content, source_count: knowledge.length });
}

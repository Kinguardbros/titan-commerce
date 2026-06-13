import { rateLimit } from '../rate-limit.js';
import { supabase } from './reviews-shared.js';

// Phase 4 — AI review generation. New prompt lives HERE, not in claude.js (sacred).

// POST: generate_reviews_ai — Claude writes N realistic reviews from product title+description.
// { store_id, product_id, count, tone } → inserts pending/source='ai' (no photo, verified=false).
// tone: 'positive' (mostly 5★) | 'mix' (realistic spread incl. occasional 3★).
export async function generate_reviews_ai(req, res) {
  if (!await rateLimit('generate_reviews', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded — try again later' });
  }
  const { store_id, product_id, count, tone } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 10); // clamp 1–10

  const { data: product, error: pErr } = await supabase.from('products')
    .select('title, description').eq('id', product_id).single();
  if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

  const ratingRule = tone === 'mix'
    ? 'Use a realistic spread: mostly 5, some 4, and occasionally one 3 with a minor critique (fit, shipping, color).'
    : 'Mostly 5 stars, occasionally 4. Positive overall.';

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content:
        `Generate ${n} realistic, varied customer reviews for this product.\n` +
        `Product: ${product.title}\nDescription: ${(product.description || '').slice(0, 800)}\n` +
        `Return ONLY a JSON array, each item: {"author","rating","title","body"}.\n` +
        `${ratingRule} Vary length and tone, mention fit/quality/shipping. Realistic first names.`,
    }],
  });

  const text = resp.content?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return res.status(502).json({ error: 'AI did not return a parseable review list' });

  let items;
  try {
    items = JSON.parse(match[0]);
  } catch (e) {
    console.error('[reviews] generate_reviews_ai JSON parse failed:', { error: e.message });
    return res.status(502).json({ error: 'AI returned malformed JSON' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = (Array.isArray(items) ? items : [])
    .filter((r) => r && r.author && r.body && r.rating >= 1 && r.rating <= 5)
    .map((r) => ({
      store_id, product_id,
      author: String(r.author), rating: parseInt(r.rating, 10),
      title: r.title ? String(r.title) : null, body: String(r.body),
      review_date: today, photo_url: null, verified: false,
      source: 'ai', status: 'pending',
    }));

  let inserted = 0;
  if (rows.length) {
    const { data, error } = await supabase.from('product_reviews').insert(rows).select('id');
    if (error) throw error;
    inserted = data?.length || 0;
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `AI-generated ${inserted} review(s) (${tone === 'mix' ? 'realistic mix' : 'positive'}) for "${product.title}"`,
  });

  return res.status(200).json({ inserted });
}

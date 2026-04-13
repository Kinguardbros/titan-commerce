import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET: read_size_chart
export async function read_size_chart(req, res) {
  const storeId = req.query.store_id;
  const productId = req.query.product_id;
  if (!storeId || !productId) return res.status(400).json({ error: 'store_id and product_id required' });

  const store = await getStore(storeId);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const { data: product } = await supabase.from('products').select('shopify_id').eq('id', productId).single();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const metafield = await client.getMetafield(product.shopify_id, 'custom', 'size_chart_text');
  return res.status(200).json({ size_chart_text: metafield?.value || null });
}

// GET: refresh_size_charts
export async function refresh_size_charts(req, res) {
  const storeId = req.query.store_id;
  if (!storeId) return res.status(400).json({ error: 'store_id required' });
  const store = await getStore(storeId);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const { data: products } = await supabase.from('products').select('id, shopify_id').eq('store_id', storeId).not('shopify_id', 'is', null);
  const client = createShopifyClient(store.shopify_url, store.admin_token);
  let updated = 0;
  for (const p of (products || [])) {
    try {
      const mf = await client.getMetafield(p.shopify_id, 'custom', 'size_chart_text');
      const has = !!(mf?.value && mf.value.length > 5);
      await supabase.from('products').update({ has_size_chart: has }).eq('id', p.id);
      if (has) updated++;
    } catch (e) { /* skip individual failures */ }
  }
  return res.status(200).json({ total: (products || []).length, with_size_chart: updated });
}

// POST: save_size_chart
export async function save_size_chart(req, res) {
  const { store_id, product_id, size_chart_text } = req.body;
  if (!store_id || !product_id || !size_chart_text) return res.status(400).json({ error: 'store_id, product_id, and size_chart_text required' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const { data: product } = await supabase.from('products').select('shopify_id, title').eq('id', product_id).single();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const result = await client.updateMetafield(product.shopify_id, 'custom', 'size_chart_text', size_chart_text);
  if (!result) return res.status(500).json({ error: 'Failed to save metafield to Shopify' });

  await supabase.from('products').update({ has_size_chart: true }).eq('id', product_id);

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART',
    message: `Updated size chart for "${product.title}"`,
    level: 'success',
  });

  return res.status(200).json({ ok: true });
}

// POST: parse_size_chart_image (Claude Vision)
export async function parse_size_chart_image(req, res) {
  const { image_url } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });

  // Build image source — handle base64 data URLs and regular URLs
  let imageSource;
  if (image_url.startsWith('data:')) {
    const match = image_url.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid data URL format' });
    imageSource = { type: 'base64', media_type: match[1], data: match[2] };
  } else {
    // Fetch remote image and convert to base64
    const imgRes = await fetch(image_url);
    if (!imgRes.ok) return res.status(400).json({ error: 'Failed to fetch image' });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    imageSource = { type: 'base64', media_type: contentType.split(';')[0], data: buf.toString('base64') };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: imageSource },
        { type: 'text', text: 'Extract the size chart from this image.\nIf sizes are in COLUMNS (horizontal), transpose them to ROWS.\nAlways return CSV format where each ROW is one size:\n\nFirst line = headers: Size, [measurement names]\nEach next line = one size with values.\n\nExample output:\nSize, Bust (cm), Waist (cm), Hips (cm)\nS, 86, 66, 91\nM, 90, 70, 95\nL, 94, 74, 99\n\nHandle transposed tables, multiple sections, and merged cells.\nReturn ONLY the CSV text, nothing else.' },
      ],
    }],
  });

  const csvText = response.content?.[0]?.text?.trim() || '';
  return res.status(200).json({ csv: csvText });
}

import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../rate-limit.js';
import { optimizeProduct } from '../claude.js';
import { updateProduct, updateVariant, updateProductOptions, getProductVariants } from '../shopify-admin.js';
import { getStore } from '../store-context.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GET: pending_optimizations
export async function pending_optimizations(req, res) {
  let query = supabase.from('product_optimizations')
    .select('id, product_id, store_id, optimized_data, created_at, product:products(title, image_url)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (req.query.store_id) query = query.eq('store_id', req.query.store_id);
  const { data, error } = await query;
  if (error) throw error;

  const result = (data || []).map((o) => ({
    optimization_id: o.id,
    product_id: o.product_id,
    product_title: o.product?.title || '',
    product_image: o.product?.image_url || '',
    optimized_title: JSON.parse(o.optimized_data)?.title || '',
    created_at: o.created_at,
  }));
  return res.status(200).json(result);
}

// POST: optimize_product
export async function optimize_product(req, res) {
  if (!await rateLimit('optimize_product', 30, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const { product_id, brand_context } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  const { data: product, error: pErr } = await supabase.from('products').select('*').eq('id', product_id).single();
  if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

  const images = JSON.parse(product.images || '[]');
  const tags = JSON.parse(product.tags || '[]');

  // Get Shopify variants
  let variants = null;
  if (product.shopify_id) {
    const shopifyProduct = await getProductVariants(product.shopify_id);
    if (shopifyProduct?.variants) {
      variants = shopifyProduct.variants.map((v) => ({
        id: v.id, option1: v.option1, option2: v.option2, option3: v.option3,
      }));
    }
  }

  const originalData = {
    title: product.title,
    description: product.description || '',
    tags,
    product_type: product.product_type,
    variants,
  };

  const optimized = await optimizeProduct({
    title: product.title,
    description: product.description || '',
    price: product.price,
    product_type: product.product_type || '',
    tags: tags.join(', '),
    image_count: images.length,
    variants,
  }, brand_context || '', product.store_id);

  // Delete any existing pending optimization for this product
  await supabase.from('product_optimizations').delete().eq('product_id', product_id).eq('status', 'pending');

  // Save as pending
  const { data: opt, error: oErr } = await supabase.from('product_optimizations').insert({
    product_id,
    status: 'pending',
    original_data: JSON.stringify(originalData),
    optimized_data: JSON.stringify(optimized),
  }).select().single();

  if (oErr) throw oErr;

  await supabase.from('pipeline_log').insert({
    agent: 'OPTIMIZER', level: 'info',
    message: `Generated optimization for ${product.title} — awaiting approval`,
  });

  return res.status(200).json({
    optimization_id: opt.id,
    product_id,
    status: 'pending',
    original: originalData,
    optimized,
  });
}

// POST: approve_optimization
export async function approve_optimization(req, res) {
  const { optimization_id, optimized } = req.body;
  if (!optimization_id) return res.status(400).json({ error: 'optimization_id required' });

  const { data: opt, error: oErr } = await supabase.from('product_optimizations')
    .select('*, product:products(shopify_id, title)').eq('id', optimization_id).single();
  if (oErr || !opt) return res.status(404).json({ error: 'Optimization not found' });
  if (opt.status !== 'pending') return res.status(400).json({ error: 'Optimization is not pending' });

  const finalData = optimized || JSON.parse(opt.optimized_data);
  const shopifyId = opt.product.shopify_id;

  await supabase.from('pipeline_log').insert({ agent: 'OPTIMIZER', level: 'info', message: `Approving & applying optimization for ${opt.product.title}` });

  // Write to Shopify — product
  const result = await updateProduct(shopifyId, finalData);
  if (!result) throw new Error('Shopify product update failed');

  // Write variants if present
  if (finalData.variants?.length > 0) {
    for (const v of finalData.variants) {
      if (v.id) {
        const variantUpdate = {};
        if (v.option1) variantUpdate.option1 = v.option1;
        if (v.option2) variantUpdate.option2 = v.option2;
        if (v.option3) variantUpdate.option3 = v.option3;
        await updateVariant(v.id, variantUpdate);
      }
    }
  }

  // Write option labels if present
  if (finalData.option_labels) {
    const options = Object.entries(finalData.option_labels).map(([key, name], i) => ({ name, position: i + 1 }));
    await updateProductOptions(shopifyId, options);
  }

  // Sync to Supabase
  const updates = {};
  if (finalData.title) updates.title = finalData.title;
  if (finalData.description) updates.description = finalData.description;
  if (finalData.product_type) updates.product_type = finalData.product_type;
  if (finalData.tags) updates.tags = JSON.stringify(finalData.tags);
  await supabase.from('products').update(updates).eq('id', opt.product_id);

  // Update optimization status
  await supabase.from('product_optimizations').update({
    status: 'approved', approved_by: 'Team', approved_at: new Date().toISOString(),
    optimized_data: JSON.stringify(finalData),
  }).eq('id', optimization_id);

  await supabase.from('pipeline_log').insert({ agent: 'OPTIMIZER', level: 'info', message: `Approved & applied optimization for ${finalData.title || opt.product.title}` });

  return res.status(200).json({ success: true, shopify_id: shopifyId });
}

// POST: reject_optimization
export async function reject_optimization(req, res) {
  const { optimization_id, reason } = req.body;
  if (!optimization_id) return res.status(400).json({ error: 'optimization_id required' });

  const { data: opt } = await supabase.from('product_optimizations').select('product:products(title)').eq('id', optimization_id).single();

  await supabase.from('product_optimizations').update({
    status: 'rejected', rejected_reason: reason || '',
  }).eq('id', optimization_id);

  await supabase.from('pipeline_log').insert({
    agent: 'OPTIMIZER', level: 'warn',
    message: `Rejected optimization for ${opt?.product?.title || 'unknown'}${reason ? ': ' + reason : ''}`,
  });

  return res.status(200).json({ success: true });
}

// POST: save_optimization
export async function save_optimization(req, res) {
  const { optimization_id, optimized } = req.body;
  if (!optimization_id || !optimized) return res.status(400).json({ error: 'optimization_id and optimized required' });

  await supabase.from('product_optimizations').update({
    optimized_data: JSON.stringify(optimized),
  }).eq('id', optimization_id).eq('status', 'pending');

  return res.status(200).json({ success: true });
}

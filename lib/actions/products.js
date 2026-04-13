import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { optimizeProduct } from '../claude.js';
import { scrapeProduct, scrapeCollectionUrls } from '../scraper-utils.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function product_detail(req, res) {
  const storeId = req.query.store_id;
  const productId = req.query.product_id;
  if (!storeId || !productId) return res.status(400).json({ error: 'store_id and product_id required' });

  const { data: dbProduct } = await supabase.from('products').select('*').eq('id', productId).single();
  if (!dbProduct) return res.status(404).json({ error: 'Product not found' });

  const store = await getStore(storeId);

  // If no shopify_id or no admin token, return DB-only data
  if (!dbProduct.shopify_id || !store?.admin_token) {
    const imgs = JSON.parse(dbProduct.images || '[]');
    return res.status(200).json({
      product: {
        id: dbProduct.shopify_id, title: dbProduct.title, body_html: dbProduct.description || '',
        vendor: '', product_type: dbProduct.product_type || '', tags: dbProduct.tags || '',
        status: 'active', variants: [], images: imgs.map((src, i) => ({ id: i, src, position: i + 1 })),
      },
      metafields: [],
      db_only: true,
    });
  }

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  try {
    const [fullProduct, metafields] = await Promise.all([
      client.getFullProduct(dbProduct.shopify_id),
      client.getProductMetafields(dbProduct.shopify_id),
    ]);
    if (!fullProduct) throw new Error('Shopify returned no product');
    return res.status(200).json({ product: fullProduct, metafields });
  } catch (shopifyErr) {
    console.error('[product_detail] Shopify fetch failed, returning DB data:', shopifyErr.message);
    const imgs = JSON.parse(dbProduct.images || '[]');
    return res.status(200).json({
      product: {
        id: dbProduct.shopify_id, title: dbProduct.title, body_html: dbProduct.description || '',
        vendor: '', product_type: dbProduct.product_type || '', tags: dbProduct.tags || '',
        status: 'active', variants: [], images: imgs.map((src, i) => ({ id: i, src, position: i + 1 })),
      },
      metafields: [],
      db_only: true,
    });
  }
}

export async function scrape_product(req, res) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const isCollection = url.includes('/collections/') && !url.includes('/products/');

  if (isCollection) {
    const productUrls = await scrapeCollectionUrls(url, 10);
    const products = [];
    for (const pUrl of productUrls) {
      try {
        const scraped = await scrapeProduct(pUrl);
        products.push({
          title: scraped.product_name,
          price: scraped.price?.replace(/[^0-9.]/g, '') || '',
          description: scraped.description,
          images: scraped.image_urls,
          features: scraped.features,
          url: scraped.url,
        });
      } catch (scrapeErr) {
        console.error('[system/scrape_product] Failed to scrape:', pUrl, scrapeErr.message);
      }
    }
    return res.status(200).json({ mode: 'collection', products });
  }

  const scraped = await scrapeProduct(url);
  return res.status(200).json({
    mode: 'single',
    product: {
      title: scraped.product_name,
      price: scraped.price?.replace(/[^0-9.]/g, '') || '',
      description: scraped.description,
      images: scraped.image_urls,
      features: scraped.features,
      url: scraped.url,
    },
  });
}

export async function import_confirm(req, res) {
  const { store_id, product_data, auto_optimize, auto_generate, generate_count } = req.body;
  if (!store_id || !product_data?.title) return res.status(400).json({ error: 'store_id and product_data.title are required' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token — cannot create products' });
  const client = createShopifyClient(store.shopify_url, store.admin_token);

  // 1. Create in Shopify
  const shopifyResult = await client.createProduct(product_data);
  if (!shopifyResult?.product) {
    return res.status(500).json({ error: 'Failed to create product in Shopify' });
  }
  const shopifyProduct = shopifyResult.product;
  // 2. Save to Supabase products table
  const { data: dbProduct, error: dbErr } = await supabase.from('products').insert({
    store_id,
    shopify_id: String(shopifyProduct.id),
    handle: shopifyProduct.handle,
    title: shopifyProduct.title,
    price: product_data.price || null,
    image_url: shopifyProduct.images?.[0]?.src || null,
    product_type: product_data.product_type || null,
    tags: JSON.stringify(product_data.tags || []),
    images: JSON.stringify(shopifyProduct.images?.map((i) => i.src) || []),
  }).select().single();
  if (dbErr) {
    console.error('[system/import_confirm] DB insert error:', dbErr);
    return res.status(500).json({ error: 'Product created in Shopify but failed to save to database' });
  }
  // Pipeline log
  await supabase.from('pipeline_log').insert({
    store_id,
    agent: 'IMPORTER',
    message: `Imported "${shopifyProduct.title}" from external URL → Shopify #${shopifyProduct.id}`,
    level: 'success',
    metadata: { shopify_id: shopifyProduct.id, source_url: product_data.source_url },
  });
  let optimizationPending = false;
  let creativesCount = 0;
  // 3. Auto-optimize
  if (auto_optimize) {
    try {
      const brandContext = store.brand_config?.brand_prompt || '';
      const optimized = await optimizeProduct({
        title: shopifyProduct.title,
        description: shopifyProduct.body_html || '',
        price: product_data.price || '',
        product_type: product_data.product_type || '',
        tags: (product_data.tags || []).join(', '),
        image_count: shopifyProduct.images?.length || 0,
      }, brandContext, store_id);
      if (optimized) {
        await supabase.from('product_optimizations').insert({
          product_id: dbProduct.id,
          store_id,
          status: 'pending',
          original: {
            title: shopifyProduct.title,
            description: shopifyProduct.body_html || '',
            product_type: product_data.product_type || '',
            tags: product_data.tags || [],
          },
          optimized,
        });
        optimizationPending = true;
        await supabase.from('pipeline_log').insert({
          store_id, agent: 'IMPORTER',
          message: `Auto-optimized "${shopifyProduct.title}" — pending approval`,
          level: 'info',
        });
      }
    } catch (optErr) {
      console.error('[system/import_confirm] Auto-optimize error:', optErr.message);
      await supabase.from('pipeline_log').insert({
        store_id, agent: 'IMPORTER',
        message: `Auto-optimize failed for "${shopifyProduct.title}": ${optErr.message}`,
        level: 'error',
      });
    }
  }

  // 4. Auto-generate creatives
  if (auto_generate) {
    const count = Math.min(generate_count || 4, 6);
    const styles = ['ad_creative', 'lifestyle'];
    try {
      for (let i = 0; i < count; i++) {
        const style = styles[i % styles.length];
        await supabase.from('creatives').insert({
          product_id: dbProduct.id,
          store_id,
          status: 'generating',
          style,
          format: 'image',
          variant_index: i + 1,
        });
        creativesCount++;
      }
      await supabase.from('pipeline_log').insert({
        store_id, agent: 'IMPORTER',
        message: `Queued ${creativesCount} creatives for "${shopifyProduct.title}"`,
        level: 'info',
      });
    } catch (genErr) {
      console.error('[system/import_confirm] Auto-generate error:', genErr.message);
    }
  }

  return res.status(200).json({
    product_id: dbProduct.id,
    shopify_id: shopifyProduct.id,
    title: shopifyProduct.title,
    optimization_pending: optimizationPending,
    creatives_count: creativesCount,
  });
}

export async function update_product_full(req, res) {
  const { store_id, product_id, updates } = req.body;
  if (!store_id || !product_id || !updates) return res.status(400).json({ error: 'store_id, product_id, and updates required' });
  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  const { data: product } = await supabase.from('products').select('shopify_id, title').eq('id', product_id).single();
  if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });
  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const changes = [];
  const before = await client.getFullProduct(product.shopify_id);
  // Update main product fields
  const productFields = {};
  for (const key of ['title', 'body_html', 'vendor', 'product_type', 'tags', 'status']) {
    if (updates[key] !== undefined) {
      productFields[key] = updates[key];
      changes.push(key);
    }
  }
  if (updates.seo_title !== undefined) { productFields.metafields_global_title_tag = updates.seo_title; changes.push('seo_title'); }
  if (updates.seo_description !== undefined) { productFields.metafields_global_description_tag = updates.seo_description; changes.push('seo_description'); }
  if (Object.keys(productFields).length > 0) {
    const result = await client.updateProduct(product.shopify_id, productFields);
    if (!result) return res.status(500).json({ error: 'Failed to update product in Shopify' });
  }
  if (updates.variants?.length > 0) {
    for (const v of updates.variants) {
      if (v.id) {
        const variantUpdates = {};
        if (v.price !== undefined) variantUpdates.price = v.price;
        if (v.compare_at_price !== undefined) variantUpdates.compare_at_price = v.compare_at_price;
        if (v.sku !== undefined) variantUpdates.sku = v.sku;
        await client.updateVariant(v.id, variantUpdates);
        changes.push(`variant_${v.id}`);
      }
    }
  }
  if (updates.metafields?.length > 0) {
    for (const mf of updates.metafields) {
      await client.updateMetafield(product.shopify_id, mf.namespace, mf.key, mf.value, mf.type || 'multi_line_text_field');
      changes.push(`metafield_${mf.namespace}.${mf.key}`);
    }
  }
  if (updates.images) {
    await client.updateProductImages(product.shopify_id, updates.images);
    changes.push('images');
  }

  // Sync title/price back to Supabase
  const supabaseUpdates = {};
  if (updates.title) supabaseUpdates.title = updates.title;
  if (updates.product_type) supabaseUpdates.product_type = updates.product_type;
  if (updates.tags) supabaseUpdates.tags = JSON.stringify(Array.isArray(updates.tags) ? updates.tags : updates.tags.split(',').map((t) => t.trim()));
  if (Object.keys(supabaseUpdates).length > 0) {
    await supabase.from('products').update(supabaseUpdates).eq('id', product_id);
  }

  // Pipeline log with before/after audit trail
  await supabase.from('pipeline_log').insert({
    store_id, agent: 'EDITOR',
    message: `Updated "${product.title}": ${changes.join(', ')}`,
    level: 'info',
    metadata: {
      product_id, changes,
      before: before ? { title: before.title, body_html: before.body_html, tags: before.tags, status: before.status } : null,
      after: updates,
    },
  });

  return res.status(200).json({ ok: true, changes });
}

export async function bulk_price(req, res) {
  const { store_id, product_shopify_ids, new_price } = req.body;
  if (!store_id || !product_shopify_ids?.length || !new_price) return res.status(400).json({ error: 'store_id, product_shopify_ids, new_price required' });
  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token', hint: 'Bulk pricing requires Shopify Admin API access.' });
  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const updated = await client.bulkUpdateVariantPrices(product_shopify_ids, new_price);
  // Sync prices in Supabase
  for (const sid of product_shopify_ids) {
    await supabase.from('products').update({ price: new_price }).eq('shopify_id', sid);
  }
  await supabase.from('pipeline_log').insert({ agent: 'PRICING', level: 'info', store_id, message: `Bulk updated ${updated} variants across ${product_shopify_ids.length} products to $${new_price}` });
  return res.status(200).json({ success: true, variants_updated: updated, products: product_shopify_ids.length });
}

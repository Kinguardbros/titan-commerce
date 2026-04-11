import { createClient } from '@supabase/supabase-js';
import { getRevenueSummary, getRecentOrders, updateProduct, updateVariant, updateProductOptions, getProductVariants, createShopifyClient, isConnected, getTopProductsWithCreatives } from '../lib/shopify-admin.js';
import { buildStyledPrompt } from '../lib/higgsfield.js';
import { optimizeProduct } from '../lib/claude.js';
import { withAuth } from '../lib/auth.js';
import { rateLimit } from '../lib/rate-limit.js';
import { getAllStores, getStore } from '../lib/store-context.js';
import { scrapeProduct, scrapeCollectionUrls } from '../lib/scraper-utils.js';
import { isConnected as isMetaConnected, getAccountInsights, getCampaigns, getActiveAdsCount } from '../lib/meta-api.js';
import { extractText, classifyDocument, extractInsights } from '../lib/doc-processor.js';
const DOCS_BUCKET = 'store-docs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function handler(req, res) {
  const action = req.query.action || req.body?.action;

  try {
    // ═══ GET actions ═══
    if (req.method === 'GET') {

      if (action === 'stores_list') {
        const stores = await getAllStores();
        return res.status(200).json(stores);
      }

      if (action === 'pipeline_log') {
        let query = supabase.from('pipeline_log').select('*').order('created_at', { ascending: false }).limit(50);
        if (req.query.store_id) query = query.eq('store_id', req.query.store_id);
        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (action === 'kpi') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: perf } = await supabase.from('performance').select('spend, revenue, impressions, conversions').gte('date', sevenDaysAgo.toISOString().split('T')[0]);
        const totals = (perf || []).reduce((acc, row) => ({
          spend: acc.spend + Number(row.spend || 0), revenue: acc.revenue + Number(row.revenue || 0),
          impressions: acc.impressions + (row.impressions || 0), conversions: acc.conversions + (row.conversions || 0),
        }), { spend: 0, revenue: 0, impressions: 0, conversions: 0 });
        const { count: activeAds } = await supabase.from('ads').select('id', { count: 'exact', head: true }).eq('status', 'active');
        return res.status(200).json({ ...totals, activeAds: activeAds || 0 });
      }

      if (action === 'profit_summary') {
        const days = parseInt(req.query.days) || 7;
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split('T')[0];

        // Shopify orders for revenue + COGS
        const shopifyData = await getRevenueSummary(days);

        // Get detailed orders for daily breakdown
        const ordersResp = await getRecentOrders(250);

        // Get all products with COGS
        const { data: products } = await supabase.from('products').select('title, cogs');
        const cogsMap = {};
        (products || []).forEach((p) => { if (p.cogs) cogsMap[p.title] = parseFloat(p.cogs); });
        const missingCogs = (products || []).filter((p) => !p.cogs).length;

        // Get Meta adspend from performance table
        const { data: metaPerf } = await supabase.from('performance').select('date, spend').gte('date', sinceStr);

        // Get manual adspend
        const { data: manualSpend } = await supabase.from('manual_adspend').select('*').gte('date', sinceStr);

        // Build daily breakdown
        const dailyMap = {};
        const filteredOrders = (ordersResp || []).filter((o) => o.created_at >= since.toISOString());

        for (const order of filteredOrders) {
          const date = order.created_at.split('T')[0];
          if (!dailyMap[date]) dailyMap[date] = { date, revenue: 0, cogs: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0, transaction_fees: 0 };
          dailyMap[date].revenue += order.total;
          // COGS from line items
          for (const item of order.items || []) {
            const unitCost = cogsMap[item.title] || 0;
            dailyMap[date].cogs += unitCost * item.quantity;
          }
          // Transaction fees ~3.5% of revenue (Shopify Payments typical)
          dailyMap[date].transaction_fees += order.total * 0.035;
        }

        // Add Meta adspend
        for (const p of metaPerf || []) {
          const date = p.date;
          if (!dailyMap[date]) dailyMap[date] = { date, revenue: 0, cogs: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0, transaction_fees: 0 };
          dailyMap[date].adspend_meta += Number(p.spend || 0);
        }

        // Add manual adspend
        for (const m of manualSpend || []) {
          const date = m.date;
          if (!dailyMap[date]) dailyMap[date] = { date, revenue: 0, cogs: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0, transaction_fees: 0 };
          if (m.channel === 'tiktok') dailyMap[date].adspend_tiktok += Number(m.amount);
          else if (m.channel === 'pinterest') dailyMap[date].adspend_pinterest += Number(m.amount);
          else dailyMap[date].adspend_manual += Number(m.amount);
        }

        // Calculate profit for each day
        const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
          const adspend_total = d.adspend_meta + d.adspend_tiktok + d.adspend_pinterest + d.adspend_manual;
          const profit = d.revenue - d.cogs - adspend_total - d.transaction_fees;
          return {
            ...d,
            cogs: Math.round(d.cogs * 100) / 100,
            transaction_fees: Math.round(d.transaction_fees * 100) / 100,
            profit: Math.round(profit * 100) / 100,
            roas: adspend_total > 0 ? Math.round((d.revenue / adspend_total) * 100) / 100 : 0,
            profit_pct: d.revenue > 0 ? Math.round((profit / d.revenue) * 10000) / 100 : 0,
          };
        });

        // Totals
        const totals = daily.reduce((acc, d) => ({
          revenue: acc.revenue + d.revenue,
          cogs: acc.cogs + d.cogs,
          adspend_meta: acc.adspend_meta + d.adspend_meta,
          adspend_tiktok: acc.adspend_tiktok + d.adspend_tiktok,
          adspend_pinterest: acc.adspend_pinterest + d.adspend_pinterest,
          transaction_fees: acc.transaction_fees + d.transaction_fees,
          profit: acc.profit + d.profit,
        }), { revenue: 0, cogs: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, transaction_fees: 0, profit: 0 });

        const adspend_total = totals.adspend_meta + totals.adspend_tiktok + totals.adspend_pinterest;

        return res.status(200).json({
          days,
          daily,
          totals: {
            ...totals,
            adspend_total: Math.round(adspend_total * 100) / 100,
            roas: adspend_total > 0 ? Math.round((totals.revenue / adspend_total) * 100) / 100 : 0,
            profit_pct: totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 10000) / 100 : 0,
          },
          missing_cogs: missingCogs,
        });
      }

      if (action === 'pending_optimizations') {
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

      if (action === 'insights') {
        const storeId = req.query.store_id;
        let getTopFn = getTopProductsWithCreatives;
        let connected = isConnected();
        if (storeId) {
          const store = await getStore(storeId);
          if (store?.admin_token) {
            const client = createShopifyClient(store.shopify_url, store.admin_token);
            getTopFn = client.getTopProductsWithCreatives;
            connected = true;
          } else connected = false;
        }
        if (!connected) return res.status(200).json({ connected: false, action_needed: [], declining: [], winners: [], pipeline_summary: { pending: 0, generating: 0, approved: 0 } });
        const topProducts = await getTopFn(7, 20);
        const action_needed = topProducts.filter((p) => p.units > 0 && p.creative_count === 0).map((p) => ({ title: p.title, revenue: p.revenue, units: p.units, creative_count: 0, product_id: p.product_id }));
        const declining = topProducts.filter((p) => p.trend !== null && parseInt(p.trend) < -10 && p.creative_count > 0).map((p) => ({ title: p.title, revenue: p.revenue, trend: p.trend + '%', creative_count: p.creative_count, product_id: p.product_id }));
        const winners = topProducts.filter((p) => p.trend !== null && parseInt(p.trend) > 15).sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((p) => ({ title: p.title, revenue: p.revenue, trend: '+' + p.trend + '%', creative_count: p.creative_count, product_id: p.product_id }));
        let pQ = supabase.from('creatives').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        let gQ = supabase.from('creatives').select('*', { count: 'exact', head: true }).eq('status', 'generating');
        let aQ = supabase.from('creatives').select('*', { count: 'exact', head: true }).eq('status', 'approved');
        if (storeId) { pQ = pQ.eq('store_id', storeId); gQ = gQ.eq('store_id', storeId); aQ = aQ.eq('store_id', storeId); }
        const [{ count: pC }, { count: gC }, { count: aC }] = await Promise.all([pQ, gQ, aQ]);
        return res.status(200).json({ connected: true, action_needed, declining, winners, pipeline_summary: { pending: pC || 0, generating: gC || 0, approved: aC || 0 } });
      }

      if (action === 'proposals_list') {
        const storeId = req.query.store_id;
        const status = req.query.status || 'pending';
        let query = supabase.from('proposals')
          .select('*, product:products(title, image_url), event:events(type, severity)')
          .eq('status', status)
          .order('created_at', { ascending: false });
        if (storeId) query = query.eq('store_id', storeId);
        // Exclude expired
        query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json(data || []);
      }

      // ─── READ SIZE CHART ───
      if (action === 'read_size_chart') {
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

      // ─── PRODUCT DETAIL (full Shopify data) ───
      if (action === 'product_detail') {
        const storeId = req.query.store_id;
        const productId = req.query.product_id;
        if (!storeId || !productId) return res.status(400).json({ error: 'store_id and product_id required' });

        const store = await getStore(storeId);
        if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

        const { data: product } = await supabase.from('products').select('shopify_id').eq('id', productId).single();
        if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

        const client = createShopifyClient(store.shopify_url, store.admin_token);
        const [fullProduct, metafields] = await Promise.all([
          client.getFullProduct(product.shopify_id),
          client.getProductMetafields(product.shopify_id),
        ]);

        return res.status(200).json({ product: fullProduct, metafields });
      }

      // ─── STORE DOCS (Supabase Storage) ───
      if (action === 'store_docs') {
        const storeName = req.query.store_name;
        if (!storeName) return res.status(400).json({ error: 'store_name required' });

        async function listRecursive(prefix) {
          const { data, error } = await supabase.storage.from(DOCS_BUCKET).list(prefix, { sortBy: { column: 'name', order: 'asc' } });
          if (error || !data) return [];
          const items = [];
          for (const item of data) {
            if (item.name === '.emptyFolderPlaceholder') continue;
            const itemPath = prefix ? `${prefix}${item.name}` : item.name;
            if (item.id === null) {
              // folder
              const children = await listRecursive(`${itemPath}/`);
              items.push({ name: item.name, type: 'folder', path: itemPath, children });
            } else {
              const ext = item.name.includes('.') ? '.' + item.name.split('.').pop().toLowerCase() : '';
              items.push({ name: item.name, type: 'file', path: itemPath, ext, size: item.metadata?.size || 0 });
            }
          }
          // Sort: folders first, then files
          items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
          return items;
        }

        const tree = await listRecursive(`${storeName}/`);
        return res.status(200).json({ tree });
      }

      // ─── STORE DOCS DOWNLOAD URL ───
      if (action === 'store_docs_download') {
        const storeName = req.query.store_name;
        const filePath = req.query.file_path;
        if (!storeName || !filePath) return res.status(400).json({ error: 'store_name and file_path required' });

        // Path traversal check
        if (filePath.includes('..')) return res.status(403).json({ error: 'Access denied' });

        const fullPath = `${storeName}/${filePath}`;
        const { data } = supabase.storage.from(DOCS_BUCKET).getPublicUrl(fullPath);
        return res.status(200).json({ url: data?.publicUrl });
      }

      // ─── GENERATE SKILL (compiled brand knowledge) ───
      if (action === 'generate_skill') {
        const storeId = req.query.store_id;
        if (!storeId) return res.status(400).json({ error: 'store_id required' });

        const store = await getStore(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { data: knowledge } = await supabase.from('store_knowledge')
          .select('source_file, category, insights, processed_at')
          .eq('store_id', storeId)
          .order('processed_at', { ascending: false });

        if (!knowledge?.length) {
          return res.status(200).json({ markdown: null, doc_count: 0, insight_count: 0 });
        }

        // Group by category
        const grouped = {};
        for (const k of knowledge) {
          if (!grouped[k.category]) grouped[k.category] = [];
          grouped[k.category].push(k.insights);
        }
        const groupedText = Object.entries(grouped)
          .map(([cat, insights]) => `## ${cat}\n${insights.join('\n')}`)
          .join('\n\n');

        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 3000,
          messages: [{
            role: 'user',
            content: `You are compiling a brand knowledge document from extracted insights.
Store: ${store.name}

Insights by category:
${groupedText}

Generate a structured brand knowledge document with these sections:
- Brand Positioning
- Target Audience & Personas
- Product Knowledge
- Creative Direction
- Winning Hooks & Copy
- Visual Direction

Use only the insights provided. Be specific, not generic. Use markdown formatting with ## headings and bullet points. Skip sections that have no relevant data.`,
          }],
        });

        const markdown = response.content[0].text;
        const insightCount = knowledge.reduce((s, k) => s + (k.insights.match(/^[-•*]/gm) || []).length, 0);

        return res.status(200).json({
          markdown,
          doc_count: knowledge.length,
          insight_count: insightCount,
          sources: [...new Set(knowledge.map((k) => k.source_file))],
        });
      }

      // ─── META OVERVIEW ───
      if (action === 'meta_overview') {
        if (!isMetaConnected()) return res.status(200).json({ connected: false });
        const [insights, campaigns, activeAds] = await Promise.all([
          getAccountInsights('last_7d'), getCampaigns(), getActiveAdsCount(),
        ]);
        return res.status(200).json({ connected: true, insights, campaigns, active_ads: activeAds });
      }

      return res.status(400).json({ error: 'Unknown GET action' });
    }

    // ═══ POST actions ═══
    if (req.method === 'POST') {

      if (action === 'update_creative') {
        const { creative_id, hook_used, headline } = req.body;
        if (!creative_id) return res.status(400).json({ error: 'creative_id required' });
        const updates = {};
        if (hook_used !== undefined) updates.hook_used = hook_used;
        if (headline !== undefined) updates.headline = headline;
        if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields' });
        const { data, error } = await supabase.from('creatives').update(updates).eq('id', creative_id).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (action === 'update_cogs') {
        const { product_id, cogs } = req.body;
        if (!product_id || cogs === undefined) return res.status(400).json({ error: 'product_id and cogs required' });
        const { data, error } = await supabase.from('products').update({ cogs: parseFloat(cogs) }).eq('id', product_id).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (action === 'manual_adspend') {
        const { date, channel, amount } = req.body;
        if (!date || !channel || amount === undefined) return res.status(400).json({ error: 'date, channel, amount required' });
        const { data, error } = await supabase.from('manual_adspend').upsert({ date, channel, amount: parseFloat(amount) }, { onConflict: 'date,channel' }).select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }

      if (action === 'optimize_product') {
        if (!rateLimit('optimize_product', 30, 3600000)) {
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
        }, brand_context || '');

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

      if (action === 'approve_optimization') {
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

      if (action === 'reject_optimization') {
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

      if (action === 'save_optimization') {
        const { optimization_id, optimized } = req.body;
        if (!optimization_id || !optimized) return res.status(400).json({ error: 'optimization_id and optimized required' });

        await supabase.from('product_optimizations').update({
          optimized_data: JSON.stringify(optimized),
        }).eq('id', optimization_id).eq('status', 'pending');

        return res.status(200).json({ success: true });
      }

      if (action === 'generate_branded') {
        if (!rateLimit('generate_branded', 20, 3600000)) {
          return res.status(429).json({ error: 'Rate limit exceeded' });
        }
        const { store_id, type = 'branded_lifestyle', prompt, style = 'lifestyle', show_model = true } = req.body;
        if (!store_id || !prompt) return res.status(400).json({ error: 'store_id and prompt required' });

        const store = await getStore(store_id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const brandName = store.name || 'Brand';
        const brandConfig = typeof store.brand_config === 'string' ? JSON.parse(store.brand_config || '{}') : (store.brand_config || {});

        // Build store-specific brand context
        const BRAND_CONTEXTS = {
          'elegance-house': `BRAND: Elegance House — elegant women's fashion for women 35-60. Warm gold tones (#d4a853), cream backgrounds (#f5f0e8), professional studio or lifestyle settings. Sophisticated, timeless, confident. Model: woman 35-55, approachable, not model-perfect.`,
          'isola': `BRAND: Isola World — tummy-control swimwear for women 30-55. Ocean blues, warm sand tones, coral accents. Beach, poolside, resort settings, golden hour lighting. Natural curvy body (size 10-18), authentic and confident. Vacation vibes, not fashion shoot.`,
        };
        const brandContext = BRAND_CONTEXTS[store.slug] || brandConfig.brand_voice || `BRAND: ${brandName}`;
        const logoNote = brandConfig.logo_white ? `Brand logo available at: ${brandConfig.logo_white}` : '';

        const contextualPrompt = `[${brandContext}${logoNote ? `\n${logoNote}` : ''}]\n\nUser request: ${prompt}`;

        const fullPrompt = await buildStyledPrompt({
          product_name: brandName,
          price: '',
          style,
          custom_prompt: contextualPrompt,
          showModel: show_model,
          feedback: '',
          storeId: store_id,
        });

        // Use store logo as input_image for branded banners/social (adds brand identity)
        const inputImages = [];
        const logoUrl = brandConfig.logo_white || brandConfig.logo_black;
        if (logoUrl && (type === 'branded_banner' || type === 'branded_social')) {
          inputImages.push({ type: 'image_url', image_url: logoUrl });
        }

        const POLL_INTERVAL = 2000;
        const MAX_POLL = 55000;
        async function pollDone(rid) {
          const creds = process.env.HF_CREDENTIALS;
          const hdrs = { 'Authorization': `Key ${creds}`, 'User-Agent': 'higgsfield-server-js/2.0' };
          const start = Date.now();
          while (Date.now() - start < MAX_POLL) {
            const r = await fetch(`https://platform.higgsfield.ai/requests/${rid}/status`, { headers: hdrs });
            const d = await r.json();
            if (d.status === 'completed') return d.images?.[0]?.url || d.video?.url;
            if (d.status === 'failed' || d.status === 'nsfw') return null;
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          }
          return null;
        }

        const { higgsfield } = await import('@higgsfield/client/v2');
        const jobSet = await higgsfield.subscribe('/v1/text2image/nano-banana', {
          input: { params: { prompt: fullPrompt, input_images: inputImages, aspect_ratio: '1:1' } },
          withPolling: false,
        });
        const imageUrl = await pollDone(jobSet.id);
        if (!imageUrl) throw new Error('Generation failed');

        const storagePath = `creatives/${store.slug}_branded_${Date.now()}.png`;
        let fileUrl = imageUrl;
        try {
          const imgResp = await fetch(imageUrl);
          const buf = await imgResp.arrayBuffer();
          await supabase.storage.from('creatives').upload(storagePath, buf, { contentType: 'image/png', upsert: true });
          const { data: pub } = supabase.storage.from('creatives').getPublicUrl(storagePath);
          fileUrl = pub.publicUrl;
        } catch (storageErr) {
          console.error('[generate_branded] Storage upload failed:', storageErr);
        }

        const { data: creative, error: cErr } = await supabase.from('creatives').insert({
          store_id, product_id: null, variant_index: 1, format: 'image',
          file_url: fileUrl, storage_path: storagePath,
          hook_used: prompt, headline: `${brandName} — ${type.replace('branded_', '')}`,
          hf_job_id: jobSet.id, status: 'pending', style, type,
        }).select().single();
        if (cErr) throw cErr;

        await supabase.from('pipeline_log').insert({ agent: 'FORGE', level: 'info', store_id, message: `Generated branded ${type} for ${brandName}` });

        return res.status(200).json({ creative_id: creative.id, generated: 1 });
      }

      // ═══ PROPOSALS ═══

      if (action === 'approve_proposal') {
        const { proposal_id } = req.body;
        if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
        const { data: proposal, error: pErr } = await supabase.from('proposals').select('*').eq('id', proposal_id).single();
        if (pErr || !proposal) return res.status(404).json({ error: 'Proposal not found' });
        if (proposal.status !== 'pending') return res.status(400).json({ error: 'Proposal is not pending' });

        // Execute the suggested action
        const sa = proposal.suggested_action;
        let execMsg = '';
        if (sa.action === 'generate' && sa.product_id) {
          // Generate creatives for each style
          const styles = sa.styles || ['ad_creative'];
          for (const style of styles) {
            try {
              const { data: product } = await supabase.from('products').select('*').eq('id', sa.product_id).single();
              if (product) {
                const images = JSON.parse(product.images || '[]');
                const prompt = await buildStyledPrompt({ product_name: product.title, price: product.price ? `$${product.price}` : '', style, custom_prompt: '', showModel: true, feedback: '', storeId: product.store_id });
                const { higgsfield } = await import('@higgsfield/client/v2');
                const jobSet = await higgsfield.subscribe('/v1/text2image/nano-banana', { input: { params: { prompt, input_images: images.slice(0, 1).map(u => ({ type: 'image_url', image_url: u })), aspect_ratio: '1:1' } }, withPolling: false });
                // Don't wait for completion — just queue it
                await supabase.from('creatives').insert({ product_id: sa.product_id, store_id: proposal.store_id, variant_index: 1, format: 'image', file_url: null, hook_used: style, headline: product.title, hf_job_id: jobSet.id, status: 'generating', style });
              }
            } catch (genErr) { console.error('[proposal] Generate failed:', genErr); }
          }
          execMsg = `Queued ${styles.length} creatives for generation`;
        }

        await supabase.from('proposals').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', proposal_id);
        if (proposal.event_id) await supabase.from('events').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', proposal.event_id);
        await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id: proposal.store_id, message: `Executed: ${proposal.title}` });
        return res.status(200).json({ success: true, message: execMsg || `Executed: ${proposal.title}` });
      }

      if (action === 'reject_proposal') {
        const { proposal_id, reason } = req.body;
        if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
        const { data: proposal } = await supabase.from('proposals').select('title, event_id, store_id').eq('id', proposal_id).single();
        await supabase.from('proposals').update({ status: 'rejected', rejected_reason: reason || '' }).eq('id', proposal_id);
        if (proposal?.event_id) await supabase.from('events').update({ status: 'dismissed' }).eq('id', proposal.event_id);
        await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'warn', store_id: proposal?.store_id, message: `Dismissed: ${proposal?.title}${reason ? ' — ' + reason : ''}` });
        return res.status(200).json({ success: true });
      }

      if (action === 'approve_all_proposals') {
        const { proposal_ids } = req.body;
        if (!proposal_ids?.length) return res.status(400).json({ error: 'proposal_ids required' });
        let executed = 0;
        for (const pid of proposal_ids) {
          try {
            // Recursive call to approve_proposal logic — simplified: just mark as executed
            const { data: p } = await supabase.from('proposals').select('*').eq('id', pid).eq('status', 'pending').single();
            if (!p) continue;
            await supabase.from('proposals').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', pid);
            if (p.event_id) await supabase.from('events').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', p.event_id);
            await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id: p.store_id, message: `Bulk executed: ${p.title}` });
            executed++;
          } catch (e) { console.error('[approve_all]', e); }
        }
        return res.status(200).json({ success: true, executed });
      }

      if (action === 'scan_events') {
        const { store_id } = req.body;
        if (!store_id) return res.status(400).json({ error: 'store_id required' });
        const store = await getStore(store_id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        let eventsCreated = 0;
        let proposalsCreated = 0;

        // Get top products with creative counts (only if admin token)
        if (store.admin_token) {
          const client = createShopifyClient(store.shopify_url, store.admin_token);
          const topProducts = await client.getTopProductsWithCreatives(7, 30);

          for (const p of topProducts) {
            // product_no_creatives
            if (p.units > 0 && p.creative_count === 0 && p.product_id) {
              const { data: existing } = await supabase.from('events').select('id').eq('store_id', store_id).eq('product_id', p.product_id).eq('type', 'product_no_creatives').in('status', ['new', 'proposal_created']).limit(1).single();
              if (!existing) {
                const { data: evt } = await supabase.from('events').insert({ store_id, type: 'product_no_creatives', product_id: p.product_id, severity: 'high', title: `${p.title} has no creatives`, description: `Sold ${p.units} units but has 0 creatives`, metadata: JSON.stringify({ revenue: p.revenue, units: p.units }) }).select().single();
                if (evt) {
                  await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
                  await supabase.from('proposals').insert({ store_id, event_id: evt.id, type: 'generate_creatives', product_id: p.product_id, title: `Generate creatives for "${p.title}"`, description: `${p.units} units sold, 0 creatives. Styles: ad_creative, lifestyle`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative', 'lifestyle'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
                  eventsCreated++; proposalsCreated++;
                }
              }
            }

            // revenue_declining
            if (p.trend !== null && parseInt(p.trend) < -10 && p.creative_count > 0 && p.product_id) {
              const { data: existing } = await supabase.from('events').select('id').eq('store_id', store_id).eq('product_id', p.product_id).eq('type', 'revenue_declining').in('status', ['new', 'proposal_created']).limit(1).single();
              if (!existing) {
                const { data: evt } = await supabase.from('events').insert({ store_id, type: 'revenue_declining', product_id: p.product_id, severity: 'medium', title: `${p.title} revenue declining (${p.trend}%)`, description: `Revenue dropped ${p.trend}% vs previous period`, metadata: JSON.stringify({ revenue: p.revenue, trend: p.trend }) }).select().single();
                if (evt) {
                  await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
                  await supabase.from('proposals').insert({ store_id, event_id: evt.id, type: 'try_different_style', product_id: p.product_id, title: `Try new style for "${p.title}"`, description: `Revenue ${p.trend}%. Try lifestyle or UGC style.`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 2, styles: ['lifestyle'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
                  eventsCreated++; proposalsCreated++;
                }
              }
            }

            // winner_detected
            if (p.trend !== null && parseInt(p.trend) > 15 && p.revenue > 100 && p.product_id) {
              const { data: existing } = await supabase.from('events').select('id').eq('store_id', store_id).eq('product_id', p.product_id).eq('type', 'winner_detected').in('status', ['new', 'proposal_created']).limit(1).single();
              if (!existing) {
                const { data: evt } = await supabase.from('events').insert({ store_id, type: 'winner_detected', product_id: p.product_id, severity: 'low', title: `Winner: ${p.title} (+${p.trend}%)`, description: `Revenue growing ${p.trend}%. Scale with more creatives.`, metadata: JSON.stringify({ revenue: p.revenue, trend: p.trend }) }).select().single();
                if (evt) {
                  await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
                  await supabase.from('proposals').insert({ store_id, event_id: evt.id, type: 'generate_variations', product_id: p.product_id, title: `Scale winner: "${p.title}"`, description: `Top performer. Generate more in same style.`, suggested_action: JSON.stringify({ action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative'], format: 'image' }), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
                  eventsCreated++; proposalsCreated++;
                }
              }
            }
          }
        }

        await supabase.from('pipeline_log').insert({ agent: 'AGENT', level: 'info', store_id, message: `Scan complete: ${eventsCreated} events, ${proposalsCreated} proposals created` });
        return res.status(200).json({ events_created: eventsCreated, proposals_created: proposalsCreated });
      }

      if (action === 'bulk_price') {
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

      if (action === 'cleanup_stale') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);

        const { data: stale } = await supabase
          .from('creatives')
          .select('id, storage_path, format, file_url')
          .eq('status', 'pending')
          .lt('created_at', cutoff.toISOString());

        let deleted = 0;
        for (const creative of stale || []) {
          // Safety: don't delete image if a video depends on it
          if (creative.format === 'image') {
            const { count } = await supabase
              .from('creatives')
              .select('*', { count: 'exact', head: true })
              .neq('status', 'pending')
              .filter('metadata->>source_creative_id', 'eq', creative.id);
            if (count > 0) continue;
          }

          if (creative.storage_path) {
            await supabase.storage.from('creatives').remove([creative.storage_path]);
          }
          await supabase.from('creatives').delete().eq('id', creative.id);
          deleted++;
        }

        await supabase.from('pipeline_log').insert({
          agent: 'CLEANUP', level: 'info',
          message: `Cleaned ${deleted} stale pending creatives (older than 7 days)`,
        });

        return res.status(200).json({ deleted, total_checked: stale?.length || 0 });
      }

      // ─── UPLOAD STORE DOC (with auto-processing) ───
      if (action === 'upload_store_doc') {
        const { store_name, store_id, file_name, file_data, auto_process } = req.body;
        if (!store_name || !file_name || !file_data) return res.status(400).json({ error: 'store_name, file_name, and file_data (base64) required' });

        // Validate extension
        const allowed = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.txt', '.md', '.xlsx', '.csv', '.webp'];
        const ext = file_name.includes('.') ? '.' + file_name.split('.').pop().toLowerCase() : '';
        if (!allowed.includes(ext)) return res.status(400).json({ error: `File type ${ext} not allowed` });

        // Sanitize filename
        const safeName = file_name.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
        if (safeName.includes('..')) return res.status(403).json({ error: 'Access denied' });

        const storagePath = `${store_name}/Inbox/${safeName}`;
        const buffer = Buffer.from(file_data, 'base64');

        const { error } = await supabase.storage.from(DOCS_BUCKET).upload(storagePath, buffer, {
          upsert: true,
          contentType: 'application/octet-stream',
        });

        if (error) {
          console.error('[system/upload_store_doc] Storage error:', error);
          return res.status(500).json({ error: `Upload failed: ${error.message}` });
        }

        // Auto-process this single file if requested
        if (auto_process !== false && store_id) {
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

            const text = await extractText(buffer, safeName, anthropic);
            if (text) {
              const category = await classifyDocument(text, safeName, anthropic);

              // Dedup: if same filename exists in category, rename new file with timestamp
              const nameBase = safeName.includes('.') ? safeName.slice(0, safeName.lastIndexOf('.')) : safeName;
              const nameExt = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '';
              const { data: existingFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${store_name}/${category}`);
              const destName = existingFiles?.some((f) => f.name === safeName)
                ? `${nameBase}_${Date.now()}${nameExt}` : safeName;

              // Move to category folder
              const destPath = `${store_name}/${category}/${destName}`;
              await supabase.storage.from(DOCS_BUCKET).upload(destPath, buffer, { upsert: true });
              await supabase.storage.from(DOCS_BUCKET).remove([storagePath]);

              // Extract insights
              let insightsText = '';
              let insightsCount = 0;
              if (category !== 'Logos' && text.length > 50) {
                insightsText = await extractInsights(text, safeName, store_name, anthropic);
                insightsCount = (insightsText.match(/^[-•*]/gm) || []).length;
                await supabase.from('store_knowledge').insert({
                  store_id, source_file: safeName, category, insights: insightsText,
                });
              }

              // Pipeline log
              await supabase.from('pipeline_log').insert({
                store_id, agent: 'DOC_PROCESSOR',
                message: `Auto-processed "${safeName}" → ${category}`,
                level: 'info', metadata: { filename: safeName, category, insights_count: insightsCount },
              });

              return res.status(200).json({
                ok: true, auto_processed: true,
                filename: safeName, category, insights_count: insightsCount, size: buffer.length,
              });
            }
          } catch (procErr) {
            console.error('[upload_store_doc] Auto-process error:', procErr.message);
            // File is uploaded but processing failed — it stays in Inbox
            await supabase.from('pipeline_log').insert({
              store_id, agent: 'DOC_PROCESSOR',
              message: `Auto-process failed for "${safeName}": ${procErr.message}`,
              level: 'error',
            });
          }
        }

        return res.status(200).json({ ok: true, auto_processed: false, path: `Inbox/${safeName}`, size: buffer.length });
      }

      // ─── PROCESS INBOX ───
      if (action === 'process_inbox') {
        const { store_id } = req.body;
        if (!store_id) return res.status(400).json({ error: 'store_id required' });

        const store = await getStore(store_id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const storeName = store.name;
        const inboxPrefix = `${storeName}/Inbox/`;

        // List inbox files
        const { data: inboxFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${storeName}/Inbox`, { sortBy: { column: 'name', order: 'asc' } });
        const files = (inboxFiles || []).filter((f) => f.id !== null && f.name !== '.emptyFolderPlaceholder');

        if (files.length === 0) return res.status(200).json({ processed: 0, message: 'Inbox is empty', results: [] });

        // Process in batches of 10 to stay within Vercel timeout
        const batch = files.slice(0, 20);
        const remaining = files.length - batch.length;
        const files_to_process = batch;

        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const results = [];
        for (const file of files_to_process) {
          try {
            // Download
            const filePath = `${storeName}/Inbox/${file.name}`;
            const { data: fileData, error: dlErr } = await supabase.storage.from(DOCS_BUCKET).download(filePath);
            if (dlErr || !fileData) { results.push({ filename: file.name, error: 'Download failed' }); continue; }
            const buffer = await fileData.arrayBuffer();

            // Extract text
            const text = await extractText(buffer, file.name, anthropic);
            if (!text) { results.push({ filename: file.name, error: 'Unsupported format' }); continue; }

            // Classify
            const category = await classifyDocument(text, file.name, anthropic);

            // Dedup: if same filename exists in category, rename with timestamp
            const fBase = file.name.includes('.') ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name;
            const fExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
            const { data: existFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${storeName}/${category}`);
            const destFileName = existFiles?.some((f) => f.name === file.name)
              ? `${fBase}_${Date.now()}${fExt}` : file.name;

            // Move file: copy to category folder, delete from Inbox
            const destPath = `${storeName}/${category}/${destFileName}`;
            await supabase.storage.from(DOCS_BUCKET).upload(destPath, Buffer.from(buffer), { upsert: true });
            await supabase.storage.from(DOCS_BUCKET).remove([filePath]);

            // Extract insights (skip for logos/images with no meaningful text)
            let insightsText = '';
            let insightsCount = 0;
            if (category !== 'Logos' && text.length > 50) {
              insightsText = await extractInsights(text, file.name, storeName, anthropic);
              insightsCount = (insightsText.match(/^[-•*]/gm) || []).length;

              // Save to store_knowledge
              await supabase.from('store_knowledge').insert({
                store_id, source_file: file.name, category, insights: insightsText,
              });
            }

            results.push({ filename: file.name, category, insights_count: insightsCount });
          } catch (err) {
            console.error(`[process_inbox] Error processing ${file.name}:`, err.message);
            results.push({ filename: file.name, error: err.message });
          }
        }

        const successCount = results.filter((r) => !r.error).length;
        await supabase.from('pipeline_log').insert({
          store_id, agent: 'DOC_PROCESSOR',
          message: `Processed ${successCount}/${files.length} files from Inbox`,
          level: successCount > 0 ? 'success' : 'error',
          metadata: { results },
        });

        return res.status(200).json({
          processed: successCount, results, remaining,
          message: remaining > 0 ? `${remaining} file(s) still in Inbox — run again` : undefined,
        });
      }

      // ─── SAVE SIZE CHART ───
      if (action === 'save_size_chart') {
        const { store_id, product_id, size_chart_text } = req.body;
        if (!store_id || !product_id || !size_chart_text) return res.status(400).json({ error: 'store_id, product_id, and size_chart_text required' });

        const store = await getStore(store_id);
        if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

        const { data: product } = await supabase.from('products').select('shopify_id, title').eq('id', product_id).single();
        if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

        const client = createShopifyClient(store.shopify_url, store.admin_token);
        const result = await client.updateMetafield(product.shopify_id, 'custom', 'size_chart_text', size_chart_text);
        if (!result) return res.status(500).json({ error: 'Failed to save metafield to Shopify' });

        await supabase.from('pipeline_log').insert({
          store_id, agent: 'SIZE_CHART',
          message: `Updated size chart for "${product.title}"`,
          level: 'success',
        });

        return res.status(200).json({ ok: true });
      }

      // ─── PARSE SIZE CHART IMAGE (Claude Vision) ───
      if (action === 'parse_size_chart_image') {
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

      // ─── UPDATE PRODUCT FULL ───
      if (action === 'update_product_full') {
        const { store_id, product_id, updates } = req.body;
        if (!store_id || !product_id || !updates) return res.status(400).json({ error: 'store_id, product_id, and updates required' });

        const store = await getStore(store_id);
        if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

        const { data: product } = await supabase.from('products').select('shopify_id, title').eq('id', product_id).single();
        if (!product?.shopify_id) return res.status(404).json({ error: 'Product not found' });

        const client = createShopifyClient(store.shopify_url, store.admin_token);
        const changes = [];

        // Snapshot before-state for audit trail
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

        // Update variants
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

        // Update metafields
        if (updates.metafields?.length > 0) {
          for (const mf of updates.metafields) {
            await client.updateMetafield(product.shopify_id, mf.namespace, mf.key, mf.value, mf.type || 'multi_line_text_field');
            changes.push(`metafield_${mf.namespace}.${mf.key}`);
          }
        }

        // Update images
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

      // ─── SCRAPE PRODUCT URL ───
      if (action === 'scrape_product') {
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

      // ─── IMPORT CONFIRM ───
      if (action === 'import_confirm') {
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
            const optimized = await optimizeProduct(dbProduct.id, brandContext);
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

      return res.status(400).json({ error: 'Unknown POST action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`[system/${action}] Error:`, err);
    return res.status(500).json({ error: `Action '${action}' failed`, details: err.message });
  }
}

export default withAuth(handler);

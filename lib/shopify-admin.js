import { createClient } from '@supabase/supabase-js';

const API_VERSION = '2024-01';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export function createShopifyClient(storeUrl, token) {
  async function rest(endpoint, method = 'GET', body = null) {
    if (!token) return null;
    const options = { method, headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`https://${storeUrl}/admin/api/${API_VERSION}/${endpoint}`, options);
    if (!res.ok) {
      console.error(`[shopify] ${method} ${res.status}: ${endpoint}`);
      return null;
    }
    return res.json();
  }

  async function fetchOrders(days) {
    const since = new Date(); since.setDate(since.getDate() - days);
    const data = await rest(`orders.json?status=any&created_at_min=${since.toISOString()}&limit=250`);
    return data?.orders || [];
  }

  async function getRevenueSummary(days = 7) {
    const orders = await fetchOrders(days);
    if (!orders.length) return { revenue: 0, orders: 0, aov: 0, currency: 'USD', connected: !!token };
    const revenue = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const count = orders.length;
    return { revenue: Math.round(revenue * 100) / 100, orders: count, aov: count > 0 ? Math.round((revenue / count) * 100) / 100 : 0, currency: orders[0]?.currency || 'USD', connected: true };
  }

  async function getRevenueDelta(days = 7) {
    const [current, total2x] = await Promise.all([getRevenueSummary(days), getRevenueSummary(days * 2)]);
    const prevRev = total2x.revenue - current.revenue;
    const prevOrd = total2x.orders - current.orders;
    const revD = prevRev > 0 ? Math.round(((current.revenue - prevRev) / prevRev) * 100) : 0;
    const ordD = prevOrd > 0 ? Math.round(((current.orders - prevOrd) / prevOrd) * 100) : 0;
    return { revenue_delta: (revD >= 0 ? '+' : '') + revD + '%', orders_delta: (ordD >= 0 ? '+' : '') + ordD + '%' };
  }

  async function getDailyRevenue(days = 7) {
    const orders = await fetchOrders(days);
    const map = {};
    for (const o of orders) {
      const d = o.created_at.split('T')[0];
      if (!map[d]) map[d] = { date: d, revenue: 0, orders: 0 };
      map[d].revenue += parseFloat(o.total_price || 0);
      map[d].orders += 1;
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, revenue: Math.round(d.revenue * 100) / 100 }));
  }

  async function getTrafficSources(days = 7) {
    const orders = await fetchOrders(days);
    const map = {};
    for (const o of orders) {
      let source = 'Direct';
      const ref = o.referring_site || ''; const land = o.landing_site || '';
      if (ref.includes('facebook') || ref.includes('fb.') || land.includes('fbclid') || land.includes('utm_source=facebook')) source = 'Meta Paid';
      else if (ref.includes('google')) source = 'Google';
      else if (ref.includes('tiktok') || land.includes('tiktok')) source = 'TikTok';
      else if (ref.includes('pinterest')) source = 'Pinterest';
      else if (ref.includes('instagram')) source = 'Instagram';
      else if (ref) source = 'Other';
      map[source] = (map[source] || 0) + 1;
    }
    const total = orders.length || 1;
    return Object.entries(map).map(([source, count]) => ({ source, sessions: count, percentage: Math.round((count / total) * 100) })).sort((a, b) => b.sessions - a.sessions);
  }

  async function getTopProductsWithCreatives(days = 7, limit = 10) {
    const [orders, prevOrders] = await Promise.all([fetchOrders(days), fetchOrders(days * 2)]);
    const curMap = {};
    for (const o of orders) for (const li of o.line_items || []) {
      if (!curMap[li.title]) curMap[li.title] = { title: li.title, units: 0, revenue: 0 };
      curMap[li.title].units += li.quantity;
      curMap[li.title].revenue += parseFloat(li.price || 0) * li.quantity;
    }
    const prevMap = {};
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    for (const o of prevOrders) {
      if (new Date(o.created_at) >= cutoff) continue;
      for (const li of o.line_items || []) {
        if (!prevMap[li.title]) prevMap[li.title] = { revenue: 0 };
        prevMap[li.title].revenue += parseFloat(li.price || 0) * li.quantity;
      }
    }
    const products = Object.values(curMap).sort((a, b) => b.revenue - a.revenue).slice(0, limit).map((p) => ({
      ...p, revenue: Math.round(p.revenue * 100) / 100,
      trend: prevMap[p.title]?.revenue > 0 ? ((p.revenue - prevMap[p.title].revenue) / prevMap[p.title].revenue * 100).toFixed(0) : null,
    }));
    // Bulk: fetch all matching DB products in 1 query
    const titles = products.map((p) => p.title.split('|')[0].trim());
    const { data: dbProducts } = await supabase.from('products').select('id, title');
    const dbMap = {};
    for (const db of dbProducts || []) {
      for (const t of titles) {
        if (db.title.includes(t)) { dbMap[t] = db.id; break; }
      }
    }
    const productIds = Object.values(dbMap).filter(Boolean);

    // Bulk: fetch all creative counts in 1 query
    const { data: allCreatives } = productIds.length > 0
      ? await supabase.from('creatives').select('product_id, status').in('product_id', productIds)
      : { data: [] };

    for (const p of products) {
      const key = p.title.split('|')[0].trim();
      const pid = dbMap[key];
      if (pid) {
        const mine = (allCreatives || []).filter((c) => c.product_id === pid);
        p.creative_count = mine.length;
        p.approved_count = mine.filter((c) => c.status === 'approved').length;
        p.product_id = pid;
      } else { p.creative_count = 0; p.approved_count = 0; p.product_id = null; }
    }
    return products;
  }

  async function getRecentOrders(limit = 10) {
    const data = await rest(`orders.json?status=any&limit=${limit}`);
    if (!data?.orders) return [];
    return data.orders.map((o) => ({ id: o.id, name: o.name, total: parseFloat(o.total_price || 0), currency: o.currency, status: o.fulfillment_status || 'unfulfilled', created_at: o.created_at, items: (o.line_items || []).slice(0, 3).map((li) => ({ title: li.title, quantity: li.quantity })) }));
  }

  async function getTopCustomers(days = 7, limit = 5) {
    const orders = await fetchOrders(days);
    const customerMap = {};
    for (const o of orders) {
      const c = o.customer;
      if (!c) continue;
      const key = c.id || c.email;
      if (!customerMap[key]) customerMap[key] = { name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown', orders: 0, total: 0 };
      customerMap[key].orders++;
      customerMap[key].total += parseFloat(o.total_price || 0);
    }
    return Object.values(customerMap).sort((a, b) => b.total - a.total).slice(0, limit).map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }));
  }

  async function getPaymentFulfillmentStatus(days = 7) {
    const orders = await fetchOrders(days);
    const payment = { paid: 0, refunded: 0, pending: 0 };
    const fulfillment = { fulfilled: 0, unfulfilled: 0, partial: 0 };
    for (const o of orders) {
      if (o.financial_status === 'paid') payment.paid++;
      else if (o.financial_status === 'refunded' || o.financial_status === 'partially_refunded') payment.refunded++;
      else payment.pending++;
      if (o.fulfillment_status === 'fulfilled') fulfillment.fulfilled++;
      else if (o.fulfillment_status === 'partial') fulfillment.partial++;
      else fulfillment.unfulfilled++;
    }
    const total = orders.length || 1;
    return {
      payment: Object.entries(payment).map(([s, c]) => ({ status: s, count: c, pct: Math.round((c / total) * 100) })),
      fulfillment: Object.entries(fulfillment).map(([s, c]) => ({ status: s, count: c, pct: Math.round((c / total) * 100) })),
    };
  }

  async function getCollectionCount() {
    const [custom, smart] = await Promise.all([
      rest('custom_collections/count.json'),
      rest('smart_collections/count.json'),
    ]);
    return (custom?.count || 0) + (smart?.count || 0);
  }

  async function getCustomerCount() {
    const data = await rest('customers/count.json');
    return data?.count || 0;
  }

  async function getProductCount() {
    const data = await rest('products/count.json');
    return data?.count || 0;
  }

  async function updateProduct(shopifyProductId, updates) {
    const payload = { product: {} };
    if (updates.title) payload.product.title = updates.title;
    if (updates.description) payload.product.body_html = updates.description;
    if (updates.product_type) payload.product.product_type = updates.product_type;
    if (updates.vendor) payload.product.vendor = updates.vendor;
    if (updates.tags) payload.product.tags = Array.isArray(updates.tags) ? updates.tags.join(', ') : updates.tags;
    if (updates.seo_title) payload.product.metafields_global_title_tag = updates.seo_title;
    if (updates.seo_description) payload.product.metafields_global_description_tag = updates.seo_description;
    return rest(`products/${shopifyProductId}.json`, 'PUT', payload);
  }

  async function updateVariant(shopifyVariantId, updates) {
    return rest(`variants/${shopifyVariantId}.json`, 'PUT', { variant: updates });
  }

  async function updateProductOptions(shopifyProductId, options) {
    return rest(`products/${shopifyProductId}.json`, 'PUT', { product: { options } });
  }

  async function getProductVariants(shopifyProductId) {
    const data = await rest(`products/${shopifyProductId}.json?fields=id,variants,options`);
    return data?.product || null;
  }

  async function bulkUpdateVariantPrices(productShopifyIds, newPrice) {
    // For each product, get variants and update their price
    let updated = 0;
    for (const pid of productShopifyIds) {
      const product = await getProductVariants(pid);
      if (!product?.variants) continue;
      for (const v of product.variants) {
        await updateVariant(v.id, { price: newPrice });
        updated++;
      }
    }
    return updated;
  }

  return {
    isConnected: () => !!token,
    getRevenueSummary, getRevenueDelta, getDailyRevenue, getTrafficSources,
    getTopProductsWithCreatives, getRecentOrders, getTopCustomers,
    getPaymentFulfillmentStatus, getCollectionCount, getCustomerCount, getProductCount,
    updateProduct, updateVariant, updateProductOptions, getProductVariants, bulkUpdateVariantPrices,
  };
}

// Default client for backward compatibility
const DEFAULT_URL = process.env.SHOPIFY_STORE_URL || 'shop-elegancehouse.com';
const DEFAULT_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
export const defaultClient = createShopifyClient(DEFAULT_URL, DEFAULT_TOKEN);

export const getRevenueSummary = (...a) => defaultClient.getRevenueSummary(...a);
export const getRevenueDelta = (...a) => defaultClient.getRevenueDelta(...a);
export const getDailyRevenue = (...a) => defaultClient.getDailyRevenue(...a);
export const getTrafficSources = (...a) => defaultClient.getTrafficSources(...a);
export const getTopProductsWithCreatives = (...a) => defaultClient.getTopProductsWithCreatives(...a);
export const getRecentOrders = (...a) => defaultClient.getRecentOrders(...a);
export const updateProduct = (...a) => defaultClient.updateProduct(...a);
export const updateVariant = (...a) => defaultClient.updateVariant(...a);
export const updateProductOptions = (...a) => defaultClient.updateProductOptions(...a);
export const getProductVariants = (...a) => defaultClient.getProductVariants(...a);
export const bulkUpdateVariantPrices = (...a) => defaultClient.bulkUpdateVariantPrices(...a);
export const isConnected = () => defaultClient.isConnected();

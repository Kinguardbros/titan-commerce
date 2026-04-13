import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient, getRevenueSummary, getRecentOrders } from '../shopify-admin.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET: profit_summary
export async function profit_summary(req, res) {
  const days = parseInt(req.query.days) || 7;
  const storeId = req.query.store_id;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  // Create per-store Shopify client
  let shopifyClient;
  let store;
  if (storeId) {
    store = await getStore(storeId);
    if (store?.admin_token) {
      shopifyClient = createShopifyClient(store.shopify_url, store.admin_token);
    }
  }
  if (!shopifyClient) {
    shopifyClient = { getRevenueSummary, getRecentOrders };
  }

  // Shopify orders for revenue + COGS
  const shopifyData = await shopifyClient.getRevenueSummary(days);

  // Get detailed orders for daily breakdown
  const ordersResp = await shopifyClient.getRecentOrders(250);

  // Get all products with COGS (filtered by store)
  let productsQuery = supabase.from('products').select('title, cogs');
  if (storeId) productsQuery = productsQuery.eq('store_id', storeId);
  const { data: products } = await productsQuery;
  const cogsMap = {};
  (products || []).forEach((p) => { if (p.cogs) cogsMap[p.title] = parseFloat(p.cogs); });
  const missingCogs = (products || []).filter((p) => !p.cogs).length;

  // Get Meta adspend from performance table
  const { data: metaPerf } = await supabase.from('performance').select('date, spend').gte('date', sinceStr);

  // Get manual adspend
  const { data: manualSpend } = await supabase.from('manual_adspend').select('*').gte('date', sinceStr);

  // Per-gateway payment fee rates from store config
  const paymentFees = store?.brand_config?.payment_fees || {};
  const defaultFeeRate = store?.brand_config?.transaction_fee_pct || paymentFees.default || 0.035;
  const hasPerGatewayFees = Object.keys(paymentFees).length > 1;

  // Build daily breakdown
  const emptyDay = (date) => ({ date, revenue: 0, returns: 0, cogs: 0, shipping: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0, transaction_fees: 0 });
  const dailyMap = {};
  const filteredOrders = (ordersResp || []).filter((o) => o.created_at >= since.toISOString());

  for (const order of filteredOrders) {
    const date = order.created_at.split('T')[0];
    if (!dailyMap[date]) dailyMap[date] = emptyDay(date);
    dailyMap[date].revenue += order.total;
    // Returns/refunds
    dailyMap[date].returns += order.refund_amount || 0;
    // Shipping
    dailyMap[date].shipping += order.shipping || 0;
    // COGS from line items
    for (const item of order.items || []) {
      const unitCost = cogsMap[item.title] || 0;
      dailyMap[date].cogs += unitCost * item.quantity;
    }
    // Transaction fees — per-gateway rate or store default
    const feeRate = paymentFees[order.payment_gateway] || defaultFeeRate;
    dailyMap[date].transaction_fees += order.total * feeRate;
  }

  // Add Meta adspend
  for (const p of metaPerf || []) {
    const date = p.date;
    if (!dailyMap[date]) dailyMap[date] = emptyDay(date);
    dailyMap[date].adspend_meta += Number(p.spend || 0);
  }

  // Add manual adspend
  for (const m of manualSpend || []) {
    const date = m.date;
    if (!dailyMap[date]) dailyMap[date] = emptyDay(date);
    if (m.channel === 'tiktok') dailyMap[date].adspend_tiktok += Number(m.amount);
    else if (m.channel === 'pinterest') dailyMap[date].adspend_pinterest += Number(m.amount);
    else dailyMap[date].adspend_manual += Number(m.amount);
  }

  // Calculate profit for each day: revenue - returns - cogs - shipping - adspend - fees
  const round2 = (n) => Math.round(n * 100) / 100;
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
    const adspend_total = d.adspend_meta + d.adspend_tiktok + d.adspend_pinterest + d.adspend_manual;
    const net_revenue = d.revenue - d.returns;
    const profit = net_revenue - d.cogs - d.shipping - adspend_total - d.transaction_fees;
    return {
      ...d,
      returns: round2(d.returns),
      cogs: round2(d.cogs),
      shipping: round2(d.shipping),
      transaction_fees: round2(d.transaction_fees),
      profit: round2(profit),
      roas: adspend_total > 0 ? round2(d.revenue / adspend_total) : 0,
      profit_pct: d.revenue > 0 ? Math.round((profit / d.revenue) * 10000) / 100 : 0,
    };
  });

  // Totals
  const totals = daily.reduce((acc, d) => ({
    revenue: acc.revenue + d.revenue,
    returns: acc.returns + d.returns,
    cogs: acc.cogs + d.cogs,
    shipping: acc.shipping + d.shipping,
    adspend_meta: acc.adspend_meta + d.adspend_meta,
    adspend_tiktok: acc.adspend_tiktok + d.adspend_tiktok,
    adspend_pinterest: acc.adspend_pinterest + d.adspend_pinterest,
    transaction_fees: acc.transaction_fees + d.transaction_fees,
    profit: acc.profit + d.profit,
  }), { revenue: 0, returns: 0, cogs: 0, shipping: 0, adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, transaction_fees: 0, profit: 0 });

  const adspend_total = totals.adspend_meta + totals.adspend_tiktok + totals.adspend_pinterest;

  return res.status(200).json({
    days,
    daily,
    totals: {
      ...totals,
      adspend_total: round2(adspend_total),
      roas: adspend_total > 0 ? round2(totals.revenue / adspend_total) : 0,
      profit_pct: totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 10000) / 100 : 0,
    },
    missing_cogs: missingCogs,
    accuracy: {
      shipping: true,
      returns: true,
      per_gateway_fees: hasPerGatewayFees,
    },
  });
}

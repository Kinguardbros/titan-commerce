import { createClient } from '@supabase/supabase-js';
import { createShopifyClient, isConnected, getTopProductsWithCreatives } from '../shopify-admin.js';
import { isConnected as isMetaConnected, getAccountInsights, getCampaigns, getActiveAdsCount } from '../meta-api.js';
import { getStore } from '../store-context.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function kpi(req, res) {
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

export async function meta_overview(req, res) {
  if (!isMetaConnected()) return res.status(200).json({ connected: false });
  const [insights, campaigns, activeAds] = await Promise.all([
    getAccountInsights('last_7d'), getCampaigns(), getActiveAdsCount(),
  ]);
  return res.status(200).json({ connected: true, insights, campaigns, active_ads: activeAds });
}

export async function insights(req, res) {
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
  let pubQ = supabase.from('creatives').select('*', { count: 'exact', head: true }).eq('status', 'published');
  let failQ = supabase.from('creatives').select('*', { count: 'exact', head: true }).eq('status', 'failed');
  if (storeId) { pQ = pQ.eq('store_id', storeId); gQ = gQ.eq('store_id', storeId); aQ = aQ.eq('store_id', storeId); pubQ = pubQ.eq('store_id', storeId); failQ = failQ.eq('store_id', storeId); }
  const [{ count: pC }, { count: gC }, { count: aC }, { count: pubC }, { count: failC }] = await Promise.all([pQ, gQ, aQ, pubQ, failQ]);
  return res.status(200).json({ connected: true, action_needed, declining, winners, pipeline_summary: { pending: pC || 0, generating: gC || 0, approved: aC || 0, published: pubC || 0, failed: failC || 0 } });
}

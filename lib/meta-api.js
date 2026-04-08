const META_BASE = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID;

export function isConnected() {
  return !!(TOKEN && AD_ACCOUNT);
}

async function metaFetch(path, params = {}) {
  if (!TOKEN) return null;
  const url = new URL(`${META_BASE}${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    console.error('[meta-api] Error:', data.error.message);
    return null;
  }
  return data;
}

export async function getAccountInsights(datePreset = 'last_7d') {
  const data = await metaFetch(`/${AD_ACCOUNT}/insights`, {
    fields: 'spend,impressions,clicks,ctr,cpc,actions,action_values',
    date_preset: datePreset,
  });
  if (!data?.data?.[0]) return null;

  const row = data.data[0];
  const purchases = (row.actions || []).find((a) => a.action_type === 'omni_purchase');
  const revenue = (row.action_values || []).find((a) => a.action_type === 'omni_purchase');

  return {
    spend: parseFloat(row.spend || 0),
    impressions: parseInt(row.impressions || 0),
    clicks: parseInt(row.clicks || 0),
    ctr: parseFloat(row.ctr || 0),
    cpc: parseFloat(row.cpc || 0),
    conversions: parseInt(purchases?.value || 0),
    revenue: parseFloat(revenue?.value || 0),
    roas: parseFloat(row.spend) > 0 ? parseFloat(revenue?.value || 0) / parseFloat(row.spend) : 0,
  };
}

export async function getCampaigns() {
  const data = await metaFetch(`/${AD_ACCOUNT}/campaigns`, {
    fields: 'name,status,daily_budget,objective',
    limit: '20',
  });
  if (!data?.data) return [];

  return data.data.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
    objective: c.objective,
  }));
}

export async function getActiveAdsCount() {
  const data = await metaFetch(`/${AD_ACCOUNT}/ads`, {
    fields: 'id',
    effective_status: '["ACTIVE"]',
    limit: '0',
    summary: 'total_count',
  });
  return data?.summary?.total_count || 0;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchJSON(url, options = {}) {
  const token = localStorage.getItem('auth_token');

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.location.reload();
    throw new Error('Session expired — please sign in again');
  }

  if (res.status === 429) {
    throw new Error('Rate limit — too many requests. Wait a minute and try again.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hint || body.details || body.error || `Request failed (${res.status})`);
  }

  return res.json();
}

// Ads actions
export function approveAd(creativeId, approvedBy, comment) {
  return fetchJSON('/api/ads/action', {
    method: 'POST',
    body: JSON.stringify({ action: 'approve', creative_id: creativeId, approved_by: approvedBy, comment }),
  });
}

export function pauseAd(adId) {
  return fetchJSON('/api/ads/action', {
    method: 'POST',
    body: JSON.stringify({ action: 'pause', ad_id: adId }),
  });
}

export function rejectAd(creativeId, rejectedBy, reason) {
  return fetchJSON('/api/ads/action', {
    method: 'POST',
    body: JSON.stringify({ action: 'reject', creative_id: creativeId, rejected_by: rejectedBy, reason }),
  });
}

// Creatives
export function getPendingCreatives(storeId) {
  return fetchJSON(`/api/creatives/list?status=pending${storeId ? `&store_id=${storeId}` : ''}`);
}

export function getProductCreatives(productId, storeId) {
  return fetchJSON(`/api/creatives/list?product_id=${productId}${storeId ? `&store_id=${storeId}` : ''}`);
}

export function updateCreative(creativeId, updates) {
  return fetchJSON('/api/system?action=update_creative', {
    method: 'POST',
    body: JSON.stringify({ creative_id: creativeId, ...updates }),
  });
}

export function regenerateCreative(creativeId) {
  return fetchJSON('/api/creatives/regenerate', {
    method: 'POST',
    body: JSON.stringify({ creative_id: creativeId }),
  });
}

export function generateCreatives({ product_id, style, custom_prompt, show_model, text_overlay, overlay_text, store_id }) {
  return fetchJSON('/api/creatives/generate', {
    method: 'POST',
    body: JSON.stringify({ product_id, style, custom_prompt, show_model, text_overlay, overlay_text, store_id }),
  });
}

export function convertToVideo(creativeId) {
  return fetchJSON('/api/creatives/convert-to-video', {
    method: 'POST',
    body: JSON.stringify({ creative_id: creativeId }),
  });
}

// Products
export async function getProducts(storeId, { page, limit } = {}) {
  const params = [];
  if (storeId) params.push(`store_id=${storeId}`);
  if (page) params.push(`page=${page}`);
  if (limit) params.push(`limit=${limit}`);
  const qs = params.length ? `?${params.join('&')}` : '';
  const result = await fetchJSON(`/api/products/list${qs}`);
  // Support both paginated { products, total, page, pages } and legacy array responses
  if (Array.isArray(result)) return { products: result, total: result.length, page: 1, pages: 1 };
  return result;
}

// Convenience: fetch all products (used by Shopify pricing which needs full list)
export async function getAllProducts(storeId) {
  const result = await getProducts(storeId, { limit: 200 });
  return result.products || [];
}

export function syncProducts(storeId) {
  return fetchJSON('/api/products/sync', {
    method: 'POST',
    body: JSON.stringify(storeId ? { store_id: storeId } : {}),
  });
}

// System
export function getPipelineLog(storeId) {
  return fetchJSON(`/api/system?action=pipeline_log${storeId ? `&store_id=${storeId}` : ''}`);
}

export function getKPIs() {
  return fetchJSON('/api/system?action=kpi');
}

// Stores
export function getStores() {
  return fetchJSON('/api/system?action=stores_list');
}

// Shopify
export function getShopifyOverview(days = 7, storeId) {
  return fetchJSON(`/api/shopify/overview?days=${days}${storeId ? `&store_id=${storeId}` : ''}`);
}

// Meta
export function getMetaOverview() {
  return fetchJSON('/api/meta/overview');
}

export function syncMeta() {
  return fetchJSON('/api/meta/overview', { method: 'POST' });
}

// Insights
export function getInsights(storeId) {
  return fetchJSON(`/api/system?action=insights${storeId ? `&store_id=${storeId}` : ''}`);
}

// Proposals
export function getProposals(storeId) {
  return fetchJSON(`/api/system?action=proposals_list&store_id=${storeId}&status=pending`);
}

export function approveProposal(proposalId) {
  return fetchJSON('/api/system?action=approve_proposal', {
    method: 'POST',
    body: JSON.stringify({ proposal_id: proposalId }),
  });
}

export function rejectProposal(proposalId, reason) {
  return fetchJSON('/api/system?action=reject_proposal', {
    method: 'POST',
    body: JSON.stringify({ proposal_id: proposalId, reason }),
  });
}

export function approveAllProposals(proposalIds) {
  return fetchJSON('/api/system?action=approve_all_proposals', {
    method: 'POST',
    body: JSON.stringify({ proposal_ids: proposalIds }),
  });
}

export function scanEvents(storeId) {
  return fetchJSON('/api/system?action=scan_events', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId }),
  });
}

// Product Optimizer
export function optimizeProductAPI(productId, brandContext = '') {
  return fetchJSON('/api/system?action=optimize_product', {
    method: 'POST',
    body: JSON.stringify({ product_id: productId, brand_context: brandContext }),
  });
}

export function approveOptimization(optimizationId, optimized) {
  return fetchJSON('/api/system?action=approve_optimization', {
    method: 'POST',
    body: JSON.stringify({ optimization_id: optimizationId, optimized }),
  });
}

export function rejectOptimization(optimizationId, reason) {
  return fetchJSON('/api/system?action=reject_optimization', {
    method: 'POST',
    body: JSON.stringify({ optimization_id: optimizationId, reason }),
  });
}

export function saveDraftOptimization(optimizationId, optimized) {
  return fetchJSON('/api/system?action=save_optimization', {
    method: 'POST',
    body: JSON.stringify({ optimization_id: optimizationId, optimized }),
  });
}

export function getPendingOptimizations(storeId) {
  return fetchJSON(`/api/system?action=pending_optimizations${storeId ? `&store_id=${storeId}` : ''}`);
}

// Profit
export function getProfitSummary(days = 7) {
  return fetchJSON(`/api/system?action=profit_summary&days=${days}`);
}

export function updateCogs(productId, cogs) {
  return fetchJSON('/api/system?action=update_cogs', {
    method: 'POST',
    body: JSON.stringify({ product_id: productId, cogs }),
  });
}

export function addManualAdspend(date, channel, amount) {
  return fetchJSON('/api/system?action=manual_adspend', {
    method: 'POST',
    body: JSON.stringify({ date, channel, amount }),
  });
}

// Studio
export function generateBranded({ store_id, type, prompt, style, show_model }) {
  return fetchJSON('/api/system?action=generate_branded', {
    method: 'POST',
    body: JSON.stringify({ store_id, type, prompt, style, show_model }),
  });
}

export function getStudioCreatives(storeId, type) {
  const params = [`store_id=${storeId}`];
  if (type === 'branded') params.push('type=branded');
  return fetchJSON(`/api/creatives/list?${params.join('&')}`);
}

// Bulk Pricing
export function bulkUpdatePrices(storeId, productShopifyIds, newPrice) {
  return fetchJSON('/api/system?action=bulk_price', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_shopify_ids: productShopifyIds, new_price: newPrice }),
  });
}

// Cleanup
export function cleanupStaleCreatives() {
  return fetchJSON('/api/system?action=cleanup_stale', { method: 'POST' });
}

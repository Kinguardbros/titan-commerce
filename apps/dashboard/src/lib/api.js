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

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hint || body.error || 'You don\'t have permission to do that');
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

export function generateCreatives({ product_id, style, ai_model, custom_prompt, show_model, text_overlay, overlay_text, store_id, audience, aspect_ratio, resolution, story_id, story_shot, reference_url }) {
  return fetchJSON('/api/creatives/generate', {
    method: 'POST',
    body: JSON.stringify({ product_id, style, ai_model, custom_prompt, show_model, text_overlay, overlay_text, store_id, audience, aspect_ratio, resolution, story_id, story_shot, reference_url }),
  });
}

export function pushCreativeToShopify(creativeId, storeId) {
  return fetchJSON('/api/system?action=push_creative_to_shopify', {
    method: 'POST',
    body: JSON.stringify({ creative_id: creativeId, store_id: storeId }),
  });
}

export function convertToVideo(creativeId) {
  return fetchJSON('/api/creatives/convert-to-video', {
    method: 'POST',
    body: JSON.stringify({ creative_id: creativeId }),
  });
}

// Products
export async function getProducts(storeId, { page, limit, show_archived } = {}) {
  const params = [];
  if (storeId) params.push(`store_id=${storeId}`);
  if (page) params.push(`page=${page}`);
  if (limit) params.push(`limit=${limit}`);
  if (show_archived) params.push(`show_archived=true`);
  const qs = params.length ? `?${params.join('&')}` : '';
  const result = await fetchJSON(`/api/products/list${qs}`);
  // Support both paginated { products, total, page, pages } and legacy array responses
  if (Array.isArray(result)) return { products: result, total: result.length, page: 1, pages: 1 };
  return result;
}

// Convenience: fetch all products (used by Shopify pricing which needs full list)
export async function getAllProducts(storeId, show_archived) {
  const result = await getProducts(storeId, { limit: 200, show_archived });
  return result.products || [];
}

export function syncProducts(storeId) {
  return fetchJSON('/api/system?action=sync_products', {
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

// Current authenticated user (master fallback or real user row)
export function getMe() {
  return fetchJSON('/api/system?action=me');
}

// Shopify
export function getShopifyOverview(days = 7, storeId) {
  return fetchJSON(`/api/shopify/overview?days=${days}${storeId ? `&store_id=${storeId}` : ''}`);
}

// Meta
export function getMetaOverview() {
  return fetchJSON('/api/system?action=meta_overview');
}

export function syncMeta() {
  return fetchJSON('/api/system?action=meta_overview');
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
export function getProfitSummary(days = 7, storeId = null) {
  let url = `/api/system?action=profit_summary&days=${days}`;
  if (storeId) url += `&store_id=${storeId}`;
  return fetchJSON(url);
}

export function updateCogs(productId, cogs, variantCogs, storeId) {
  const payload = { product_id: productId, store_id: storeId };
  if (cogs !== undefined) payload.cogs = cogs;
  if (variantCogs !== undefined) payload.variant_cogs = variantCogs;
  return fetchJSON('/api/system?action=update_cogs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addManualAdspend(date, channel, amount, storeId) {
  return fetchJSON('/api/system?action=manual_adspend', {
    method: 'POST',
    body: JSON.stringify({ date, channel, amount, store_id: storeId }),
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

// Async generation polling
export function pollGenerations(storeId) {
  return fetchJSON(`/api/system?action=poll_generations${storeId ? `&store_id=${storeId}` : ''}`);
}

// Product Import
export function scrapeProductUrl(url) {
  return fetchJSON('/api/system?action=scrape_product', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function confirmImport(data) {
  return fetchJSON('/api/system?action=import_confirm', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Size Chart
export function readSizeChart(storeId, productId) {
  return fetchJSON(`/api/system?action=read_size_chart&store_id=${storeId}&product_id=${productId}`);
}

export function saveSizeChart(storeId, productId, sizeChartText) {
  return fetchJSON('/api/system?action=save_size_chart', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, size_chart_text: sizeChartText }),
  });
}

export function parseSizeChartImage(imageUrl) {
  return fetchJSON('/api/system?action=parse_size_chart_image', {
    method: 'POST',
    body: JSON.stringify({ image_url: imageUrl }),
  });
}

// Product Detail
export function getProductDetail(storeId, productId) {
  return fetchJSON(`/api/system?action=product_detail&store_id=${storeId}&product_id=${productId}`);
}

// Product Editor
export function updateProductFull(storeId, productId, updates) {
  return fetchJSON('/api/system?action=update_product_full', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, updates }),
  });
}

// Store Docs
export function getStoreDocs(storeName) {
  return fetchJSON(`/api/system?action=store_docs&store_name=${encodeURIComponent(storeName)}`);
}

export function getSkills(storeId) {
  return fetchJSON(`/api/system?action=get_skills&store_id=${storeId}`);
}

export function generateSkills(storeId) {
  return fetchJSON('/api/system?action=generate_skills', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId }),
  });
}

export function regenerateSkill(storeId, skillType, productName = null) {
  return fetchJSON('/api/system?action=regenerate_skill', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, skill_type: skillType, product_name: productName }),
  });
}

export function saveSkill(storeId, skillType, content, productName = null) {
  return fetchJSON('/api/system?action=save_skill', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, skill_type: skillType, content, product_name: productName }),
  });
}

export function processSingleFile(storeId, filename) {
  return fetchJSON('/api/system?action=process_single_file', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, filename }),
  });
}

export function processInbox(storeId) {
  return fetchJSON('/api/system?action=process_inbox', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId }),
  });
}

export function uploadStoreDoc(storeName, fileName, fileData, storeId = null, autoProcess = true) {
  return fetchJSON('/api/system?action=upload_store_doc', {
    method: 'POST',
    body: JSON.stringify({ store_name: storeName, file_name: fileName, file_data: fileData, store_id: storeId, auto_process: autoProcess }),
  });
}

export function getStoreDocDownloadUrl(storeName, filePath) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl}/storage/v1/object/public/store-docs/${encodeURIComponent(storeName)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }
  // Fallback to API proxy
  const token = localStorage.getItem('auth_token');
  return `/api/system?action=store_docs_download&store_name=${encodeURIComponent(storeName)}&file_path=${encodeURIComponent(filePath)}${token ? `&token=${token}` : ''}`;
}

// Custom Styles
export function analyzeStyle(storeId, images = [], urls = []) {
  return fetchJSON('/api/system?action=analyze_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, images, urls }),
  });
}

export function createCustomStyle(storeId, name, description, analysis, referenceImages = []) {
  return fetchJSON('/api/system?action=create_custom_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, name, description, analysis, reference_images: referenceImages }),
  });
}

export function getCustomStyles(storeId) {
  return fetchJSON(`/api/system?action=custom_styles&store_id=${storeId}`);
}

export function deleteCustomStyle(storeId, styleKey) {
  return fetchJSON('/api/system?action=delete_custom_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, style_key: styleKey }),
  });
}

export function describeStyle(storeId, description) {
  return fetchJSON('/api/system?action=describe_style', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, description }),
  });
}

export function scrapeStyle(url, storeId) {
  return fetchJSON('/api/system?action=scrape_style', {
    method: 'POST',
    body: JSON.stringify({ url, store_id: storeId }),
  });
}

export function refreshSizeCharts(storeId) {
  return fetchJSON(`/api/system?action=refresh_size_charts&store_id=${storeId}`);
}

// Avatars
export function getAvatars(storeId) {
  return fetchJSON(`/api/system?action=persona_avatars&store_id=${storeId}`);
}

export function generateAvatar(storeId, personaName, description) {
  return fetchJSON('/api/system?action=generate_avatar', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, persona_name: personaName, description }),
  });
}

// Poll in-flight avatar generations (fire-and-forget pattern — generate_avatar returns
// immediately with status='generating', this checks for completion every few seconds).
export function pollAvatarGenerations(storeId) {
  return fetchJSON(`/api/system?action=poll_avatar_generations&store_id=${storeId}`);
}

export function uploadAvatar(storeId, personaName, base64, mediaType) {
  return fetchJSON('/api/system?action=upload_avatar', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, persona_name: personaName, base64, media_type: mediaType }),
  });
}

export function setAvatarReference(storeId, personaName, url) {
  return fetchJSON('/api/system?action=set_avatar_reference', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, persona_name: personaName, url }),
  });
}

export function setAvatarActive(storeId, personaName, isActive) {
  return fetchJSON('/api/system?action=set_avatar_active', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, persona_name: personaName, is_active: isActive }),
  });
}

export function deleteAvatar(storeId, personaName) {
  return fetchJSON('/api/system?action=delete_avatar', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, persona_name: personaName }),
  });
}

// Shopify Webhooks
export function registerWebhooks(storeId) {
  return fetchJSON('/api/system?action=register_webhooks', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId }),
  });
}

export function listWebhooks(storeId) {
  return fetchJSON(`/api/system?action=list_webhooks&store_id=${storeId}`);
}

export function unregisterWebhooks(storeId) {
  return fetchJSON('/api/system?action=unregister_webhooks', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId }),
  });
}

// Product Reviews (Phase 1)
export function getProductReviews(productId, storeId) {
  return fetchJSON(`/api/system?action=product_reviews_list&product_id=${productId}&store_id=${storeId}`);
}

export function addReviewManual(payload) {
  return fetchJSON('/api/system?action=add_review_manual', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateReview(payload) {
  return fetchJSON('/api/system?action=update_review', { method: 'POST', body: JSON.stringify(payload) });
}

export function deleteReview(id, storeId) {
  return fetchJSON('/api/system?action=delete_review', { method: 'POST', body: JSON.stringify({ id, store_id: storeId }) });
}

export function setReviewStatus(ids, status, storeId) {
  return fetchJSON('/api/system?action=set_review_status', { method: 'POST', body: JSON.stringify({ ids, status, store_id: storeId }) });
}

// Bulk seed helpful_count (random in [min,max]) across a product's reviews.
export function seedReviewsHelpful(storeId, productId, min, max) {
  return fetchJSON('/api/system?action=seed_reviews_helpful', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, min, max }),
  });
}

// Bulk import (Phase 3) — pass either { csv } (paste / parsed file) or { sheet_url } (Google Sheets).
export function importReviewsCsv(storeId, productId, payload) {
  return fetchJSON('/api/system?action=import_reviews_csv', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, ...payload }),
  });
}

// Photo upload (Phase 4) — returns { photo_url }; caller persists it via update/add.
export function uploadReviewPhoto(storeId, productId, base64, mediaType) {
  return fetchJSON('/api/system?action=upload_review_photo', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, base64, media_type: mediaType }),
  });
}

// Remove an orphaned Storage photo (uploaded then removed/replaced without saving).
export function deleteReviewPhoto(photoUrl) {
  return fetchJSON('/api/system?action=delete_review_photo', {
    method: 'POST',
    body: JSON.stringify({ photo_url: photoUrl }),
  });
}

// AI generation (Phase 4) — count 1–10, tone 'positive' | 'mix' → inserts pending reviews.
export function generateReviewsAi(storeId, productId, count, tone) {
  return fetchJSON('/api/system?action=generate_reviews_ai', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, count, tone }),
  });
}

// Push (Phase 2) — rebuild approved+published reviews into Shopify metafields.
export function pushReviewsToShopify(storeId, productId) {
  return fetchJSON('/api/system?action=push_reviews_to_shopify', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId }),
  });
}

// Amazon review import — scrape a product page for a preview list (not saved yet).
export function scrapeAmazonPreview(storeId, productId, amazonUrl, maxReviews) {
  return fetchJSON('/api/system?action=scrape_amazon_preview', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, amazon_url: amazonUrl, max_reviews: maxReviews }),
  });
}

// Amazon review import — insert the user-selected subset of a preview as pending reviews.
export function importAmazonReviews(storeId, productId, reviews) {
  return fetchJSON('/api/system?action=import_amazon_reviews', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, reviews }),
  });
}

// Publications Manager
export function bulkMakeUnlisted(storeId, productShopifyIds) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({
      action: 'bulk_make_unlisted',
      store_id: storeId,
      product_shopify_ids: productShopifyIds,
    }),
  });
}

export function bulkMakeListed(storeId, productShopifyIds) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({
      action: 'bulk_make_listed',
      store_id: storeId,
      product_shopify_ids: productShopifyIds,
    }),
  });
}

// Users & Permissions
export function listUsers() {
  return fetchJSON('/api/system?action=users_list');
}

export function createUser(payload) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'create_user', ...payload }),
  });
}

export function updateUser(payload) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_user', ...payload }),
  });
}

export function deleteUser(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete_user', user_id: userId }),
  });
}

export function resetPassword(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset_password', user_id: userId }),
  });
}

export function generateApiToken(userId) {
  return fetchJSON('/api/system', {
    method: 'POST',
    body: JSON.stringify({ action: 'generate_api_token', user_id: userId }),
  });
}

// CSV export — cannot use fetchJSON because response is text/csv, not JSON.
// Downloads via anchor with object URL.
export async function exportProductsCsv(storeId, filters = {}) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/system`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'export_products_csv', store_id: storeId, filters }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.hint || body.details || body.error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  // Extract filename from Content-Disposition
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m ? m[1] : `products-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

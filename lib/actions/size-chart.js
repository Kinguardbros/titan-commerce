import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';
import { rateLimit } from '../rate-limit.js';
import {
  fetchSizeChartMetaobjects, getSizeChartById, upsertSizeChartByHandle, updateSizeChartById,
  scanProductsSizeCharts, setProductsSizeChart, removeProductsSizeChart, slugifyHandle,
  ShopifyUserError,
} from '../size-chart-shopify.js';
import { validateSizeChart } from '../size-chart-validate.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retired 2026-09-22: read_size_chart / save_size_chart / refresh_size_charts used to read
// and write a plain-text `custom.size_chart_text` metafield the Clara Atelier storefront theme
// never renders (it reads the `size_chart` metaobject via `custom.size_chart` instead — see
// SIZE-CHART-DATA-CONTRACT.md). Those three actions and the dashboard's SizeChartEditor.jsx
// are gone; everything below operates on the metaobject mechanism the theme actually reads.
// Any existing custom.size_chart_text values are left untouched in Shopify (never deleted,
// never written to) — size_charts_list/refresh_has_size_chart report how many products still
// carry one (`legacy_text_count`) purely for visibility, nothing more.

function chartToOut(c) {
  return {
    id: c.id, handle: c.handle, status: c.status,
    name: c.name, columns: c.columns, rows: c.rows, note: c.note, unit: c.unit,
  };
}

async function pickAvailableHandle(client, baseHandle) {
  const existing = await fetchSizeChartMetaobjects(client);
  const taken = new Set(existing.map((c) => c.handle));
  if (!taken.has(baseHandle)) return baseHandle;
  let n = 2;
  while (taken.has(`${baseHandle}-${n}`)) n += 1;
  return `${baseHandle}-${n}`;
}

// GET: size_charts_list — every size_chart metaobject for the store, with how many products
// currently reference each one (live count from Shopify, not a Titan-side copy).
export async function size_charts_list(req, res) {
  const storeId = req.query.store_id;
  if (!storeId) return res.status(400).json({ error: 'store_id required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(storeId);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const [charts, products] = await Promise.all([
    fetchSizeChartMetaobjects(client),
    scanProductsSizeCharts(client),
  ]);

  const countByGid = {};
  let legacyTextCount = 0;
  for (const p of products) {
    if (p.chartGid) countByGid[p.chartGid] = (countByGid[p.chartGid] || 0) + 1;
    if (p.legacyText) legacyTextCount += 1;
  }

  const list = charts.map((c) => ({
    ...chartToOut(c),
    column_count: c.columns.length,
    row_count: c.rows.length,
    product_count: countByGid[c.id] || 0,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return res.status(200).json({ charts: list, total_products: products.length, legacy_text_count: legacyTextCount });
}

// GET: size_chart_detail — one chart's full table + the products currently assigned to it +
// server-computed validation warnings (label mismatches, unit-in-header) for the current state.
export async function size_chart_detail(req, res) {
  const storeId = req.query.store_id;
  const chartId = req.query.chart_id;
  if (!storeId || !chartId) return res.status(400).json({ error: 'store_id and chart_id required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, storeId)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(storeId);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });

  const [chart, products] = await Promise.all([
    getSizeChartById(client, chartId),
    scanProductsSizeCharts(client),
  ]);
  if (!chart) return res.status(404).json({ error: 'Size chart not found' });

  const assigned = products.filter((p) => p.chartGid === chartId);
  const shopIds = assigned.map((p) => p.numericId);
  const { data: dbRows } = shopIds.length
    ? await supabase.from('products').select('id, shopify_id, title').eq('store_id', storeId).in('shopify_id', shopIds)
    : { data: [] };
  const dbByShopId = {};
  for (const r of (dbRows || [])) dbByShopId[String(r.shopify_id)] = r.id;

  const assignedOut = assigned.map((p) => ({
    shopify_id: p.numericId,
    product_id: dbByShopId[p.numericId] || null,
    title: p.title,
    handle: p.handle,
    size_option_values: p.sizeOptionValues,
  }));

  const validation = validateSizeChart(chart, assignedOut.map((p) => ({ title: p.title, sizeOptionValues: p.size_option_values })));

  return res.status(200).json({ chart: chartToOut(chart), products: assignedOut, validation });
}

// POST: validate_size_chart — dry-run validation, no writes. Used by the editor for live
// feedback before Save. `chart_id` is optional: when given, warnings are checked against
// that chart's currently-assigned products (live from Shopify); omitted for a brand-new
// chart, which naturally has nothing assigned yet.
export async function validate_size_chart(req, res) {
  const { store_id, chart_id, columns, rows, unit } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  if (!Array.isArray(columns) || !Array.isArray(rows)) return res.status(400).json({ error: 'columns[] and rows[] required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  let assignedProducts = [];
  if (chart_id) {
    const store = await getStore(store_id);
    if (store?.admin_token) {
      const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
      const products = await scanProductsSizeCharts(client);
      assignedProducts = products
        .filter((p) => p.chartGid === chart_id)
        .map((p) => ({ title: p.title, sizeOptionValues: p.sizeOptionValues }));
    }
  }

  return res.status(200).json(validateSizeChart({ columns, rows, unit }, assignedProducts));
}

// POST: create_size_chart — makes a brand-new size_chart metaobject (metaobjectUpsert, by a
// slugified/disambiguated handle so a name collision never silently overwrites another chart).
export async function create_size_chart(req, res) {
  const { store_id, name, columns, rows, note, unit } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  if (!name || !Array.isArray(columns) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'name, columns[], and rows[] are required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const { errors, warnings } = validateSizeChart({ columns, rows, unit });
  if (errors.length) return res.status(400).json({ error: 'Size chart failed validation', errors, warnings });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  if (!(await rateLimit(`size_chart_write:${store_id}`, 30, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 30 size-chart writes per minute per store' });
  }

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const handle = await pickAvailableHandle(client, slugifyHandle(name));

  let chart;
  try {
    chart = await upsertSizeChartByHandle(client, handle, { name, columns, rows, note, unit });
  } catch (e) {
    console.error('[size-chart] create failed:', { store_id, message: e.message });
    const detail = e instanceof ShopifyUserError ? e.userErrors : e.message;
    return res.status(400).json({ error: 'Shopify rejected the size chart', details: detail });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: 'info',
    message: `Created size chart "${name}" (${handle})`,
    metadata: { chart_id: chart.id, handle },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ chart: chartToOut(chart), warnings });
}

// POST: update_size_chart — the editor's Save, on an EXISTING chart. Writes via
// metaobjectUpdate (not upsert — the chart already has a gid).
export async function update_size_chart(req, res) {
  const { store_id, chart_id, name, columns, rows, note, unit } = req.body || {};
  if (!store_id || !chart_id) return res.status(400).json({ error: 'store_id and chart_id required' });
  if (!name || !Array.isArray(columns) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'name, columns[], and rows[] are required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });

  const products = await scanProductsSizeCharts(client);
  const assignedProducts = products
    .filter((p) => p.chartGid === chart_id)
    .map((p) => ({ title: p.title, sizeOptionValues: p.sizeOptionValues }));
  const { errors, warnings } = validateSizeChart({ columns, rows, unit }, assignedProducts);
  if (errors.length) return res.status(400).json({ error: 'Size chart failed validation', errors, warnings });

  if (!(await rateLimit(`size_chart_write:${store_id}`, 30, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 30 size-chart writes per minute per store' });
  }

  let chart;
  try {
    chart = await updateSizeChartById(client, chart_id, { name, columns, rows, note, unit });
  } catch (e) {
    console.error('[size-chart] update failed:', { store_id, chart_id, message: e.message });
    const detail = e instanceof ShopifyUserError ? e.userErrors : e.message;
    return res.status(400).json({ error: 'Shopify rejected the size chart', details: detail });
  }

  // Best-effort cache refresh for the products already pointing at this chart — Shopify
  // stays the source of truth, this only keeps the Products list display in sync without
  // waiting for the next full refresh_has_size_chart sweep.
  const shopIds = products.filter((p) => p.chartGid === chart_id).map((p) => p.numericId);
  if (shopIds.length) {
    // Supabase-js does not throw on a query error — it resolves { data: null, error } — so
    // this must check .error explicitly, not just wrap the call in try/catch, or a genuine
    // failure (e.g. the cache columns not migrated yet) is silently swallowed.
    const { error: cacheErr } = await supabase.from('products').update({ size_chart_name: chart.name }).eq('store_id', store_id).in('shopify_id', shopIds);
    if (cacheErr) console.error('[size-chart] cache update after edit failed (non-fatal):', { store_id, message: cacheErr.message });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: 'info',
    message: `Updated size chart "${chart.name}" (${chart.handle})`,
    metadata: { chart_id },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ chart: chartToOut(chart), warnings });
}

// POST: duplicate_size_chart — copies name/columns/rows/note/unit into a brand-new metaobject.
// Deliberately does NOT copy the source chart's product assignments: two charts claiming the
// same products would make "which chart does this product use" ambiguous, so a duplicate
// starts unassigned and the user assigns it to whichever products should actually diverge.
export async function duplicate_size_chart(req, res) {
  const { store_id, chart_id } = req.body || {};
  if (!store_id || !chart_id) return res.status(400).json({ error: 'store_id and chart_id required' });
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });

  const source = await getSizeChartById(client, chart_id);
  if (!source) return res.status(404).json({ error: 'Size chart not found' });

  const handle = await pickAvailableHandle(client, slugifyHandle(`${source.handle}-copy`));
  const name = `${source.name} (Copy)`;

  let chart;
  try {
    chart = await upsertSizeChartByHandle(client, handle, {
      name, columns: source.columns, rows: source.rows, note: source.note, unit: source.unit,
    });
  } catch (e) {
    console.error('[size-chart] duplicate failed:', { store_id, chart_id, message: e.message });
    const detail = e instanceof ShopifyUserError ? e.userErrors : e.message;
    return res.status(400).json({ error: 'Shopify rejected the duplicate', details: detail });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: 'info',
    message: `Duplicated size chart "${source.name}" → "${name}" (${handle})`,
    metadata: { source_chart_id: chart_id, chart_id: chart.id, handle },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ chart: chartToOut(chart) });
}

const ASSIGN_HARD_CAP = 500; // matches publications.js's bulk cap

// POST: assign_size_chart_products — point a set of Titan product ids at a chart. Used both
// from a chart's detail view ("add products") and from the Products list ("assign to a
// filtered/bulk selection") — the operation is identical either way.
export async function assign_size_chart_products(req, res) {
  const { store_id, chart_id, product_ids } = req.body || {};
  if (!store_id || !chart_id || !Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ error: 'store_id, chart_id, and product_ids[] required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  if (product_ids.length > ASSIGN_HARD_CAP) {
    return res.status(413).json({ error: `Batch too large — max ${ASSIGN_HARD_CAP} products per call` });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  if (!(await rateLimit(`size_chart_write:${store_id}`, 30, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 30 size-chart writes per minute per store' });
  }

  const { data: dbProducts, error } = await supabase
    .from('products').select('id, shopify_id').eq('store_id', store_id).in('id', product_ids);
  if (error) throw error;
  const withShopifyId = (dbProducts || []).filter((p) => p.shopify_id);
  if (!withShopifyId.length) return res.status(400).json({ error: 'None of the selected products have a Shopify id — run a sync first' });

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const gids = withShopifyId.map((p) => `gid://shopify/Product/${p.shopify_id}`);
  const { updated, errors } = await setProductsSizeChart(client, gids, chart_id);

  try {
    const chart = await getSizeChartById(client, chart_id);
    // See the comment on the equivalent update in update_size_chart — Supabase-js resolves
    // { error } rather than throwing, so it must be checked explicitly.
    const { error: cacheErr } = await supabase.from('products')
      .update({ has_size_chart: true, size_chart_id: chart_id, size_chart_name: chart?.name || null })
      .eq('store_id', store_id).in('id', withShopifyId.map((p) => p.id));
    if (cacheErr) console.error('[size-chart] cache update after assign failed (non-fatal):', { store_id, message: cacheErr.message });
  } catch (e) {
    console.error('[size-chart] cache update after assign failed (non-fatal):', { store_id, message: e.message });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: errors.length ? 'warn' : 'info',
    message: `Assigned size chart to ${updated}/${withShopifyId.length} products`,
    metadata: { chart_id, updated, requested: withShopifyId.length, errors },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ updated, requested: withShopifyId.length, errors });
}

// POST: unassign_size_chart_products — remove the custom.size_chart reference from a set of
// Titan product ids (the reverse of assign; also usable in bulk from the Products list).
export async function unassign_size_chart_products(req, res) {
  const { store_id, product_ids } = req.body || {};
  if (!store_id || !Array.isArray(product_ids) || product_ids.length === 0) {
    return res.status(400).json({ error: 'store_id and product_ids[] required' });
  }
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  if (product_ids.length > ASSIGN_HARD_CAP) {
    return res.status(413).json({ error: `Batch too large — max ${ASSIGN_HARD_CAP} products per call` });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  if (!(await rateLimit(`size_chart_write:${store_id}`, 30, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 30 size-chart writes per minute per store' });
  }

  const { data: dbProducts, error } = await supabase
    .from('products').select('id, shopify_id').eq('store_id', store_id).in('id', product_ids);
  if (error) throw error;
  const withShopifyId = (dbProducts || []).filter((p) => p.shopify_id);
  if (!withShopifyId.length) return res.status(400).json({ error: 'None of the selected products have a Shopify id' });

  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });
  const gids = withShopifyId.map((p) => `gid://shopify/Product/${p.shopify_id}`);
  const { updated, errors } = await removeProductsSizeChart(client, gids);

  try {
    const { error: cacheErr } = await supabase.from('products')
      .update({ has_size_chart: false, size_chart_id: null, size_chart_name: null })
      .eq('store_id', store_id).in('id', withShopifyId.map((p) => p.id));
    if (cacheErr) console.error('[size-chart] cache update after unassign failed (non-fatal):', { store_id, message: cacheErr.message });
  } catch (e) {
    console.error('[size-chart] cache update after unassign failed (non-fatal):', { store_id, message: e.message });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SIZE_CHART', level: errors.length ? 'warn' : 'info',
    message: `Removed size chart from ${updated}/${withShopifyId.length} products`,
    metadata: { updated, requested: withShopifyId.length, errors },
    user_id: req.user?.user_id || null, initiator: 'user',
  });

  return res.status(200).json({ updated, requested: withShopifyId.length, errors });
}

// POST: refresh_has_size_chart — full-store reconciliation sweep. Re-derives has_size_chart /
// size_chart_id / size_chart_name for every product from Shopify's real metafield state (the
// only source of truth) and reports how many products still carry the old, unread
// custom.size_chart_text value — read-only for that field, never written.
export async function refresh_has_size_chart(req, res) {
  const { store_id } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });
  if (!hasPermission(req.user, 'products:read')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:read permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin token' });
  const client = createShopifyClient(store.shopify_url, store.admin_token, { storeId: store.id });

  const [products, charts] = await Promise.all([
    scanProductsSizeCharts(client),
    fetchSizeChartMetaobjects(client),
  ]);
  const nameByGid = {};
  for (const c of charts) nameByGid[c.id] = c.name;

  let withChart = 0;
  let legacyTextCount = 0;
  let cacheFailures = 0;
  for (const p of products) {
    if (p.legacyText) legacyTextCount += 1;
    const has = !!p.chartGid;
    if (has) withChart += 1;
    // Supabase-js resolves { error } rather than throwing — checked explicitly below (same
    // reasoning as the other cache-update call sites in this file). Logged once in full,
    // then just counted, so a store-wide migration gap (e.g. size_chart_id/size_chart_name
    // not yet applied) doesn't spam ~300 identical lines.
    const { error: cacheErr } = await supabase.from('products').update({
      has_size_chart: has,
      size_chart_id: p.chartGid || null,
      size_chart_name: p.chartGid ? (nameByGid[p.chartGid] || null) : null,
    }).eq('store_id', store_id).eq('shopify_id', p.numericId);
    if (cacheErr) {
      cacheFailures += 1;
      if (cacheFailures === 1) console.error('[size-chart] refresh cache update failed (non-fatal, logged once):', { store_id, shopify_id: p.numericId, message: cacheErr.message });
    }
  }

  return res.status(200).json({ total: products.length, with_size_chart: withChart, legacy_text_count: legacyTextCount, cache_update_failures: cacheFailures });
}

// POST: parse_size_chart_image (Claude Vision) — unchanged from the old mechanism. Still
// useful on its own: extracts a CSV table from a screenshot, which the new editor's "Import
// from image" turns into columns/rows for a chart draft (create or edit) before saving.
export async function parse_size_chart_image(req, res) {
  const { image_url } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  if (!hasPermission(req.user, 'products:edit')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  }
  // No store_id/product_id in this request (pure image → CSV text parsing) — cannot
  // resolve a store to check hasStoreAccess against. Gated on products:edit capability only.

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
    model: 'claude-sonnet-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: imageSource },
        { type: 'text', text: 'Extract the size chart from this image.\nIf sizes are in COLUMNS (horizontal), transpose them to ROWS.\nAlways return CSV format where each ROW is one size:\n\nFirst line = headers: Size, [measurement names]\nEach next line = one size with values.\n\nExample output:\nSize, Bust (cm), Waist (cm), Hips (cm)\nS, 86, 66, 91\nM, 90, 70, 95\nL, 94, 74, 99\n\nHandle transposed tables, multiple sections, and merged cells.\nReturn ONLY the CSV text, nothing else.' },
      ],
    }],
  });

  // Not content[0]: current models can lead with a non-text block (e.g. an empty
  // thinking block), which silently yielded an empty CSV on some images.
  let csvText = (response.content || []).find((b) => b.type === 'text')?.text?.trim() || '';
  // The prompt asks for bare CSV, but the model sometimes wraps it in a markdown
  // fence (```csv ... ```), which every downstream CSV parser then chokes on.
  // Same defence custom-styles.js already applies to its JSON replies.
  if (csvText.startsWith('```')) {
    csvText = csvText.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  }
  return res.status(200).json({ csv: csvText });
}

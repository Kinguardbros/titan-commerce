// Shopify Admin GraphQL helpers for the `size_chart` metaobject mechanism.
//
// Contract: ~/Desktop/Projects/active/clara-atelier/SIZE-CHART-DATA-CONTRACT.md
// A shared metaobject of type `size_chart` (fields name/columns/rows/note/unit, columns
// and rows JSON-encoded as strings) is referenced from a product metafield
// `custom.size_chart` of type `metaobject_reference`. Titan is the control surface over
// that Shopify data — this module never stores chart content in Supabase, only reads and
// writes it live via `client.graphql()` (lib/shopify-admin.js, which already carries the
// reactive admin-token refresh + retry-once-on-401 behavior when constructed with
// `{ storeId }`).
//
// `client.graphql(query, variables)` returns the raw parsed response body, i.e.
// `{ data: {...} }` or `{ errors: [...] }` on a GraphQL-level failure (HTTP 200) — it only
// throws on a non-2xx HTTP status. Every helper here checks both `result.errors` and the
// mutation's own `userErrors`, matching the pattern already used in
// lib/actions/publications.js.

export const METAFIELDS_BATCH_SIZE = 25; // Shopify's own cap for metafieldsSet/metafieldsDelete

const SIZE_OPTION_NAME_RE = /gr[oö0]ß?e|size/i; // matches Größe/Grösse/Groesse/Size

export class ShopifyUserError extends Error {
  constructor(message, userErrors) {
    super(message);
    this.name = 'ShopifyUserError';
    this.userErrors = userErrors;
  }
}

function assertNoErrors(result, mutationField) {
  if (result?.errors?.length) {
    throw new ShopifyUserError(result.errors.map((e) => e.message).join('; '), result.errors);
  }
  const userErrors = result?.data?.[mutationField]?.userErrors;
  if (userErrors?.length) {
    throw new ShopifyUserError(userErrors.map((e) => e.message).join('; '), userErrors);
  }
}

/** Find the product's size-like option (Größe/Size) and return its values, or null if none. */
export function findSizeOptionValues(options) {
  if (!Array.isArray(options)) return null;
  const opt = options.find((o) => SIZE_OPTION_NAME_RE.test(o?.name || ''));
  if (!opt) return null;
  if (Array.isArray(opt.values)) return opt.values;
  if (Array.isArray(opt.optionValues)) return opt.optionValues.map((v) => v.name);
  return null;
}

export function parseChartFields(fields) {
  const raw = {};
  for (const f of fields || []) raw[f.key] = f.value;
  let columns = [];
  let rows = [];
  try { columns = JSON.parse(raw.columns || '[]'); } catch { columns = []; }
  try { rows = JSON.parse(raw.rows || '[]'); } catch { rows = []; }
  return {
    name: raw.name || '',
    columns: Array.isArray(columns) ? columns : [],
    rows: Array.isArray(rows) ? rows : [],
    note: raw.note || '',
    unit: raw.unit || 'cm',
  };
}

export function slugifyHandle(name) {
  let s = (name || '').trim().toLowerCase();
  s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'chart';
}

function buildChartFields({ name, columns, rows, note, unit }) {
  return [
    { key: 'name', value: name || '' },
    { key: 'columns', value: JSON.stringify(columns || []) },
    { key: 'rows', value: JSON.stringify(rows || []) },
    { key: 'note', value: note || '' },
    { key: 'unit', value: unit || 'cm' },
  ];
}

function toChartOut(metaobject) {
  return {
    id: metaobject.id,
    handle: metaobject.handle,
    status: metaobject.capabilities?.publishable?.status || null,
    ...parseChartFields(metaobject.fields),
  };
}

const METAOBJECTS_LIST_QUERY = `
query($first: Int!) {
  metaobjects(type: "size_chart", first: $first) {
    nodes { id handle capabilities { publishable { status } } fields { key value } }
  }
}`;

/** List every `size_chart` metaobject for the store. Assumes < 250 charts (true for these catalogs). */
export async function fetchSizeChartMetaobjects(client) {
  const result = await client.graphql(METAOBJECTS_LIST_QUERY, { first: 250 });
  if (result?.errors?.length) throw new ShopifyUserError(result.errors.map((e) => e.message).join('; '), result.errors);
  const nodes = result?.data?.metaobjects?.nodes || [];
  return nodes.map(toChartOut);
}

const METAOBJECT_GET_QUERY = `
query($id: ID!) {
  metaobject(id: $id) { id handle capabilities { publishable { status } } fields { key value } }
}`;

export async function getSizeChartById(client, gid) {
  const result = await client.graphql(METAOBJECT_GET_QUERY, { id: gid });
  if (result?.errors?.length) throw new ShopifyUserError(result.errors.map((e) => e.message).join('; '), result.errors);
  const node = result?.data?.metaobject;
  return node ? toChartOut(node) : null;
}

const METAOBJECT_UPSERT_MUTATION = `
mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id handle capabilities { publishable { status } } fields { key value } }
    userErrors { field message code }
  }
}`;

/** Create (or idempotently reuse, by handle) a size_chart metaobject. Always publishable ACTIVE
 * — a DRAFT metaobject renders no Größentabelle link on the storefront (contract §4.1). */
export async function upsertSizeChartByHandle(client, handle, chart) {
  const result = await client.graphql(METAOBJECT_UPSERT_MUTATION, {
    handle: { type: 'size_chart', handle },
    metaobject: {
      capabilities: { publishable: { status: 'ACTIVE' } },
      fields: buildChartFields(chart),
    },
  });
  assertNoErrors(result, 'metaobjectUpsert');
  return toChartOut(result.data.metaobjectUpsert.metaobject);
}

const METAOBJECT_UPDATE_MUTATION = `
mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $metaobject) {
    metaobject { id handle capabilities { publishable { status } } fields { key value } }
    userErrors { field message code }
  }
}`;

/** Save edits to an existing chart by id (the editor's Save button — task requires `metaobjectUpdate`
 * specifically, not upsert, once the chart already has a gid). */
export async function updateSizeChartById(client, gid, chart) {
  const result = await client.graphql(METAOBJECT_UPDATE_MUTATION, {
    id: gid,
    metaobject: {
      capabilities: { publishable: { status: 'ACTIVE' } },
      fields: buildChartFields(chart),
    },
  });
  assertNoErrors(result, 'metaobjectUpdate');
  return toChartOut(result.data.metaobjectUpdate.metaobject);
}

const PRODUCTS_SIZE_SCAN_QUERY = `
query($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      options { name values }
      chart: metafield(namespace: "custom", key: "size_chart") { value }
      legacyText: metafield(namespace: "custom", key: "size_chart_text") { value }
    }
  }
}`;

/**
 * Paginate every product in the store once, returning each one's real size option values
 * (for the label-mismatch warning), its current `custom.size_chart` metaobject reference
 * (for chart→product counts and assignment listings), and whether it still carries the old,
 * disconnected `custom.size_chart_text` metafield (for the retirement report — read-only,
 * never written back here).
 */
export async function scanProductsSizeCharts(client, { pageSize = 250 } = {}) {
  const out = [];
  let after = null;
  for (;;) {
    const result = await client.graphql(PRODUCTS_SIZE_SCAN_QUERY, { first: pageSize, after });
    if (result?.errors?.length) throw new ShopifyUserError(result.errors.map((e) => e.message).join('; '), result.errors);
    const conn = result?.data?.products;
    if (!conn) break;
    for (const n of conn.nodes) {
      out.push({
        gid: n.id,
        numericId: n.id.split('/').pop(),
        title: n.title,
        handle: n.handle,
        sizeOptionValues: findSizeOptionValues(n.options),
        chartGid: n.chart?.value || null,
        legacyText: n.legacyText?.value || null,
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

const METAFIELDS_SET_MUTATION = `
mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key namespace value owner { ... on Product { id handle } } }
    userErrors { field message code }
  }
}`;

/** Point every product gid at `chartGid`, in batches of at most 25 (Shopify's cap; also
 * what scripts/import-size-charts.mjs and tools/attach-size-chart.py already do). */
export async function setProductsSizeChart(client, productGids, chartGid) {
  let updated = 0;
  const errors = [];
  for (let i = 0; i < productGids.length; i += METAFIELDS_BATCH_SIZE) {
    const batch = productGids.slice(i, i + METAFIELDS_BATCH_SIZE).map((gid) => ({
      ownerId: gid, namespace: 'custom', key: 'size_chart', type: 'metaobject_reference', value: chartGid,
    }));
    const result = await client.graphql(METAFIELDS_SET_MUTATION, { metafields: batch });
    if (result?.errors?.length) { errors.push(...result.errors.map((e) => e.message)); continue; }
    const userErrors = result?.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length) errors.push(...userErrors.map((e) => e.message));
    updated += result?.data?.metafieldsSet?.metafields?.length || 0;
  }
  return { updated, errors };
}

const METAFIELDS_DELETE_MUTATION = `
mutation($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields { key namespace ownerId }
    userErrors { field message }
  }
}`;

/** Remove the `custom.size_chart` reference from every product gid, in batches of 25. */
export async function removeProductsSizeChart(client, productGids) {
  let updated = 0;
  const errors = [];
  for (let i = 0; i < productGids.length; i += METAFIELDS_BATCH_SIZE) {
    const batch = productGids.slice(i, i + METAFIELDS_BATCH_SIZE).map((gid) => ({
      ownerId: gid, namespace: 'custom', key: 'size_chart',
    }));
    const result = await client.graphql(METAFIELDS_DELETE_MUTATION, { metafields: batch });
    if (result?.errors?.length) { errors.push(...result.errors.map((e) => e.message)); continue; }
    const userErrors = result?.data?.metafieldsDelete?.userErrors || [];
    if (userErrors.length) errors.push(...userErrors.map((e) => e.message));
    updated += result?.data?.metafieldsDelete?.deletedMetafields?.length || 0;
  }
  return { updated, errors };
}

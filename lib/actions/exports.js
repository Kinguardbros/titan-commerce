import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARD_CAP = 5000;

// RFC 4180: wrap in double-quotes and double-escape internal quotes when the value
// contains a comma, newline, or quote. Empty / null values become empty string.
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function visibilityOf(row) {
  if (row.status === 'archived') return 'archived';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'active') {
    return row.publication_online_store === false ? 'unlisted' : 'listed';
  }
  return 'unknown';
}

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function export_products_csv(req, res) {
  const { store_id, filters } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store) return res.status(400).json({ error: 'store not found' });

  // Base query — whitelist only the columns we need (defense-in-depth against info-disclosure)
  let query = supabase
    .from('products')
    .select('title, shopify_id, status, publication_online_store')
    .eq('store_id', store_id);

  // Optional server-side filter (mirrors UI filters). Client-computed filters can be
  // applied post-fetch if needed; this covers the low-cardinality ones.
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  query = query.limit(HARD_CAP);

  const { data, error } = await query;
  if (error) {
    console.error('[exports] products query failed:', error);
    return res.status(500).json({ error: 'export query failed' });
  }

  // Build Shopify Admin URL per product (canonical 2023+ format).
  // Prefer store.shopify_handle (custom store name) — falls back to shopify_url subdomain.
  const adminBase = store.shopify_handle
    ? `https://admin.shopify.com/store/${store.shopify_handle}/products`
    : `https://${store.shopify_url}/admin/products`;

  const header = 'title,admin_url,visibility';
  const rows = (data || []).map((r) =>
    [csvEscape(r.title), csvEscape(r.shopify_id ? `${adminBase}/${r.shopify_id}` : ''), visibilityOf(r)].join(','),
  );
  // ﻿ = UTF-8 BOM — makes Excel recognize the file as UTF-8 (avoids mojibake on Windows)
  const body = '﻿' + [header, ...rows].join('\n') + '\n';

  const slug = store.slug || String(store_id).slice(0, 8);
  const filename = `products-${slug}-${todayIso()}.csv`;

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(body);
}

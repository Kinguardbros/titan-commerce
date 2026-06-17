import { rateLimit } from '../rate-limit.js';
import { supabase, dropExistingDuplicates, safePhotoUrl } from './reviews-shared.js';

// Phase 3 — bulk CSV / Google Sheets import.

// Minimal CSV parser (no dependency) — respects "..."-quoted fields with embedded
// commas/newlines and "" escaping. Header line is required and skipped.
// Expected columns: author,rating,title,body,date,photo_url,verified
export function parseReviewsCsv(text) {
  const records = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); records.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); records.push(row); }

  const rows = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return [];
  rows.shift(); // drop header

  return rows.map((cells) => {
    const [author, rating, title, body, date, photo_url, verified] = cells.map((c) => (c ?? '').trim());
    return {
      author, rating: parseInt(rating, 10), title, body,
      review_date: date || null,
      photo_url: photo_url || null,
      verified: ['1', 'true', 'yes'].includes((verified || '').toLowerCase()),
    };
  });
}

// Turn a Google Sheets share URL into its CSV export endpoint.
function toSheetsCsvUrl(url) {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

// POST: import_reviews_csv — bulk insert from CSV text or a Google Sheets URL.
// { store_id, product_id, csv?, sheet_url? } → { inserted, skipped }. All rows land as pending/source='csv'.
export async function import_reviews_csv(req, res) {
  if (!await rateLimit('import_reviews_csv', 20, 3600000)) {
    return res.status(429).json({ error: 'Rate limit exceeded — try again later' });
  }
  const { store_id, product_id, sheet_url } = req.body;
  let { csv } = req.body;
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });

  // Verify the product belongs to this store before importing into it.
  const { data: product } = await supabase.from('products')
    .select('id').eq('id', product_id).eq('store_id', store_id).single();
  if (!product) return res.status(404).json({ error: 'Product not found in this store' });

  // Google Sheets URL → fetch its CSV export server-side (avoids browser CORS).
  if (!csv && sheet_url) {
    const csvUrl = toSheetsCsvUrl(sheet_url);
    if (!csvUrl) return res.status(400).json({ error: 'Not a valid Google Sheets URL' });
    const r = await fetch(csvUrl);
    if (!r.ok) return res.status(400).json({ error: 'Failed to fetch sheet — is it shared as "anyone with the link"?' });
    csv = await r.text();
  }
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv or sheet_url required' });

  const parsed = parseReviewsCsv(csv);
  const valid = [];
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const r of parsed) {
    if (!r.author || !r.body || !(r.rating >= 1 && r.rating <= 5)) { skipped++; continue; }
    valid.push({
      store_id, product_id,
      author: r.author, rating: r.rating,
      title: r.title || null, body: r.body,
      review_date: r.review_date || today,
      photo_url: safePhotoUrl(r.photo_url), verified: r.verified,
      source: 'csv', status: 'pending',
    });
  }

  let inserted = 0;
  let duplicates = 0;
  if (valid.length) {
    // Drop rows already present for this product (same author+body) → re-import is safe.
    const fresh = await dropExistingDuplicates(supabase, store_id, product_id, valid);
    duplicates = valid.length - fresh.length;
    if (fresh.length) {
      const { data, error } = await supabase.from('product_reviews').insert(fresh).select('id');
      if (error) throw error;
      inserted = data?.length || 0;
    }
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'REVIEWS', level: 'info',
    message: `Imported ${inserted} review(s) from ${sheet_url ? 'Google Sheets' : 'CSV'} (${skipped} skipped, ${duplicates} duplicate)`,
  });

  return res.status(200).json({ inserted, skipped, duplicates });
}

-- P0-3 (Docs/AUDIT-2026-08.md): backfill orphaned manual_adspend rows
-- Run manually in Supabase SQL Editor after review. NOT run automatically.
--
-- Context: lib/actions/pricing.js's manual_adspend upsert never set store_id,
-- so every manual TikTok/Pinterest/other spend entry created after the
-- sql/add-stores.sql migration (which only backfilled pre-existing rows to
-- 'elegance-house') landed with store_id = NULL. Once profit_summary started
-- filtering manual_adspend by store_id (this same fix), any NULL-store_id row
-- stopped showing up in ANY store's Profit tab.
--
-- We don't know which store each orphaned row was actually meant for — the
-- old form gave no store context. Tagging them all to Isola (the largest
-- store) is a best-effort guess so the spend isn't silently lost. Review the
-- rows below before running the UPDATE; if any entry looks like it belongs to
-- Elegance House or Eleganz Haus, move it manually first.

-- 1. Inspect orphaned rows before deciding
-- SELECT * FROM manual_adspend WHERE store_id IS NULL ORDER BY date DESC;

-- 2. One-time backfill: attach orphan manual_adspend rows to Isola
UPDATE manual_adspend SET store_id = (SELECT id FROM stores WHERE slug = 'isola') WHERE store_id IS NULL;

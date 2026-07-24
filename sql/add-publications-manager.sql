-- Publications Manager feature migration (2026-07-23)
-- Paste into Supabase SQL Editor. No BEGIN/COMMIT — Supabase editor runs single statements.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS online_store_publication_id TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS publication_online_store BOOLEAN DEFAULT true;

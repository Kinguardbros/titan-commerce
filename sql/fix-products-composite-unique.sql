-- Migrate products.shopify_id and products.handle from GLOBAL UNIQUE to
-- COMPOSITE UNIQUE (store_id, X). Enables new stores to have products
-- with overlapping handles/shopify_ids that would previously silently fail
-- to sync (P0-4, Docs/AUDIT-2026-08.md).
--
-- Run this manually in the Supabase SQL Editor. Dan: do NOT auto-apply.
--
-- STEP 0 — run this FIRST and inspect the output. Supabase's auto-generated
-- constraint names usually match the Postgres default pattern used below
-- (products_handle_key, products_shopify_id_key), but may differ on this
-- project. If they differ, adjust the two DROP CONSTRAINT names in STEP 2
-- to match what this query actually returns:
--
--   SELECT constraint_name, constraint_type FROM information_schema.table_constraints
--   WHERE table_name = 'products' AND constraint_type = 'UNIQUE';
--
-- Idempotent: safe to run more than once (pre-flight re-checks current state,
-- DROP CONSTRAINT IF EXISTS no-ops on the second run, ADD CONSTRAINT is
-- guarded against "already exists").

-- STEP 1 — Pre-flight audit: fail loudly if any existing rows would violate
-- the new composite constraint. Should be 0/0 on a healthy DB — if not,
-- investigate and de-duplicate the offending rows before re-running this
-- migration (do not proceed past a failed pre-flight).
DO $$
DECLARE
  handle_dupes INT;
  shopify_id_dupes INT;
BEGIN
  SELECT COUNT(*) INTO handle_dupes FROM (
    SELECT store_id, handle FROM products WHERE handle IS NOT NULL
    GROUP BY store_id, handle HAVING COUNT(*) > 1
  ) t;
  SELECT COUNT(*) INTO shopify_id_dupes FROM (
    SELECT store_id, shopify_id FROM products WHERE shopify_id IS NOT NULL
    GROUP BY store_id, shopify_id HAVING COUNT(*) > 1
  ) t;
  IF handle_dupes > 0 OR shopify_id_dupes > 0 THEN
    RAISE EXCEPTION 'Pre-flight FAIL: % handle collisions, % shopify_id collisions within the same store. Fix duplicates before running this migration.', handle_dupes, shopify_id_dupes;
  END IF;
END$$;

-- STEP 2 — Drop the old global unique constraints. Names may vary by Supabase
-- auto-generation — this uses the standard Postgres naming pattern
-- (<table>_<column>_key); adjust if the STEP 0 query showed different names.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_handle_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopify_id_key;

-- STEP 3 — Add composite unique constraints, scoped per store. Guarded with
-- DO blocks (instead of a bare ADD CONSTRAINT) because Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS" — this makes re-running the migration a
-- no-op instead of an error.
DO $$
BEGIN
  ALTER TABLE products ADD CONSTRAINT products_store_handle_unique UNIQUE (store_id, handle);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'products_store_handle_unique already exists, skipping';
END$$;

DO $$
BEGIN
  ALTER TABLE products ADD CONSTRAINT products_store_shopify_id_unique UNIQUE (store_id, shopify_id);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'products_store_shopify_id_unique already exists, skipping';
END$$;

-- STEP 4 — Verify. Should list products_store_handle_unique and
-- products_store_shopify_id_unique, and NOT list products_handle_key /
-- products_shopify_id_key.
-- SELECT constraint_name, constraint_type FROM information_schema.table_constraints
-- WHERE table_name = 'products' AND constraint_type = 'UNIQUE';

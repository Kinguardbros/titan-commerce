-- Sprint 4: Multi-store architecture
-- Run in Supabase SQL Editor

-- 1. Stores table
CREATE TABLE IF NOT EXISTS stores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    shopify_url     TEXT,
    shopify_handle  TEXT,
    storefront_token TEXT,
    admin_token     TEXT,
    currency        TEXT DEFAULT 'EUR',
    brand_config    JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Insert stores (TOKENS ARE IN SUPABASE DB — DO NOT HARDCODE HERE)
-- After running this migration, manually set tokens in Supabase SQL Editor:
--   UPDATE stores SET storefront_token = 'your_token', admin_token = 'your_token' WHERE slug = 'elegance-house';
--   UPDATE stores SET storefront_token = 'your_token' WHERE slug = 'isola';

INSERT INTO stores (name, slug, shopify_url, shopify_handle, currency) VALUES
('Elegance House', 'elegance-house', 'shop-elegancehouse.myshopify.com', 'shop-elegancehouse', 'EUR')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stores (name, slug, shopify_url, shopify_handle, currency) VALUES
('Isola', 'isola', 'swimwear-brand.myshopify.com', 'swimwear-brand', 'USD')
ON CONFLICT (slug) DO NOTHING;

-- 3. Add store_id to all relevant tables
ALTER TABLE products ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE product_optimizations ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE manual_adspend ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE performance ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 4. Backfill existing data with Elegance House store_id
UPDATE products SET store_id = (SELECT id FROM stores WHERE slug = 'elegance-house') WHERE store_id IS NULL;
UPDATE creatives SET store_id = (SELECT id FROM stores WHERE slug = 'elegance-house') WHERE store_id IS NULL;
UPDATE pipeline_log SET store_id = (SELECT id FROM stores WHERE slug = 'elegance-house') WHERE store_id IS NULL;
UPDATE product_optimizations SET store_id = (SELECT id FROM stores WHERE slug = 'elegance-house') WHERE store_id IS NULL;
UPDATE manual_adspend SET store_id = (SELECT id FROM stores WHERE slug = 'elegance-house') WHERE store_id IS NULL;

-- 4b. Composite unique constraints for products (P0-4, Docs/AUDIT-2026-08.md)
-- products.shopify_id / products.handle used to be globally UNIQUE at CREATE
-- time (sql/products.sql) — before store_id existed. Now that store_id has
-- just been added and backfilled above, scope uniqueness per store, so two
-- stores can share a generic handle (e.g. 'black-dress') without a Postgres
-- unique violation on sync. On a DB that still has the old global UNIQUE
-- constraints (pre-fix), run sql/fix-products-composite-unique.sql instead —
-- it drops those first. Guarded with DO blocks (no "ADD CONSTRAINT IF NOT
-- EXISTS" in Postgres) so re-running this file is a no-op here too.
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

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_creatives_store ON creatives(store_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_store ON pipeline_log(store_id);

-- 6. RLS for stores table
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_stores" ON stores FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_stores" ON stores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_stores" ON stores FOR UPDATE TO authenticated USING (true);

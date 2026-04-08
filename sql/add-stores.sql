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

-- 2. Insert stores
INSERT INTO stores (name, slug, shopify_url, shopify_handle, storefront_token, admin_token, currency) VALUES
('Elegance House', 'elegance-house', 'shop-elegancehouse.com', 'shop-elegancehouse', 'STOREFRONT_TOKEN_HERE', 'ADMIN_TOKEN_HERE', 'EUR')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO stores (name, slug, shopify_url, shopify_handle, storefront_token, admin_token, currency) VALUES
('Isola', 'isola', 'isolaworld.com', 'swimwear-brand', 'STOREFRONT_TOKEN_HERE', NULL, 'USD')
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

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_creatives_store ON creatives(store_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_store ON pipeline_log(store_id);

-- 6. RLS for stores table
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_stores" ON stores FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_stores" ON stores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_stores" ON stores FOR UPDATE TO authenticated USING (true);

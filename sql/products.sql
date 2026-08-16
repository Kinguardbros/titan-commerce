-- Products table (synced from Shopify)
-- Run this in Supabase SQL Editor
--
-- NOTE (P0-4, Docs/AUDIT-2026-08.md): shopify_id and handle are intentionally
-- NOT globally UNIQUE here. store_id doesn't exist yet at this point in the
-- migration order (it's added later by sql/add-stores.sql), so a composite
-- UNIQUE(store_id, X) can't be declared in this CREATE TABLE. Fresh installs
-- get the composite constraints from sql/add-stores.sql (run right after this
-- file). Existing/live DBs that already have the old global UNIQUE
-- constraints from before this fix must run sql/fix-products-composite-unique.sql
-- instead (drops the global constraints, adds the composite ones).

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_id      BIGINT NOT NULL,  -- was UNIQUE NOT NULL — see note above
    handle          TEXT NOT NULL,    -- was UNIQUE NOT NULL — see note above
    title           TEXT NOT NULL,
    price           TEXT,
    description     TEXT,
    image_url       TEXT,                    -- Primary product image
    images          JSONB DEFAULT '[]',      -- All product image URLs
    product_url     TEXT,
    product_type    TEXT,
    vendor          TEXT,
    tags            JSONB DEFAULT '[]',
    synced_at       TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Add product_id and style to creatives
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS style TEXT DEFAULT 'ad_creative'
    CHECK (style IN ('ad_creative', 'product_shot', 'lifestyle', 'review_ugc'));

-- Indexes
CREATE INDEX idx_products_handle ON products(handle);
CREATE INDEX idx_creatives_product_id ON creatives(product_id);
CREATE INDEX idx_creatives_style ON creatives(style);

-- Enable Realtime for products
ALTER PUBLICATION supabase_realtime ADD TABLE products;

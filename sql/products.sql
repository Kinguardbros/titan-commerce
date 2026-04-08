-- Products table (synced from Shopify)
-- Run this in Supabase SQL Editor

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shopify_id      BIGINT UNIQUE NOT NULL,
    handle          TEXT UNIQUE NOT NULL,
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

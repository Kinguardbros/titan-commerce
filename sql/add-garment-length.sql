-- Adds a column to cache Claude Vision's garment-length classification per product.
-- Populated lazily on the first Product Catalog v1 generation for each product;
-- reused on every subsequent generation. Values: 'short' | 'mid' | 'long' | NULL (uncached).

ALTER TABLE products ADD COLUMN IF NOT EXISTS garment_length TEXT;

-- Optional helper index for re-classification batch jobs (rare).
CREATE INDEX IF NOT EXISTS idx_products_garment_length ON products (garment_length) WHERE garment_length IS NOT NULL;

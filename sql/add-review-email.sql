-- Product Reviews — public web submission (Wave 1).
-- Adds optional email column + allows source='web'. Run once in Supabase SQL Editor.

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS email TEXT;

-- Allow 'web' as a review source (visitor-submitted via storefront form).
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web'));

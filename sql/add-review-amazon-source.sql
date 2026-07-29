-- Add 'amazon' to product_reviews.source CHECK constraint (2026-07-29)
-- Extends existing CHECK from ('manual','csv','ai','web') to include 'amazon'.
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single statements.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon'));

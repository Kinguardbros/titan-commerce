-- Add 'cupshe' to product_reviews.source CHECK constraint (2026-08-03, feature-09).
-- Follows same DROP+CREATE pattern as add-review-amazon-source.sql / add-review-temu-source.sql.
-- Idempotent.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu', 'cupshe'));

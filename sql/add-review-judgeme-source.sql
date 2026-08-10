-- Add 'judgeme' to product_reviews.source CHECK constraint (2026-08-10, userscript v2.3.0).
-- Follows same DROP+CREATE pattern as add-review-cupshe-source.sql.
-- Idempotent.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu', 'cupshe', 'judgeme'));

-- Add 'temu' to product_reviews.source CHECK constraint (2026-07-30, feature-05)
-- Follows same pattern as add-review-amazon-source.sql — DROP + re-CREATE the constraint.
-- Idempotent: DROP IF EXISTS then ADD.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu'));

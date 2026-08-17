-- DEPRECATED (P1-18, Docs/AUDIT-2026-08.md, 2026-08-17) — DO NOT RE-RUN.
-- Superseded by sql/consolidate-review-source-check.sql, which is now the single source of
-- truth for the chk_product_reviews_source allow-list. Re-running THIS file after judgeme has
-- landed would try to shrink the CHECK back to this file's snapshot and fail validation
-- against existing live rows. Kept only for history.
--
-- Add 'cupshe' to product_reviews.source CHECK constraint (2026-08-03, feature-09).
-- Follows same DROP+CREATE pattern as add-review-amazon-source.sql / add-review-temu-source.sql.
-- Idempotent.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu', 'cupshe'));

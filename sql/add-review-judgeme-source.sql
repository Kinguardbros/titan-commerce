-- DEPRECATED (P1-18, Docs/AUDIT-2026-08.md, 2026-08-17) — DO NOT RE-RUN.
-- Superseded by sql/consolidate-review-source-check.sql, which is now the single source of
-- truth for the chk_product_reviews_source allow-list. Functionally a no-op vs. that file
-- today (same value set) but kept only for history — extend the consolidate-* file for any
-- future source addition, not this one.
--
-- Add 'judgeme' to product_reviews.source CHECK constraint (2026-08-10, userscript v2.3.0).
-- Follows same DROP+CREATE pattern as add-review-cupshe-source.sql.
-- Idempotent.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu', 'cupshe', 'judgeme'));

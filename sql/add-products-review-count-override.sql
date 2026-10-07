-- products.review_count_override: a hand-set review count shown on the storefront instead of the
-- real number of pushed reviews (2026-10-07, requested by Isola). NULL = show the real count.
-- push_reviews_to_shopify writes it to custom.reviews_summary.count; .real keeps the real number.
-- Idempotent.
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count_override INTEGER;
ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_review_count_override;
ALTER TABLE products ADD CONSTRAINT chk_products_review_count_override
  CHECK (review_count_override IS NULL OR review_count_override BETWEEN 0 AND 1000000);

INSERT INTO schema_migrations (filename) VALUES ('add-products-review-count-override.sql') ON CONFLICT DO NOTHING;

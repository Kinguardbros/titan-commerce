-- product_reviews.origin_site: the shop a syndicated review was originally written on.
--
-- First use: Stamped reviews from shapermint.com imported onto Isola's identical
-- "Everyday Scoop Neck Smoothing Cami". The storefront prints the origin next to such a review
-- ("via shapermint.com") so a shopper can tell it was not written by one of this store's own
-- customers; reviews-push.js also never sends them as verified and keeps them out of the
-- store-wide aggregate. NULL = the review belongs to this store (every pre-existing row).
--
-- Bare lowercase hostname without www, same shape lib/actions/reviews-amazon.js normalizes to.
-- Idempotent: safe to re-run.

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS origin_site TEXT;

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_origin_site;
ALTER TABLE product_reviews ADD CONSTRAINT chk_product_reviews_origin_site
  CHECK (origin_site IS NULL OR origin_site ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');

INSERT INTO schema_migrations (filename) VALUES ('add-review-origin-site.sql') ON CONFLICT DO NOTHING;

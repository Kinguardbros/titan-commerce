-- Multi-photo per review (feature-08, 2026-08-02).
-- Adds JSONB array column photo_urls to hold up to 10 uploaded photo URLs per review.
-- Keeps legacy photo_url column populated with photo_urls[0] for backward compat
-- with older reviews-push metafield renders and single-photo callers.

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS photo_urls JSONB;

-- Backfill photo_urls from existing photo_url for reviews that already have one.
-- Idempotent: only affects rows where photo_urls is null AND photo_url is not null.
UPDATE product_reviews
SET photo_urls = jsonb_build_array(photo_url)
WHERE photo_urls IS NULL AND photo_url IS NOT NULL;

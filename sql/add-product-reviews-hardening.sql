-- Product Reviews — F2-readiness hardening (audit follow-up).
-- Adds: dedup unique index, review_date NOT NULL default, status/source CHECKs.
-- Safe to run once in the Supabase SQL Editor. Idempotent where possible.

-- 1) review_date — backfill NULLs, then enforce NOT NULL + default today.
UPDATE product_reviews SET review_date = COALESCE(review_date, created_at::date, CURRENT_DATE)
  WHERE review_date IS NULL;
ALTER TABLE product_reviews ALTER COLUMN review_date SET DEFAULT CURRENT_DATE;
ALTER TABLE product_reviews ALTER COLUMN review_date SET NOT NULL;

-- 2) Dedup existing rows before adding the unique index (keep the oldest of each group).
DELETE FROM product_reviews a
USING product_reviews b
WHERE a.ctid > b.ctid
  AND a.store_id = b.store_id
  AND a.product_id = b.product_id
  AND a.author = b.author
  AND md5(a.body) = md5(b.body);

-- 3) Prevent future duplicate imports / double AI-generation inflating the rating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_reviews_dedup
  ON product_reviews (store_id, product_id, author, md5(body));

-- 4) Guard status/source at the DB level (was code-only).
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_status;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_status
  CHECK (status IN ('pending', 'approved', 'published', 'rejected'));
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai'));

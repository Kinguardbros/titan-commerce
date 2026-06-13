-- Product Reviews (Phase 1) — manual entry / edit / approval queue in the dashboard.
-- Single migration: includes columns for later phases (photo_url, verified, dirty) so no
-- second migration is ever needed. Run in Supabase SQL Editor.
-- Verify after: select * from pg_policies where tablename='product_reviews';

CREATE TABLE IF NOT EXISTS product_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  author        TEXT NOT NULL,
  rating        INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         TEXT,
  body          TEXT NOT NULL,
  photo_url     TEXT,                              -- optional photo (Supabase Storage / CSV URL / AI), NULL = text-only
  verified      BOOLEAN NOT NULL DEFAULT false,    -- TRUE only for genuinely verified purchases → "✓ Verified" badge (legal meaning!)
  review_date   DATE,                              -- displayed date, defaults to today on insert
  source        TEXT NOT NULL DEFAULT 'manual',    -- 'csv' | 'ai' | 'manual'
  status        TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'published' | 'rejected'
  dirty         BOOLEAN NOT NULL DEFAULT false,    -- published review edited after publish → awaiting re-push (F2)
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_store   ON product_reviews(store_id);

ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
-- SELECT for authenticated; WRITE only via service-role (backend runs as service role, bypasses RLS)
DROP POLICY IF EXISTS "auth_select_product_reviews" ON product_reviews;
CREATE POLICY "auth_select_product_reviews" ON product_reviews FOR SELECT TO authenticated USING (true);

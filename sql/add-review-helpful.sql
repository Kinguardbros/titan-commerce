-- Product Reviews — HELPFUL voting (Wave B). Run once (applied via MCP on prod).
-- Adds a counter + an atomic increment RPC (race-safe for concurrent public votes).

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS helpful_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_review_helpful(p_review_id uuid)
RETURNS int LANGUAGE sql AS $$
  UPDATE product_reviews SET helpful_count = helpful_count + 1
  WHERE id = p_review_id RETURNING helpful_count;
$$;

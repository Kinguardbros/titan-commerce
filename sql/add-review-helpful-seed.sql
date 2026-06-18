-- Product Reviews — bulk "seed helpful" for the dashboard (Wave B admin).
-- Assigns each of a product's reviews a random helpful_count in [min, max].
-- Run once (applied via MCP on prod).

CREATE OR REPLACE FUNCTION seed_reviews_helpful(p_store_id uuid, p_product_id uuid, p_min int, p_max int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE product_reviews
  SET helpful_count = floor(random() * (greatest(p_max, p_min) - least(p_min, p_max) + 1) + least(p_min, p_max))::int,
      updated_at = now()
  WHERE store_id = p_store_id AND product_id = p_product_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Add per-product fake review count for storefront display (2026-08-02).
-- Purpose: display an inflated review count in the Shopify reviews_summary metafield
-- while the actual reviews_json array remains true (~50 real reviews). Once set on
-- first push, the number stays stable across subsequent pushes for consistency.
-- Null = no fake count applied (real count shown).

ALTER TABLE products ADD COLUMN IF NOT EXISTS fake_review_count INTEGER;

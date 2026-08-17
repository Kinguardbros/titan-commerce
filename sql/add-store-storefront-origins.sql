-- Per-store CORS allow-list for public storefront actions (P1-10, AUDIT-2026-08).
--
-- Replaces the single global STOREFRONT_URL env var (api/system.js), which required
-- editing a comma-separated env var + redeploying for every new store, with a real
-- risk of accidentally dropping an existing store's origins on a copy/paste mistake.
-- See api/system.js applyCors() + lib/storefront-cors.js, and
-- Docs/RUNBOOK-new-store.md section 4.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS storefront_origins TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN stores.storefront_origins IS
  'CORS-allowed origins for public storefront actions (submit_review_public, vote_review_helpful, review_helpful_counts). Per-store — replaces global STOREFRONT_URL env var.';

-- Backfill Isola — matches the hardcoded default that was already live in
-- api/system.js's STOREFRONT_URL fallback (production-verified).
-- Live row: slug='isola', shopify_url='xsmcwa-i9.myshopify.com', shopify_handle='swimwear-brand'.
UPDATE stores SET storefront_origins = ARRAY['https://isolaswim.com', 'https://swimwear-brand.myshopify.com']
WHERE slug = 'isola' OR shopify_url = 'xsmcwa-i9.myshopify.com';

-- Backfill Eleganz Haus — custom domain confirmed via project memory
-- (reference_shopify_store_handles.md: "Eleganz Haus: 31b625-c0.myshopify.com (eleganz-haus.de)").
-- Live row: slug='eleganz-haus', shopify_url='31b625-c0.myshopify.com'.
UPDATE stores SET storefront_origins = ARRAY['https://eleganz-haus.de', 'https://31b625-c0.myshopify.com']
WHERE slug = 'eleganz-haus' OR shopify_url = '31b625-c0.myshopify.com';

-- Elegance House intentionally left at the default '{}' — no public review widget
-- live there yet (Shopify app disabled per project notes). Backfill when it ships.

INSERT INTO schema_migrations (filename) VALUES ('add-store-storefront-origins.sql') ON CONFLICT DO NOTHING;

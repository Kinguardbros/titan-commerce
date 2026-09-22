-- Cache columns for the size_chart metaobject a product references in Shopify, so the
-- Products list and the new Size Charts management page can show "which chart" and count
-- assignments without a live Shopify round trip on every page load.
--
-- Shopify is the source of truth (metaobject `size_chart` + product metafield
-- custom.size_chart — see SIZE-CHART-DATA-CONTRACT.md in the clara-atelier repo). These two
-- columns are a best-effort DISPLAY CACHE, kept in sync by lib/actions/size-chart.js's
-- assign_size_chart_products / unassign_size_chart_products / update_size_chart /
-- refresh_has_size_chart actions — nothing that writes to Shopify ever reads them back as
-- authoritative.
--
-- `has_size_chart` already existed. Before this change it meant "has a non-empty
-- custom.size_chart_text value" — the old, disconnected mechanism the storefront theme never
-- reads (retired 2026-09-22, see lib/actions/size-chart.js's header comment). No column change
-- needed for it, only for the actions that populate it: it now means "references a
-- size_chart metaobject".

ALTER TABLE products ADD COLUMN IF NOT EXISTS size_chart_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_chart_name TEXT;

COMMENT ON COLUMN products.size_chart_id IS
  'Cached Shopify metaobject gid (type size_chart) that this product''s custom.size_chart metafield currently points at. NULL = no chart assigned. Source of truth is Shopify; refreshed by lib/actions/size-chart.js.';
COMMENT ON COLUMN products.size_chart_name IS
  'Cached display name of the size_chart metaobject named in size_chart_id, for list views. NULL whenever size_chart_id is NULL.';

CREATE INDEX IF NOT EXISTS idx_products_size_chart_id ON products(size_chart_id);

INSERT INTO schema_migrations (filename) VALUES ('add-products-size-chart-ref.sql') ON CONFLICT DO NOTHING;

-- Isola: the product page edits the per-product text size chart (custom.size_chart_text), which
-- Isola's theme renders in its size guide drawer, instead of the size_chart metaobject widget
-- (Clara Atelier's mechanism). Read by ProductDetail.jsx via stores_list → brand_config.
-- Data-only and idempotent; keeps every other brand_config.features key.

UPDATE stores
SET brand_config = jsonb_set(
  jsonb_set(COALESCE(brand_config, '{}'::jsonb), '{features}', COALESCE(brand_config->'features', '{}'::jsonb)),
  '{features,size_chart_text}',
  'true'::jsonb
)
WHERE id = '25ea2f4a-9521-48e9-8c87-172597fe75c9';

INSERT INTO schema_migrations (filename) VALUES ('config-isola-size-chart-text.sql') ON CONFLICT DO NOTHING;

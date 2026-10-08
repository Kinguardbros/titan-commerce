-- 2026-10-08: struck-price fallback for Clara Atelier (lib/compare-at-fallback.js).
-- Shopify hides variant compare-at prices from EU buyers; Clara's theme prints the struck price
-- from custom.source_compare_at_cents instead, and imported products arrived without it.
-- With this flag the products/create and products/update webhooks fill the metafield from the
-- variants. Dan's decision, aware of the EU price-reduction rules (Omnibus, § 11 PAngV).
-- Inert until the code that reads it is deployed. Idempotent.
UPDATE stores
SET brand_config = COALESCE(brand_config, '{}'::jsonb)
  || jsonb_build_object(
       'features',
       COALESCE(brand_config->'features', '{}'::jsonb) || '{"compare_at_fallback_metafield": true}'::jsonb
     )
WHERE slug = 'clara-atelier';

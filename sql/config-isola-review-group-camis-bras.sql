-- Isola: one shared review total for camis + bras, shown under the product title.
-- Opts the store into brand_config.review_group_aggregates (lib/actions/reviews-group-aggregate.js):
-- every review push for a product in "Camis & Tanks" or "Bras" recomputes the published-review
-- total of both collections and writes it to the shop metafield custom.reviews_camis_bras.
-- Collection titles must match products.tags exactly (set by full sync).
-- Data-only and idempotent: re-running sets the same value. Apply AFTER the code is deployed,
-- then call refresh_review_group_aggregates { store_id } once for the first write.

UPDATE stores
SET brand_config = jsonb_set(
  COALESCE(brand_config, '{}'::jsonb),
  '{review_group_aggregates}',
  '[{"key": "reviews_camis_bras", "collections": ["Camis & Tanks", "Bras"]}]'::jsonb
)
WHERE id = '25ea2f4a-9521-48e9-8c87-172597fe75c9';

INSERT INTO schema_migrations (filename) VALUES ('config-isola-review-group-camis-bras.sql') ON CONFLICT DO NOTHING;

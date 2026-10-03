-- Isola: the number under the product title is the store-wide review total (all collections),
-- replacing the camis + bras group (config-isola-review-group-camis-bras.sql).
-- Every review push recomputes the published-review total of all non-archived products and
-- writes it to the shop metafield custom.reviews_total (lib/actions/reviews-group-aggregate.js).
-- custom.reviews_camis_bras is no longer updated after this; the theme must read reviews_total.
-- Data-only and idempotent. Apply AFTER the code with `all: true` support is deployed, then call
-- refresh_review_group_aggregates { store_id } once for the first write.

UPDATE stores
SET brand_config = jsonb_set(
  COALESCE(brand_config, '{}'::jsonb),
  '{review_group_aggregates}',
  '[{"key": "reviews_total", "all": true}]'::jsonb
)
WHERE id = '25ea2f4a-9521-48e9-8c87-172597fe75c9';

INSERT INTO schema_migrations (filename) VALUES ('config-isola-review-group-total.sql') ON CONFLICT DO NOTHING;

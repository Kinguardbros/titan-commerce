-- Recreate creatives_style_check to match CURRENT reality (C2/H3, Docs/AUDIT-2026-08-B.md) — 2026-08-19
--
-- Problem: both add-static-styles.sql and relax-style-check.sql are registered in
-- schema_migrations as applied, and both end by creating creatives_style_check — but the
-- constraint did NOT exist live (someone dropped it out-of-band to unblock the catalog
-- styles and never wrote the migration). Worse, 65 live rows (product_catalog*,
-- realistic_beach) violate the on-disk relax-style-check.sql definition, which the code
-- actively writes — so replaying that file would DROP-succeed then ADD-fail, and a fresh
-- environment built from sql/ would reject every current catalog style at insert time.
--
-- THIS file is now the single source of truth for the creatives.style allow-list
-- (same pattern as consolidate-review-source-check.sql, P1-18): extend the list HERE
-- when a new style ships (e.g. product_catalog_v11) — do not add a new per-style file.
-- The 2 superseded files (add-static-styles.sql, relax-style-check.sql) are marked
-- DEPRECATED in their own headers and must not be re-run.
--
-- Allow-list = union of (audited 2026-08-19):
--   * live distinct styles (SELECT DISTINCT style FROM creatives): product_photo_beach,
--     product_catalog, realistic_beach, product_catalog_v3/v5/v6/v7/v8/v9/v10,
--     product_shot, static_clean, lifestyle, cs_poolside-resort-paradise
--   * every style the code can write: STYLE_MAP in
--     apps/dashboard/src/components/CreativeStudio.jsx (backend values), the standalone
--     styles in api/creatives/generate.js (product_catalog .. product_catalog_v10,
--     realistic_beach), STYLE_PROMPTS keys in lib/higgsfield.js, and generate_branded in
--     lib/actions/creatives.js (STYLE_PROMPTS keys again; branded-ness lives in the
--     separate `type` column, not `style`)
--   * the cs_% prefix for Custom Style Builder styles (lib/higgsfield.js early-return)
--
-- Idempotent: safe to re-run. NOT VALID + separate VALIDATE avoids holding an exclusive
-- lock while every existing row is checked (P1-18 precedent).

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_style_check;

ALTER TABLE creatives ADD CONSTRAINT creatives_style_check CHECK (
  style IN (
    -- lib/higgsfield.js STYLE_PROMPTS
    'ad_creative', 'product_shot', 'product_photo_beach', 'lifestyle', 'review_ugc',
    'static_clean', 'static_split', 'static_urgency',
    -- standalone styles in api/creatives/generate.js
    'product_catalog', 'product_catalog_v2', 'product_catalog_v3', 'product_catalog_v4',
    'product_catalog_v5', 'product_catalog_v6', 'product_catalog_v7', 'product_catalog_v8',
    'product_catalog_v9', 'product_catalog_v10',
    'realistic_beach'
  )
  OR style LIKE 'cs\_%'
) NOT VALID;

ALTER TABLE creatives VALIDATE CONSTRAINT creatives_style_check;

INSERT INTO schema_migrations (filename) VALUES ('fix-creatives-style-check.sql') ON CONFLICT DO NOTHING;

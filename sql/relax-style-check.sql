-- DEPRECATED (C2/H3, Docs/AUDIT-2026-08-B.md, 2026-08-19) — DO NOT RE-RUN.
-- Superseded by sql/fix-creatives-style-check.sql, which is now the single source of
-- truth for the creatives_style_check allow-list. This file's snapshot predates every
-- product_catalog* / realistic_beach style — 65 live rows violated it at audit time, so
-- re-running it would DROP-succeed then ADD-fail. Kept only for history.
--
-- Allow custom styles (cs_* prefix) in creatives table
-- Previous constraint only allowed 7 hardcoded styles
ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_style_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_style_check
    CHECK (style IN ('ad_creative', 'product_shot', 'product_photo_beach', 'lifestyle', 'review_ugc', 'static_clean', 'static_split', 'static_urgency') OR style LIKE 'cs_%');

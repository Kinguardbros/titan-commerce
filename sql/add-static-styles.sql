-- DEPRECATED (C2/H3, Docs/AUDIT-2026-08-B.md, 2026-08-19) — DO NOT RE-RUN.
-- Superseded by sql/fix-creatives-style-check.sql, which is now the single source of
-- truth for the creatives_style_check allow-list. This file's snapshot is missing every
-- product_catalog* / realistic_beach style plus the cs_% custom-style prefix — re-running
-- it would fail validation against live rows (or, worse, land a constraint the code
-- immediately violates). Kept only for history.
--
-- Update creatives style constraint to include static templates
-- Run in Supabase SQL Editor

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_style_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_style_check
    CHECK (style IN ('ad_creative', 'product_shot', 'lifestyle', 'review_ugc', 'static_clean', 'static_split', 'static_urgency'));

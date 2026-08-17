-- Consolidate product_reviews.source CHECK constraint (P1-18, Docs/AUDIT-2026-08.md)
--
-- Problem: chk_product_reviews_source was widened 6 times across separate files
-- (add-product-reviews-hardening.sql -> add-review-email.sql -> add-review-amazon-source.sql
-- -> add-review-temu-source.sql -> add-review-cupshe-source.sql -> add-review-judgeme-source.sql),
-- each doing `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ... CHECK (source IN (<cumulative list
-- at the time that file was written>))`. Because every file hardcodes its own snapshot of the
-- allow-list, replaying an OLDER file after a NEWER one has already landed silently reverts the
-- constraint to a smaller list (e.g. re-running add-review-amazon-source.sql after judgeme shipped
-- would try to shrink the allow-list back to manual/csv/ai/web/amazon — and since temu/cupshe/
-- judgeme rows already exist live, that ADD CONSTRAINT would immediately fail validation against
-- existing data, breaking the apply). sql/README.md's "apply in date order, not alphabetically"
-- caveat exists solely because of this file family.
--
-- Fix: THIS file becomes the single source of truth for the allow-list going forward. It is safe
-- to re-run at any time, in any order, relative to itself (idempotent) and supersedes the 4
-- source-list-only files above (add-review-amazon-source.sql / add-review-temu-source.sql /
-- add-review-cupshe-source.sql / add-review-judgeme-source.sql are now marked deprecated in their
-- own headers — do not re-run them; add-product-reviews-hardening.sql and add-review-email.sql stay
-- authoritative for the OTHER things they do (dedup index, review_date, status CHECK, email column)
-- and are unaffected by this file).
--
-- Audited live values before writing this (Supabase Management API, 2026-08-17):
--   SELECT source, COUNT(*) FROM product_reviews GROUP BY source ORDER BY count DESC;
--   -> amazon 1806, temu 552, cupshe 100, judgeme 97, csv 84, manual 5
-- No case/typo variants found (no 'Amazon', 'AMAZON', empty string, or NULL rows). 'ai' (AI-
-- generated, lib/actions/reviews-ai.js) and 'web' (storefront public submit, lib/actions/
-- reviews-public.js) have zero rows yet but are live, reachable code paths — kept in the CHECK.
--
-- Idempotent: safe to re-run on prod. NOT VALID + separate VALIDATE avoids a long-held lock while
-- scanning the full table — VALIDATE CONSTRAINT only takes SHARE UPDATE EXCLUSIVE (doesn't block
-- reads/writes), unlike a plain ADD CONSTRAINT which validates inline.

-- 1) Canonicalize first (defensive no-op given the audit above — protects against any row that
--    bypassed app-level source: literals, e.g. a hand-run INSERT in the SQL editor).
UPDATE product_reviews SET source = lower(trim(source)) WHERE source <> lower(trim(source));

-- 2) Replace the constraint with the current full canonical set, NOT VALID (skips the scan).
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon', 'temu', 'cupshe', 'judgeme'))
  NOT VALID;

-- 3) Validate separately (read lock only, non-blocking for concurrent reads/writes).
ALTER TABLE product_reviews VALIDATE CONSTRAINT chk_product_reviews_source;

INSERT INTO schema_migrations (filename) VALUES ('consolidate-review-source-check.sql') ON CONFLICT DO NOTHING;

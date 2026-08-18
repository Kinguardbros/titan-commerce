-- Phase A: soft-archive legacy creatives rows with store_id IS NULL.
--
-- Pre multi-store rollout (before sql/add-stores.sql backfilled store_id),
-- some `creatives` rows could exist with store_id IS NULL. All dashboard
-- queries (api/creatives/list.js, lib/actions/creatives.js) require/scope by
-- store_id, so such rows are already invisible in the UI — but they still
-- pollute raw row counts and would block a future NOT NULL constraint on
-- creatives.store_id (deferred to Phase B, tracked separately, pending an
-- observation period on this Phase A change).
--
-- This migration is purely additive + non-destructive: adds a nullable
-- deleted_at column, marks the current NULL-store_id rows archived. No
-- DELETE, no ALTER COLUMN, no DROP. Fully reversible:
--   UPDATE creatives SET deleted_at = NULL WHERE deleted_at = '<applied_at>';
--
-- Run in Supabase SQL Editor (or Management API). No BEGIN/COMMIT — editor
-- runs single statements. Idempotent — safe to run more than once.

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_creatives_deleted_at ON creatives(deleted_at) WHERE deleted_at IS NOT NULL;

UPDATE creatives
  SET deleted_at = now()
  WHERE store_id IS NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN creatives.deleted_at IS
  'Soft-archive marker. Rows with deleted_at IS NOT NULL are excluded from all list queries. Legacy NULL-store_id rows were archived here on 2026-08-18 (see sql/archive-null-store-id-creatives.sql).';

INSERT INTO schema_migrations (filename) VALUES ('archive-null-store-id-creatives.sql') ON CONFLICT DO NOTHING;

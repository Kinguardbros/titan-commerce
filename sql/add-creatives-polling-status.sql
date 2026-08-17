-- Add 'polling' status for atomic claim in poll_generations (P1-20,
-- Docs/AUDIT-2026-08.md — poll_generations had no row locking, so two
-- concurrent pollers (browser tabs polling every 3s, the daily admin cron)
-- could both SELECT the same 'generating' row and both fire a duplicate
-- fal.ai auto-retry resubmission for the same stuck job).
--
-- Row transitions: generating -> polling (claimed by claim_generating_creatives(),
-- sql/add-claim-generating-creatives-fn.sql) -> pending/approved/rejected/published/failed,
-- OR back to generating if the poller releases the claim (finalize threw, or the
-- fal.ai job is still in progress).
--
-- If a poller crashes mid-work the row is left stuck in 'polling' —
-- cleanup_stale (lib/actions/creatives.js) resets rows stuck in 'polling'
-- for more than 10 minutes back to 'generating' for the next poll cycle.

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_status_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_status_check
  CHECK (status IN ('generating', 'polling', 'pending', 'approved', 'rejected', 'published', 'failed'));

-- Tracks when a row was claimed, so cleanup_stale can detect orphaned claims
-- (a poller that claimed a row and then crashed/timed out before releasing it).
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS polling_started_at TIMESTAMPTZ;

INSERT INTO schema_migrations (filename) VALUES ('add-creatives-polling-status.sql') ON CONFLICT DO NOTHING;

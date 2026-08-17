-- Atomic claim of 'generating' creatives for poll_generations (P1-20,
-- Docs/AUDIT-2026-08.md). Replaces the old SELECT-then-mutate pattern
-- (SELECT ... WHERE status='generating' LIMIT 20, then per-row UPDATE),
-- which let two concurrent pollers (browser tabs polling every 3s, the
-- daily admin cron) both fetch the same batch and both trigger a
-- duplicate fal.ai auto-retry resubmission for the same stuck job.
--
-- FOR UPDATE SKIP LOCKED ensures concurrent callers see disjoint row sets
-- (a row locked by one caller's transaction is invisible to another
-- caller's SELECT ... FOR UPDATE SKIP LOCKED, instead of blocking on it).
-- UPDATE ... RETURNING makes the claim (status flip) atomic with the read.
--
-- p_store_id scopes the claim the same way the old query's optional
-- `.eq('store_id', storeId)` did — NULL claims across all stores (admin/cron).
-- hf_job_id IS NOT NULL mirrors the old query's `.not('hf_job_id', 'is', null)`.

CREATE OR REPLACE FUNCTION claim_generating_creatives(
  p_limit INT DEFAULT 20,
  p_store_id UUID DEFAULT NULL
)
RETURNS SETOF creatives AS $$
BEGIN
  RETURN QUERY
    WITH claimed AS (
      UPDATE creatives
      SET status = 'polling', polling_started_at = NOW()
      WHERE id IN (
        SELECT id FROM creatives
        WHERE status = 'generating'
          AND hf_job_id IS NOT NULL
          AND (p_store_id IS NULL OR store_id = p_store_id)
        ORDER BY created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    )
    SELECT * FROM claimed ORDER BY created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION claim_generating_creatives(INT, UUID) FROM PUBLIC;
-- Backend uses service_role which bypasses these grants; explicit revoke is
-- defense-in-depth against future misconfigured PostgREST exposure (mirrors
-- sql/add-safe-admin-update-fn.sql, P1-17).

INSERT INTO schema_migrations (filename) VALUES ('add-claim-generating-creatives-fn.sql') ON CONFLICT DO NOTHING;

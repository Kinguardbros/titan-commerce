-- Audit trail: who initiated a pipeline_log entry (P1-16, AUDIT-2026-08).
--
-- pipeline_log recorded WHAT happened (agent, message, level, metadata) but nothing
-- about WHO. Post-P0-1 RBAC + P1-14/P1-15 self-service password change, multiple
-- people can trigger dashboard actions (bulk_price, approve_proposal, delete_review,
-- create_user, ...) — "who ran bulk_price?" or "who approved this proposal?" was
-- unanswerable. See lib/actions/*.js call sites + api/cron/detect-events.js +
-- api/webhooks/shopify.js.
--
-- Backfill: existing rows are left with NULL user_id/initiator — history can't be
-- reconstructed. Only new rows get attribution going forward.
--
-- Idempotent: safe to re-run on prod (IF NOT EXISTS column adds, IF NOT EXISTS index).

ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS initiator TEXT
  CHECK (initiator IS NULL OR initiator IN ('user', 'system', 'webhook', 'cron'));

CREATE INDEX IF NOT EXISTS idx_pipeline_log_user_id ON pipeline_log(user_id) WHERE user_id IS NOT NULL;

COMMENT ON COLUMN pipeline_log.user_id IS 'User who initiated this action; NULL when initiator is system/cron/webhook';
COMMENT ON COLUMN pipeline_log.initiator IS 'Source of the action: user (dashboard), system (auto-detect), webhook (Shopify), cron (scheduled)';

INSERT INTO schema_migrations (filename) VALUES ('add-pipeline-log-user-attribution.sql') ON CONFLICT DO NOTHING;

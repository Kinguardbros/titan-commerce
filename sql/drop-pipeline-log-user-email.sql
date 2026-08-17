-- Drop unused pipeline_log.user_email column (P1-16 follow-up, AUDIT-2026-08).
--
-- Added by sql/enable-rls-all.sql, never populated at insert time by any code path
-- (verified: `grep -rn "user_email" lib/ api/ apps/` — only hits are the `pipeline_log`
-- action's derived response field, computed from a `users` JOIN on `user_id`, and the
-- frontend TerminalLog.jsx display of that response field; nothing ever writes this
-- column). `lib/actions/pipeline.js` already SELECTs `*` and immediately destructures/
-- overwrites `user_email` with the JOIN-derived value, so the raw column was dead weight
-- even on the read path. Display of "who did this" is unaffected — it comes from the
-- user_id JOIN added in sql/add-pipeline-log-user-attribution.sql (P1-16), not this column.
--
-- Idempotent: safe to re-run on prod (IF EXISTS).

ALTER TABLE pipeline_log DROP COLUMN IF EXISTS user_email;

INSERT INTO schema_migrations (filename) VALUES ('drop-pipeline-log-user-email.sql') ON CONFLICT DO NOTHING;

-- Harden the migration ledger itself (C2/C3, Docs/AUDIT-2026-08-B.md) — 2026-08-19
--
-- C3: schema_migrations was the ONLY public table with RLS off, while anon +
-- authenticated held full table-level DML grants — i.e. anyone on the internet with the
-- (public by design) anon key could rewrite or TRUNCATE the migration ledger via
-- PostgREST. RLS on with zero policies + explicit REVOKE closes both doors; the backend
-- and scripts use service_role (bypasses RLS) and the Management API connects as
-- postgres, so nothing legitimate breaks.
--
-- C2: adds `verified_at` — stamped by scripts/verify-migrations.mjs when the sweep
-- confirms the file's primary objects actually exist live. `applied_at` alone proved
-- untrustworthy: the 2026-08-17 one-shot backfill registered every sql/*.sql file
-- without checking application, which is how add-rate-limits.sql (never run) sat
-- "applied" while every rate limiter fail-opened in prod. A NULL verified_at on a
-- non-DEPRECATED row means "never confirmed against live" — run the sweep.
--
-- Idempotent — safe to re-run.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schema_migrations FROM anon, authenticated;

ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

INSERT INTO schema_migrations (filename) VALUES ('harden-schema-migrations.sql') ON CONFLICT DO NOTHING;

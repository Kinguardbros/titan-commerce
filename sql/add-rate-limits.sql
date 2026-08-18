-- Sprint 1: Persistent rate limiting for serverless
--
-- HISTORY NOTE (C1, Docs/AUDIT-2026-08-B.md, fixed 2026-08-19): this file was
-- registered in schema_migrations on 2026-08-17 by the one-shot backfill
-- (scripts/register-existing-migrations.mjs) but had NEVER actually been run
-- against prod — to_regclass('public.rate_limits') was NULL, so every
-- rateLimit() call fail-opened and ALL rate limiting (login brute-force caps,
-- public review submit, AI cost caps) was a silent no-op. First real apply:
-- 2026-08-19 via Supabase Management API, verified with a live
-- INSERT/SELECT/DELETE smoke test through PostgREST (service role).
--
-- RLS added at first real apply: Supabase's default privileges grant anon and
-- authenticated full DML on new public tables, and this table is service-role
-- only (lib/rate-limit.js). RLS on with zero policies + explicit REVOKE keeps
-- it off PostgREST for the public roles (same pattern as oauth_nonces).
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key_time ON rate_limits(key, created_at);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM anon, authenticated;

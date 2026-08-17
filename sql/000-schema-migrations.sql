-- Migration tracking table (P1-19, Docs/AUDIT-2026-08.md) — 2026-08-17
-- Numbered 000- so it applies first when someone bootstraps from sql/.
-- Paste into Supabase SQL Editor. Idempotent — safe to run more than once.
--
-- Lightweight migration tracking. Every hand-authored migration file should
-- INSERT its filename here on successful apply. Prevents double-apply and
-- surfaces skipped/out-of-order migrations in a new environment.
--
-- Convention (see CLAUDE.md "RLS & migrations"): every NEW migration file
-- added after this one ends with
--   INSERT INTO schema_migrations (filename) VALUES ('{filename}.sql') ON CONFLICT DO NOTHING;
-- The 43 pre-existing sql/*.sql files are NOT retrofitted with this line
-- (too much churn for no live benefit) — they're captured once by the
-- backfill script below instead.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by TEXT DEFAULT current_user
);

-- Backfill: mark every migration file already in sql/ as "applied" so we
-- start from a known-good baseline. Filenames are the canonical way to
-- identify a migration — must match sql/{filename}.sql exactly.
-- (Populated by the accompanying scripts/register-existing-migrations.mjs
-- helper that reads sql/*.sql and inserts each name — run once after this
-- migration lands.)

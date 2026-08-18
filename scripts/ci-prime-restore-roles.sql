-- CI-only priming for .github/workflows/test-restore-weekly.yml.
--
-- The ephemeral `postgres:16` service container used for the weekly
-- test-restore is a vanilla Postgres image — none of Supabase's
-- `authenticated` / `anon` / `service_role` roles or the `auth` schema exist
-- there. scripts/backup-database.mjs dumps `--schema=public` only, but the
-- RLS policies that live IN public (sql/enable-rls-all.sql, add-stores.sql,
-- add-product-reviews.sql, add-users-and-permissions.sql, ...) reference
-- `TO authenticated` and `auth.role()`. Without these stubs, `pg_restore`
-- fails to CREATE those POLICY objects and exits non-zero even though every
-- table's DATA restored fine — which would fire a false-positive Telegram
-- alert on this workflow every single week (the automated pipeline's alert
-- contract is "silent on success, alert on real failure only").
--
-- This ephemeral DB is only ever queried by the `postgres` superuser (which
-- bypasses RLS entirely), so the roles/functions below just need to exist,
-- not do anything real. Run once, before pg_restore, in
-- test-restore-weekly.yml. Never run this against a real environment.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- Tighten RLS write policies on all public tables.
--
-- Supabase linter flagged 41 WARN entries (rls_policy_always_true) — every
-- INSERT/UPDATE/DELETE policy currently uses `USING (true)` or `WITH CHECK (true)`,
-- which effectively bypasses RLS for the `authenticated` role.
--
-- For this project's auth model the warning is mostly cosmetic — the frontend
-- uses a custom password gate (lib/auth.js), NOT Supabase Auth, so no browser
-- session ever has the `authenticated` Postgres role. All writes go through the
-- backend service-role client, which bypasses RLS automatically regardless.
--
-- But: defense in depth. Drop all WRITE policies (INSERT/UPDATE/DELETE/ALL)
-- so even if someone *did* get an authenticated JWT (or if we ever switch to
-- Supabase Auth), they couldn't mutate tables. Keep SELECT policies — the
-- frontend's Supabase Realtime subscriptions (Cockpit proposals, etc.) rely
-- on the `authenticated`/`anon` role being able to SELECT. SELECT-only
-- USING(true) is explicitly excluded from the linter warning.
--
-- After this migration:
--   - Backend (service_role): unchanged, bypasses RLS for all operations
--   - Frontend Realtime: unchanged, SELECT-only access still works
--   - authenticated/anon write attempts: now blocked at the RLS layer
--
-- Verified safe: grep confirmed no .insert/.update/.delete/.upsert calls in
-- apps/dashboard/src/ — frontend only calls REST endpoints, never writes to
-- Supabase directly.
--
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Drop every non-SELECT policy on every table in the public schema.
  -- (SELECT policies are kept so Realtime subscriptions + read access work.)
  FOR rec IN
    SELECT schemaname, tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

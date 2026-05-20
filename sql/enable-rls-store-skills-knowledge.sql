-- Enable RLS on store_knowledge + store_skills (flagged by Supabase linter as
-- rls_disabled_in_public ERROR). These two tables were added after enable-rls-all.sql
-- so they slipped through. Same pattern as the rest: enable RLS + grant authenticated
-- role full access via 4 policies. Service role (backend) bypasses RLS automatically.
--
-- Safe to run: backend (lib/claude.js, lib/higgsfield.js, lib/actions/skills.js) reads
-- and writes these tables via service-role client which bypasses RLS. Frontend does not
-- access them directly (verified via grep — frontend reads them through the API only).
--
-- Run in Supabase SQL Editor.

ALTER TABLE store_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_skills ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['store_knowledge', 'store_skills'])
  LOOP
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (true)', tbl, tbl);
  END LOOP;
END $$;

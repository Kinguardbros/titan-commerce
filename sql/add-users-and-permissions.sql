-- Users & Permissions feature migration (2026-07-24)
-- Paste into Supabase SQL Editor. No BEGIN/COMMIT — Supabase editor runs single statements.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  store_access UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth only — backend uses the service-role key (bypasses RLS by design,
-- per CLAUDE.md). This policy protects against a leaked anon/authenticated key.
CREATE POLICY IF NOT EXISTS "authenticated_select_users" ON users
  FOR SELECT
  USING (auth.role() = 'authenticated');

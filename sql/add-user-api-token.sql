-- Add api_token column for userscript bearer auth (2026-07-29)
-- Allows generating a per-user token for external tools (Tampermonkey userscript).
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single statements.

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token) WHERE api_token IS NOT NULL;

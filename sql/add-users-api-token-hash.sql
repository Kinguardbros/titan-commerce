-- api_token SHA-256 hash column (P2, Docs/AUDIT-2026-08.md, I-2 tech debt) —
-- dual-mode migration for users.api_token.
--
-- users.api_token was stored in plaintext. This adds users.api_token_hash
-- (SHA-256 hex digest) and backfills it from every existing plaintext token
-- so already-issued userscript tokens keep working without forcing
-- regeneration. generate_api_token (lib/actions/users.js) now clears the
-- plaintext column and writes only the hash for NEW tokens (shown once in
-- the API response, never persisted in plaintext). Verification
-- (lib/auth.js verifyApiToken) looks up by hash first, falls back to the
-- legacy plaintext api_token column only for rows where api_token_hash is
-- still NULL (logs a console.warn so the fallback's usage is visible —
-- expect it to disappear entirely once this backfill has run, since every
-- currently-issued token gets hashed below).
--
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single
-- statements. Idempotent — safe to run more than once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_users_api_token_hash ON users(api_token_hash) WHERE api_token_hash IS NOT NULL;

-- Backfill existing plaintext tokens so they verify via the hash-lookup path
-- immediately, without requiring every user to regenerate.
UPDATE users
SET api_token_hash = encode(sha256(api_token::bytea), 'hex')
WHERE api_token IS NOT NULL AND api_token_hash IS NULL;

-- Follow-up (not this migration, tracked in CLAUDE.md Known Tech Debt): once
-- logs show zero '[auth] plaintext api_token match' warnings for a full
-- burn-in cycle, drop the plaintext users.api_token column entirely.

INSERT INTO schema_migrations (filename) VALUES ('add-users-api-token-hash.sql') ON CONFLICT DO NOTHING;

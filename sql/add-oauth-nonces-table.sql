-- OAuth nonce storage (P2, Docs/AUDIT-2026-08.md) — validates the `state`
-- param on the Shopify OAuth callback (api/auth/shopify.js).
--
-- Previously the CONNECT step generated a nonce and only logged it to
-- pipeline_log — the CALLBACK step never checked it against anything, so the
-- nonce provided zero actual protection beyond Shopify's own HMAC signature.
-- This table makes the nonce a real single-use, time-boxed check.
--
-- Chose a DB table over an in-memory Map: CONNECT and CALLBACK are always two
-- separate Vercel serverless invocations, separated by a Shopify-side
-- redirect the app doesn't control the timing of (merchant approves scopes
-- on Shopify's domain in between) — an in-memory cache would almost never
-- still hold the nonce by the time CALLBACK runs, making a hard reject on
-- "nonce not found" break the OAuth flow for real users, not just attackers.
--
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single
-- statements. Idempotent — safe to run more than once.

CREATE TABLE IF NOT EXISTS oauth_nonces (
  nonce TEXT PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires_at ON oauth_nonces(expires_at);

ALTER TABLE oauth_nonces ENABLE ROW LEVEL SECURITY;
-- No policies added — service role (used by api/auth/shopify.js) bypasses
-- RLS entirely; this table is never queried with the anon/authenticated key.

-- Best-effort cleanup of already-expired rows at migration time. Ongoing
-- cleanup isn't wired to a cron — the table stays tiny regardless (one row
-- per initiated OAuth connect attempt, deleted immediately on successful
-- callback; a 10-min TTL bounds how long an abandoned attempt can linger).
DELETE FROM oauth_nonces WHERE expires_at < now();

INSERT INTO schema_migrations (filename) VALUES ('add-oauth-nonces-table.sql') ON CONFLICT DO NOTHING;

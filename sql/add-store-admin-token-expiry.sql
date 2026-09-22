-- Track when a store's Shopify Admin token dies, so an expired one can be replaced
-- automatically instead of surfacing to the user as a failed save.
--
-- Clara Atelier's Shopify app issues client_credentials tokens valid for 24h. Nothing
-- refreshed them, so roughly a day after someone last pasted a token by hand, every
-- Shopify write on that store began failing with 401: size charts, the product editor,
-- optimizer pushes, publications, sync, review pushes. All of it surfaced as the same
-- generic "Failed to save ... to Shopify", because lib/shopify-admin.js's rest() dropped
-- Shopify's status and body and returned null. Reported 2026-09-22.
--
-- The refresh itself (lib/shopify-token.js) is REACTIVE — it only runs after Shopify has
-- actually rejected a token with 401. This column records the expiry of a token we minted
-- ourselves, so the refresh path has a real timestamp to reason about rather than guessing.
--
-- Deliberately left NULL for every existing row: a NULL means "we did not mint this token
-- and do not know when it dies", which is exactly right for a hand-pasted permanent token.
-- Isola and Eleganz Haus keep working untouched. Nothing may treat NULL as "expired" —
-- Isola also has client_id/client_secret stored, and minting there would swap its working
-- long-lived token for a 24h one and make it depend on the refresh path too.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS admin_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN stores.admin_token_expires_at IS
  'When the current admin_token expires, set only when Titan minted it via client_credentials (lib/shopify-token.js). NULL = hand-pasted token of unknown/indefinite lifetime — never treat NULL as expired.';

INSERT INTO schema_migrations (filename) VALUES ('add-store-admin-token-expiry.sql') ON CONFLICT DO NOTHING;

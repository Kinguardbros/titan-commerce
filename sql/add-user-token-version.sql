-- Add token_version for session invalidation on password change/reset.
-- Verified against a matching claim in the signed JWT payload; bumping the
-- column immediately invalidates every outstanding session for that user.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

-- must_change_password flag for admin-issued temp passwords — force user to
-- change on next login instead of letting a leaked temp password persist.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- P0-3 follow-up (Docs/AUDIT-2026-08.md): manual_adspend's UNIQUE constraint was
-- (date, channel) with no store_id — in a multi-store dashboard this means Store A
-- entering "2026-08-16 / meta / $500" blocks Store B from ever entering the same
-- date+channel combo. Scope the constraint to (store_id, date, channel) instead.
--
-- Pre-flight (run manually before this migration, or trust the audit that already
-- ran it): confirm no existing rows would collide under the new constraint —
--   SELECT store_id, date, channel, COUNT(*) FROM manual_adspend
--   GROUP BY store_id, date, channel HAVING COUNT(*) > 1;
-- Returned 0 rows on prod as of 2026-08-17 — safe to proceed. If it ever returns
-- rows, STOP and dedupe first; do not run past a non-empty result.
--
-- Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS no-ops; ADD CONSTRAINT is
-- guarded against "already exists" via the DO block below).
-- Reversible: DROP the new constraint + re-ADD the old (date, channel) one.

-- STEP 1 — drop the old global (date, channel) unique constraint. Confirmed via
-- `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid =
-- 'manual_adspend'::regclass AND contype = 'u';` → manual_adspend_date_channel_key.
ALTER TABLE manual_adspend DROP CONSTRAINT IF EXISTS manual_adspend_date_channel_key;

-- STEP 2 — add the store-scoped composite unique constraint.
DO $$
BEGIN
  ALTER TABLE manual_adspend
    ADD CONSTRAINT manual_adspend_store_date_channel_key
    UNIQUE (store_id, date, channel);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'manual_adspend_store_date_channel_key already exists, skipping';
END$$;

-- STEP 3 — verify. Should list manual_adspend_store_date_channel_key and NOT list
-- manual_adspend_date_channel_key.
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'manual_adspend'::regclass AND contype = 'u';

INSERT INTO schema_migrations (filename) VALUES ('fix-manual-adspend-unique.sql') ON CONFLICT DO NOTHING;

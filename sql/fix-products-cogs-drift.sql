-- Reconcile products COGS columns with live + code reality (C2/M1, Docs/AUDIT-2026-08-B.md) — 2026-08-19
--
-- Drift found by the ledger sweep: sql/add-cogs-and-adspend.sql (registered as applied)
-- says `products.cogs NUMERIC(10,2)` — but live had NO `cogs` column, and instead had
-- `variant_cogs JSONB DEFAULT '{}'` which appears in NO sql file (the per-variant COGS
-- work was done live, out-of-band, and never captured as a migration).
--
-- Code reality (audited 2026-08-19): the code uses BOTH columns —
--   * lib/actions/profit.js:50  selects 'title, cogs, variant_cogs' — with `cogs` absent
--     this SELECT 42703-errored on every call, the error was silently discarded
--     (destructures data only), and the ENTIRE products result was null → P&L COGS was
--     always 0 and missing_cogs always 0. The missing column broke variant_cogs reads too.
--   * lib/actions/pricing.js:17 writes `updates.cogs` when the Profit tab's flat
--     "Set COGS" flow (Profit.jsx:40) is used → PostgREST 400 → 500 to the client.
--     (Live corroborates: 0 products carried any variant_cogs data at audit time.)
--
-- Fix: make live match what the ledger + code already claim — restore the flat `cogs`
-- column (un-ghosting add-cogs-and-adspend.sql, un-breaking the Profit COGS flows) and
-- capture `variant_cogs` in sql/ so a fresh environment matches prod. Idempotent.

ALTER TABLE products ADD COLUMN IF NOT EXISTS cogs NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_cogs JSONB DEFAULT '{}';

INSERT INTO schema_migrations (filename) VALUES ('fix-products-cogs-drift.sql') ON CONFLICT DO NOTHING;

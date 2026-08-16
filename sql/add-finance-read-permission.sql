-- finance:read permission migration (P0-5, Docs/AUDIT-2026-08.md) — 2026-08-16
-- Paste into Supabase SQL Editor. No BEGIN/COMMIT — Supabase editor runs single statements.
--
-- `permissions` on `users` is a plain TEXT[] with no CHECK constraint (validated
-- app-side against PERMISSION_LIST in lib/permissions.js / lib/actions/users.js),
-- so adding 'finance:read' to the closed set requires NO schema change here.
--
-- What changed in code: profit_summary, kpi, meta_overview, insights (previously
-- gated on products:read) now require finance:read. Any existing member user who
-- has products:read but not finance:read will lose access to the Profit tab,
-- Shopify analytics tab, and Cockpit's revenue/margin KPI cards until granted
-- finance:read explicitly. This is intentional (the VA/contractor scenario the
-- audit finding describes) — NOT auto-granted here. Dan reviews and grants per user.

-- Audit: which users currently have products:read but not finance:read
-- (these are the members who will lose Profit/Shopify/Cockpit-financials access)
SELECT id, username, role, permissions
FROM users
WHERE 'products:read' = ANY(permissions) AND NOT ('finance:read' = ANY(permissions));

-- Then grant per user manually, only for users who should see financial data:
-- UPDATE users SET permissions = array_append(permissions, 'finance:read') WHERE id = 'xxx';

-- role='admin' rows are unaffected either way — hasPermission()/hasStoreAccess() in
-- lib/permissions.js short-circuit to true for role='admin' regardless of the
-- permissions array, so no admin row needs (or benefits from) this grant.

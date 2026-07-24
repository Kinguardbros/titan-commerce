---
created: 2026-07-24
feature: 02-users-and-permissions
owner: dan
---

# Research — RBAC Approach

Background research feeding `features/active/02-users-and-permissions.md`.

## bcrypt vs alternatives

`bcrypt` (npm `bcrypt` or `bcryptjs`) remains the pragmatic default for password hashing in a Node/Vercel serverless context. `argon2` (winner of the 2015 Password Hashing Competition) is theoretically stronger against GPU/ASIC attacks, but its native bindings (`node-argon2`) require a compile step that is fragile on Vercel's serverless build image — `bcryptjs` (pure JS, no native bindings) sidesteps that risk entirely at a small CPU cost. Given Titan's existing `--legacy-peer-deps` friction with native deps (Higgsfield), **`bcryptjs` is the safer pick over native `bcrypt`** unless a build spike proves native bcrypt compiles cleanly on Vercel. Cost factor 10-12 rounds balances p95 latency (<500ms target) against brute-force resistance for a 5-10 user internal tool — this is not a consumer-scale auth surface, so 10 is sufficient.

## Supabase RLS vs application-level enforcement

Titan's backend uses the Supabase **service-role key** everywhere (`lib/supabase.js`), which bypasses RLS entirely by design (per CLAUDE.md: "Service-role bypasses RLS — backend uses service role"). This means **RLS is not a viable enforcement layer for this feature** — permission checks must happen in application code (`hasPermission()`/`hasStoreAccess()` in `lib/actions/*`), not in Postgres policies. RLS stays reserved for its existing purpose (defense-in-depth against key leakage), not as the primary gate. This matches the project's established pattern and avoids introducing a second, parallel auth model.

## PostgreSQL array containment for `store_access uuid[]`

`store_access uuid[]` should be queried with the `@>` (contains) and `<@` (contained by) operators, e.g. `WHERE store_access @> ARRAY[$1]::uuid[]` to check a user has access to a given store, or `ANY($1)` (`WHERE $1 = ANY(store_access)`) for simple membership tests — both are GIN-indexable if the column grows large, though at 5-10 users and 3 stores an index is unnecessary. Enforcement remains app-level (`hasStoreAccess(req.user, store_id)` does `user.store_access.includes(store_id)` in JS) since checks happen post-session-decode, not via live SQL against `users` per request.

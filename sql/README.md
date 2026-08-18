# sql/ — migrations

Quick guide for anyone applying schema changes to the shared Supabase project
(`ercrkgfihqgrbkkqnoqy`). There is no migration framework here — these are
hand-authored `.sql` files, pasted into the Supabase SQL Editor (or applied via
the Management API / `execute_sql` MCP tool) by whoever is doing the change.
That manual process is exactly why `schema_migrations` (below) exists — as
more people get DB access, the chance of double-applying, skipping, or
reordering a file goes up with headcount (P1-19, `Docs/AUDIT-2026-08.md`).

## Apply order

1. **Numbered files first, in order** — `000-schema-migrations.sql` today.
   Any future `NNN-*.sql` file applies in numeric order before the unnumbered
   files below. `000-` is reserved for the migration-tracking bootstrap so it
   always exists before anything else lands.
2. **`schema.sql` / `products.sql`** — the original base tables, if bootstrapping
   a fresh database from scratch. Skip these on the existing prod DB — they
   already ran years ago.
3. **`add-*.sql`, `fix-*.sql`, `enable-*.sql`, `relax-*.sql`, `restrict-*.sql`,
   `migrate-*.sql`, `backfill-*.sql`, `consolidate-*.sql`** — apply in **date
   order (file mtime / git history)**, not alphabetically. Several of these
   are cumulative and depend on an earlier one having already run. `git log
   --follow --diff-filter=A -- sql/<file>` shows when a given file was
   introduced if mtime isn't reliable (e.g. after a fresh checkout).

## What's already applied — `schema_migrations`

`sql/000-schema-migrations.sql` creates a `schema_migrations` table
(`filename` PK, `applied_at`, `applied_by`). Every migration file added from
here on ends with:

```sql
INSERT INTO schema_migrations (filename) VALUES ('{filename}.sql') ON CONFLICT DO NOTHING;
```

Before applying anything, check what's already landed:

```sql
SELECT filename, applied_at, applied_by FROM schema_migrations ORDER BY applied_at;
```

A missing row for a file you'd expect to see = it was skipped. An
`applied_at` that's out of the order you'd expect from `git log` = it was
replayed out of order — both are exactly the failure modes this table exists
to surface.

**A present row does NOT prove the migration ran.** The 2026-08-17 backfill
registered every file without checking application, and `add-rate-limits.sql`
sat "applied" for days while the table didn't exist and every rate limiter
silently fail-opened in prod (C1, `Docs/AUDIT-2026-08-B.md`). That's what
`verified_at` is for — see the next section.

## After you apply — verify (MANDATORY)

Run the ledger verification sweep **after every applied migration**:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/verify-migrations.mjs
```

It parses every registered file's primary objects (CREATE TABLE / INDEX /
FUNCTION / POLICY, ALTER TABLE ADD COLUMN / ADD CONSTRAINT), checks each
against the live catalogs, prints `filename → OK / GHOST / PARTIAL /
DEPRECATED / NOOBJ`, stamps `schema_migrations.verified_at` on confirmed rows,
and exits 1 on any drift. A `NULL verified_at` on a non-deprecated row means
"never confirmed against live".

This needs live DB access (Supabase Management API), so it is deliberately
NOT a CI job — CI has no DB credentials. The human (or agent) applying the
migration runs it as the last step of the apply.

Conventions the sweep relies on:

- A superseded file carries `-- DEPRECATED` as its **first line** (P1-18
  style) — the sweep skips it. Prose mentions of the word elsewhere don't
  count.
- Objects a LATER migration intentionally removed are documented in the
  `SUPERSEDED` map at the top of `scripts/verify-migrations.mjs`, each entry
  citing the superseding file.

`schema_migrations` itself has RLS enabled + anon/authenticated fully revoked
(`sql/harden-schema-migrations.sql`, C3 — it was the only internet-writable
table in public). Service role and the Management API are the only writers.

**The 43 pre-P1-19 files were not retrofitted** with the `INSERT` line — too
much churn for files that are already applied on every real environment. They
were captured once via `node scripts/register-existing-migrations.mjs`
(one-shot backfill, run right after `000-schema-migrations.sql` landed) so the
table starts from a known baseline instead of empty. Only migrations written
*after* P1-19 carry the tracking insert.

## Before you run anything

Read `Docs/RUNBOOK-backup-restore.md` first. This is one shared Postgres
database backing all 3 stores — there's no per-store isolation at the infra
level, so a bad migration affects everyone at once. Confirm the current
backup/PITR tier and know the restore path before pasting anything into the
SQL Editor.

## Related

- `Docs/AUDIT-2026-08.md` P1-18 (fixed 2026-08-17) — the old `add-review-*-
  source.sql` family each hardcoded its own cumulative snapshot of the
  `chk_product_reviews_source` CHECK, so replaying an older one after a newer
  one landed would silently shrink the allow-list (or fail validation
  against existing rows). `sql/consolidate-review-source-check.sql` is now
  the single source of truth for that constraint — the 4 source-only files
  (`add-review-amazon-source.sql` / `-temu-` / `-cupshe-` / `-judgeme-`) are
  marked deprecated in their own headers; extend the consolidate-* file for
  any future review source instead of adding a new one.
- `CLAUDE.md` "RLS & migrations" — the short version of this file, kept in
  sync with what's here.

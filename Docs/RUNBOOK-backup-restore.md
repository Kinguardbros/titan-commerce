# Runbook — Supabase backup & restore

Operational guide for the shared Supabase project (`ercrkgfihqgrbkkqnoqy`) that backs **all 3 stores**
(Elegance House, Isola, Eleganz Haus) — one Postgres DB, one `store-docs` Storage bucket. There is no
per-store isolation at the infra level (RLS + `store_id` filters are the isolation, not separate
databases), so a bad migration, a bug in a bulk action (`bulk_price`, `delete_review`, `sync_products`
archiving), or an accidental service-role `DELETE` wipes data for **every store at once**.

Source: `Docs/AUDIT-2026-08.md` P0-6 — before this runbook, repo-wide grep for "backup" only found
Shopify theme backups. Nothing existed for the DB or Storage.

---

## 1. Current backup coverage

Supabase's automatic protection is entirely tier-gated. Check the current tier before assuming any
of this applies:

| Tier | Price | Automatic Postgres backups |
|---|---|---|
| Free | $0 | **None.** No PITR, no daily backup. |
| Pro | $25/mo | 7-day PITR (point-in-time recovery, second-level granularity) |
| Team | — | 14-day PITR |
| Enterprise | — | 30-day PITR |

**Verify the actual tier before trusting any of this:**
- Plan: `https://supabase.com/dashboard/project/ercrkgfihqgrbkkqnoqy/settings/general`
- Backup add-on / PITR window: `https://supabase.com/dashboard/project/ercrkgfihqgrbkkqnoqy/settings/addons`
- Backup status/list: `https://supabase.com/dashboard/project/ercrkgfihqgrbkkqnoqy/database/backups/scheduled`

**As of this runbook, the tier has NOT been confirmed by a human looking at the dashboard.** Treat
PITR as unavailable until someone checks the link above and updates this line.

PITR (when available) only covers the Postgres database — tables, RLS, functions, sequences. It does
**not** cover Storage buckets or anything outside the DB. See section 2.

---

## 2. What's NOT auto-backed-up (the critical gaps)

- **`store-docs` Storage bucket** — product photos, review photos, style-builder reference images,
  avatar reference photos, uploaded store docs. Supabase Storage objects are **not** included in
  Postgres PITR. If the bucket is emptied (bad `remove()` call, bulk cleanup bug), PITR restores the
  DB rows that *reference* those files, but the files themselves are gone unless separately backed up.
- **Shopify metafields** (`custom.reviews_json`, `custom.reviews_summary`, `custom.reviews_aggregate`)
  — these live in Shopify, not in the Titan DB, so a Titan DB restore doesn't touch them directly. They
  ARE recoverable though: they're derived from `product_reviews` via `push_reviews_to_shopify`, so once
  the Titan DB is restored, re-running push for affected products rebuilds them. Not a separate backup
  need, just don't forget the re-push step (see section 4 post-restore checklist).
- **AMAZON_SCRAPER VPS state** (`37.27.189.60`) — a separate Hetzner box (`titan-scraper` Docker
  service), entirely outside Supabase. Whatever state it holds (if any) is not covered by anything in
  this runbook. Out of scope here — if it needs a backup story, that's a separate runbook.

---

## 3. Recommended manual backup schedule (until Titan has a real backup service)

Do these manually. Nothing here is automated/cron'd — that's a known gap, not an oversight.

### Weekly — Postgres dump
```bash
# Uses the Supabase CLI (already a project dependency — see `npx supabase db push` in package.json).
# Connection string: Dashboard → Project Settings → Database → Connection string (URI, direct connection).
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f titan-backup-$(date +%F).sql
```
Download/move the resulting `.sql` file to Dropbox/Google Drive (or wherever off-VPS/off-laptop storage
Dan uses), named with the date. Don't leave it only on the machine that ran the dump.

If the CLI isn't linked/available, the fallback is plain `pg_dump` against the same connection string:
```bash
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges -f titan-backup-$(date +%F).sql
```

### Weekly — Storage bucket snapshot
```bash
node scripts/backup-storage-bucket.mjs
```
Downloads every object in `store-docs` to `./backups/storage-YYYY-MM-DD/` (git-ignored, local only).
Move that folder to the same off-machine storage as the pg_dump. See script header for details.

### Before every migration
Full `pg_dump` **immediately before** running any `sql/*.sql` file against prod, saved with a
pre-migration name so it's unambiguous what state it captures:
```bash
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f pre-migration-$(date +%F)-<migration-name>.sql
```
This is cheap (seconds, current DB size) and is the single highest-leverage habit here — most damage
in a multi-tenant shared DB comes from a migration file, not a random one-off query.

---

## 4. Restore procedure

### A. PITR restore (Pro tier or above, if confirmed enabled — section 1)
1. Dashboard → **Database → Backups → Point in Time Recovery**.
2. Pick a target timestamp (second-level granularity within the tier's retention window).
3. Confirm — Supabase provisions a restore. This **replaces the live database**; there is no
   "restore to a new project" option for PITR itself (see option B if you want a side-by-side check
   first).
4. Wait for the restore to complete (dashboard shows progress), then run the post-restore checklist
   below.

### B. Manual restore from `pg_dump`
Two ways depending on whether you want to inspect before committing:

**Option 1 — new scratch project first (safer, recommended for anything non-trivial):**
1. Create a new Supabase project (any region, Free tier is fine for inspection).
2. `psql "$NEW_PROJECT_DB_URL" -f titan-backup-<date>.sql`
3. Point a local `.env.local` copy at the new project, run the app against it, verify (see checklist).
4. Once confident, either promote the new project or repeat the restore against the real project
   (Option 2).

**Option 2 — restore directly into the current project (destructive, only when PITR isn't available
or doesn't cover the needed window):**
1. **Stop app traffic first** — set `APP_PASSWORD`/routes to reject or take the app down. A restore
   while writes are still landing will conflict with data still coming in.
2. Truncate the affected tables (or the whole schema if it's a full wipe) — do NOT `DROP DATABASE`,
   only drop/truncate what you're restoring so you don't lose Supabase-managed auth/storage config.
3. `psql "$SUPABASE_DB_URL" -f titan-backup-<date>.sql`
4. Restart the app, run the post-restore checklist.

### C. Storage bucket restore
No PITR equivalent exists for Storage — restore is always "re-upload from the local snapshot":
1. From a `./backups/storage-<date>/` folder (produced by `scripts/backup-storage-bucket.mjs`),
   re-upload via the Supabase CLI (`supabase storage cp` if available in the installed CLI version) or
   manually via Dashboard → Storage → `store-docs` → drag-and-drop, per affected path.
2. For a full-bucket restore, mirror the folder structure back exactly (`{store}/Styles/...`,
   `{store}/Reviews/{productId}/...`, etc. — same paths the app already writes to, see
   `lib/actions/docs.js`, `lib/actions/reviews-photo.js`, `lib/actions/avatars.js`,
   `lib/actions/custom-styles.js`).
3. Public URLs (`getPublicUrl`) are path-based, so re-uploading to the same path restores the same URL
   — no DB updates needed unless the path itself changed.

### Post-restore checklist (run every time, PITR or manual)
- [ ] App boots and login works (`api/auth/login.js`).
- [ ] Run a handful of read queries against key tables (`stores`, `products`, `users`) and confirm
      row counts look sane for the restore point (not zero, not obviously stale for tables that should
      have moved since).
- [ ] Spot-check **3 products** (one per store if possible) — open in the dashboard, confirm images,
      price, COGS render correctly.
- [ ] Check `pipeline_log` has recent entries (confirms the restore point isn't wildly out of date and
      that inserts work post-restore).
- [ ] If any `product_reviews` rows were affected, re-run `push_reviews_to_shopify` for those products
      so the Shopify metafields (section 2) catch back up with the restored DB state.
- [ ] If Storage was also restored, spot-check that a couple of known image URLs (product photo, a
      review photo) actually resolve.

---

## 5. Test-restore procedure — MUST do once before onboarding another user

This has **not been executed yet**. It's a required gate before a 2nd person gets access (per
`Docs/AUDIT-2026-08.md` P0-6/Wave 2) — a restore procedure that's never been run is unverified, not a
plan.

Steps:
1. Run a fresh `npx supabase db dump` against prod (or reuse the latest weekly dump).
2. Create a new **scratch** Supabase project (throwaway, delete it after — don't leave it around
   holding a copy of prod data indefinitely).
3. `psql "$SCRATCH_DB_URL" -f <the dump>.sql`
4. Point a local checkout's `.env.local` at the scratch project's URL/service-role key, run
   `cd apps/dashboard && npm run dev` (or `vercel dev`) against it.
5. Walk through the post-restore checklist in section 4 against the scratch project.
6. Also run `node scripts/backup-storage-bucket.mjs` against prod once, and manually confirm a
   handful of the downloaded files open correctly (not zero-byte, not corrupted).
7. **Record what you observed here** (append below, don't just mentally note it — the whole point is a
   dated, checkable log of "this was actually tested and worked/didn't"):

> **Test-restore log**
> _(empty — no test restore has been performed yet. Add an entry each time one is run: date, what was
> restored, what was verified, anything that didn't work as expected.)_

8. Delete the scratch project once done (avoid an orphaned copy of prod data sitting on a forgotten
   Free-tier project).

---

## 6. Emergency contacts + escalation

- **Supabase support** — Pro tier and above includes ticket-based support via the dashboard
  (Help icon → Support, or `https://supabase.com/dashboard/support/new`). Free tier is community
  forum/Discord only, no guaranteed response time. Tier depends on section 1's unconfirmed check.
- **Dan's escalation path** — currently **Dan is the only person with Supabase project access**.
  There is no secondary admin/escalation contact. If Dan is unreachable during a data-loss incident,
  there is nobody else who can act. This is itself a gap worth closing before or alongside onboarding
  a 2nd person (tracked as P1-12 "no new-store/user onboarding playbook" in the audit) — at minimum,
  a second trusted person should have Supabase dashboard access (or know where credentials are) before
  Titan depends on more than one person's daily usage.

---

## 7. Prevention checklist — before running anything destructive

Run through this **every time**, not just when something feels risky — most incidents happen on
routine-feeling actions, not obviously dangerous ones.

- [ ] Any `DELETE FROM ... WHERE ...` (or any hand-written mutation) in the Supabase SQL Editor →
      `pg_dump` first (section 3, "before every migration" — same rule applies to ad-hoc SQL Editor
      writes, not just tracked migration files).
- [ ] Any `sql/*.sql` migration file being run against prod → `pg_dump` first, saved with the
      pre-migration naming convention (section 3).
- [ ] Any bulk action (`bulk_price`, the review-deletion paths in `lib/actions/reviews.js`,
      `sync_products` archiving) → dry-run or scope it to one store/product first if the action
      supports it, and know that a `pg_dump` from earlier the same week is the fallback if it goes
      wrong. Bulk actions are exactly the "bug in a bulk action" scenario called out in the audit's
      risk statement — they operate across many rows in one shot, which is also what makes a bug in
      them expensive.
- [ ] Never run a destructive command directly against prod without first checking whether the same
      thing can be tested against the scratch/test setup from section 5.

---

## Quick reference

| Situation | Action |
|---|---|
| Need to check backup coverage | Section 1 links — verify tier, don't assume Pro |
| About to run a migration | `pg_dump` first (section 3) |
| About to run a bulk action or raw SQL Editor DELETE | Section 7 checklist |
| DB got corrupted/wiped | Section 4 — PITR if available, else manual `pg_dump` restore |
| Storage bucket got wiped | Section 4C — re-upload from last weekly `backup-storage-bucket.mjs` snapshot |
| Never tested a restore | Section 5 — do it now, before adding another user |

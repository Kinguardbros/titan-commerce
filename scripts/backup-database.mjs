#!/usr/bin/env node
// Daily automated Postgres dump of the Supabase project backing all 3 Titan
// stores. Runs in .github/workflows/backup-daily.yml (03:15 UTC) — replaces
// the manual "Weekly — Postgres dump" step in Docs/RUNBOOK-backup-restore.md
// section 3, which required a human to remember to run it and move the file
// off-machine by hand. Automated, this never gets silently skipped.
//
// Shells out to the system `pg_dump` (CI installs postgresql-client-16 via
// apt-get — see .github/workflows/backup-daily.yml). Not the `npx supabase
// db dump` wrapper the RUNBOOK's manual steps use, since that needs an
// authenticated Supabase CLI session; a raw Postgres connection string
// (Session Pooler URI, `SUPABASE_DB_URL`) is simpler to hand to CI as one
// secret and doesn't require linking the CLI to the project.
//
// Scope decisions (full writeup in Docs/RUNBOOK-backup-restore.md > Automated
// backup):
//   - `--schema=public` — every Titan table lives in `public` (see
//     CLAUDE.md > Database Schema). This naturally excludes Supabase-managed
//     internal schemas (auth, storage, realtime, extensions, ...) that a
//     restore into a fresh scratch/CI database doesn't need.
//   - `--exclude-table-data=public.pipeline_log` — pipeline_log is the one
//     table that grows unbounded (every agent/system event — see CLAUDE.md).
//     pg_dump has no row-level WHERE filter, so "only keep the last 30 days"
//     isn't expressible in a single pg_dump invocation without first
//     creating a view/temp table against prod — extra moving parts and risk
//     for a job whose entire point is to be safe. This drops pipeline_log
//     DATA entirely (table/schema is preserved, restores empty), not just
//     rows older than 30 days. scripts/restore-sanity.mjs does not check
//     pipeline_log, so this doesn't affect the weekly restore-validation
//     signal. Documented tradeoff, not an oversight.
//
// Usage: node scripts/backup-database.mjs
// Requires env: SUPABASE_DB_URL (Session Pooler connection string — see
// Docs/RUNBOOK-backup-restore.md for where to find it in the Supabase
// dashboard). Never log this value.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BACKUPS_DIR = join(REPO_ROOT, 'backups');

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('[backup-database] Missing SUPABASE_DB_URL env var. See Docs/RUNBOOK-backup-restore.md > Automated backup.');
  process.exit(1);
}

if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });

const dateStamp = new Date().toISOString().slice(0, 10);
const outFile = join(BACKUPS_DIR, `titan-db-${dateStamp}.dump`);

const args = [
  dbUrl,
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  '--schema=public',
  '--exclude-table-data=public.pipeline_log',
  '--file',
  outFile,
];

console.log(`[backup-database] Dumping public schema (pipeline_log data excluded) to ${outFile} ...`);

const result = spawnSync('pg_dump', args, { stdio: ['ignore', 'inherit', 'pipe'] });

if (result.error) {
  console.error(
    '[backup-database] Failed to spawn pg_dump — is it installed? (CI: apt-get install postgresql-client-16)',
    result.error.message
  );
  process.exit(1);
}

if (result.status !== 0) {
  // Redact anything URI-shaped from stderr before printing — some libpq
  // connection-failure messages echo back the connection target.
  const stderr = (result.stderr || Buffer.alloc(0))
    .toString()
    .replace(/postgres(?:ql)?:\/\/\S+/g, '<redacted-db-url>');
  console.error(`[backup-database] pg_dump exited with code ${result.status}:\n${stderr}`);
  process.exit(result.status || 1);
}

const { size } = statSync(outFile);
if (size === 0) {
  console.error('[backup-database] Dump file is 0 bytes — treating as a failure.');
  process.exit(1);
}

console.log(`[backup-database] Done. ${outFile} (${(size / 1024 / 1024).toFixed(2)} MB).`);
process.exit(0);

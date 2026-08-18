#!/usr/bin/env node
// Sanity checks run against the ephemeral Postgres restored inside
// .github/workflows/test-restore-weekly.yml — the automated version of the
// row-count checks in Docs/RUNBOOK-backup-restore.md section 4's
// "Post-restore checklist". Five checks; minimum counts are chosen to catch
// an obviously-empty or badly-truncated restore, not to assert exact
// business numbers (those legitimately drift week to week).
//
// pipeline_log is deliberately NOT checked here — scripts/backup-database.mjs
// excludes its data from the daily dump entirely (see that file's header
// comment for why), so an empty pipeline_log table post-restore is expected,
// not a failure.
//
// Usage: node scripts/restore-sanity.mjs
// Requires env: RESTORE_DB_URL — must point at the throwaway postgres:16
// service container in test-restore-weekly.yml. Never point this at a real
// environment (read-only queries only, but still — this script has no
// business touching prod).

import postgres from 'postgres';

const dbUrl = process.env.RESTORE_DB_URL;
if (!dbUrl) {
  console.error('[restore-sanity] Missing RESTORE_DB_URL env var.');
  process.exit(1);
}

const sql = postgres(dbUrl);

const checks = [
  { name: 'stores', query: 'SELECT COUNT(*)::int AS n FROM stores', min: 1 },
  { name: 'users', query: 'SELECT COUNT(*)::int AS n FROM users', min: 1 },
  { name: 'products', query: 'SELECT COUNT(*)::int AS n FROM products', min: 100 },
  { name: 'product_reviews', query: 'SELECT COUNT(*)::int AS n FROM product_reviews', min: 100 },
  { name: 'schema_migrations', query: 'SELECT COUNT(*)::int AS n FROM schema_migrations', min: 50 },
];

let failed = 0;
try {
  for (const check of checks) {
    const [row] = await sql.unsafe(check.query);
    const ok = row.n >= check.min;
    console.log(`[${ok ? 'OK' : 'FAIL'}] ${check.name}: ${row.n} (min ${check.min})`);
    if (!ok) failed++;
  }
} catch (err) {
  console.error('[restore-sanity] A sanity query failed to run:', err.message);
  failed++;
} finally {
  await sql.end();
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);

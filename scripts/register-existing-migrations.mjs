#!/usr/bin/env node
// One-shot backfill: register every existing sql/*.sql file into the new
// schema_migrations table (P1-19, Docs/AUDIT-2026-08.md) so a new environment
// starts from a known baseline instead of an empty tracking table.
//
// Run ONCE, AFTER sql/000-schema-migrations.sql has been applied to the
// target DB. Safe to run more than once — uses INSERT ... ON CONFLICT DO
// NOTHING (via supabase-js upsert + ignoreDuplicates), so re-running just
// reports everything as already-registered.
//
// Usage: node scripts/register-existing-migrations.mjs
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from .env.local)

import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SQL_DIR = join(REPO_ROOT, 'sql');

// Load env from .env.local (repo root) — same parsing pattern as
// scripts/create-first-admin.mjs.
const envFile = join(REPO_ROOT, '.env.local');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filenames = readdirSync(SQL_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (filenames.length === 0) {
  console.error(`No .sql files found in ${SQL_DIR}`);
  process.exit(1);
}

console.log(`Found ${filenames.length} migration file(s) in sql/. Registering into schema_migrations...`);

const rows = filenames.map((filename) => ({ filename }));

// INSERT ... ON CONFLICT (filename) DO NOTHING, in one batch. PostgREST's
// ignore-duplicates resolution only returns the rows that were actually
// inserted, so diffing the response against the full filename list tells us
// exactly which were newly registered vs already present.
const { data: insertedRows, error } = await supabase
  .from('schema_migrations')
  .upsert(rows, { onConflict: 'filename', ignoreDuplicates: true })
  .select('filename');

if (error) {
  console.error('Backfill upsert failed:', error);
  process.exit(2);
}

const insertedSet = new Set((insertedRows || []).map((r) => r.filename));

let insertedCount = 0;
let skippedCount = 0;
for (const filename of filenames) {
  if (insertedSet.has(filename)) {
    console.log(`  [inserted] ${filename}`);
    insertedCount += 1;
  } else {
    console.log(`  [skipped]  ${filename} (already registered)`);
    skippedCount += 1;
  }
}

console.log(`\nDone. ${insertedCount} inserted, ${skippedCount} skipped, ${filenames.length} total.`);
process.exit(0);

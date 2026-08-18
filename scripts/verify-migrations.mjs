#!/usr/bin/env node
// Ledger verification sweep (C2, Docs/AUDIT-2026-08-B.md) — verify that every migration
// registered in schema_migrations actually LANDED on the live DB, not just that its file
// exists. Root cause being closed: scripts/register-existing-migrations.mjs backfilled
// the ledger from readdirSync(sql/) with zero application checks, which let
// add-rate-limits.sql sit "applied" while the table didn't exist and every rate limiter
// silently fail-opened in prod (C1).
//
// What it does, per schema_migrations row:
//   1. reads sql/<filename> and parses its PRIMARY objects:
//      CREATE TABLE / INDEX / FUNCTION / POLICY, ALTER TABLE ADD COLUMN / ADD CONSTRAINT
//      (DROPs, UPDATEs, GRANTs, publication changes and dynamic EXECUTE blocks are not
//      checkable this way — files with nothing parseable report NOOBJ)
//   2. checks each object against live catalogs fetched in 5 batched queries
//      (pg_class, information_schema.columns, pg_constraint, pg_proc, pg_policies)
//   3. reports OK / GHOST (nothing landed) / PARTIAL (some landed) / DEPRECATED
//      (header marker — skipped) / NOOBJ (nothing parseable) / MISSING_FILE
//   4. stamps schema_migrations.verified_at = now() for OK rows
//
// Run after EVERY applied migration (see sql/README.md + CLAUDE.md "RLS & migrations").
// Needs live DB access, so it is NOT wired into CI — it talks to the Supabase
// Management API and needs SUPABASE_ACCESS_TOKEN (env or .env.local).
//
// Usage: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/verify-migrations.mjs
// Exit codes: 0 = no GHOST/PARTIAL/MISSING_FILE, 1 = drift found, 2 = cannot run.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SQL_DIR = join(REPO_ROOT, 'sql');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ercrkgfihqgrbkkqnoqy';

// Objects a registered file creates that a LATER migration intentionally removed.
// Every entry must cite the superseding file — this is the "document every non-OK"
// ledger, kept in code so the sweep stays green without hiding real drift.
const SUPERSEDED = {
  'enable-rls-all.sql': {
    columns: [['pipeline_log', 'user_email']],
    reason: 'user_email dropped by sql/drop-pipeline-log-user-email.sql (P2, AUDIT-2026-08)',
  },
  'add-events-proposals.sql': {
    policies: [
      ['events', 'auth_insert_events'], ['events', 'auth_update_events'],
      ['proposals', 'auth_insert_proposals'], ['proposals', 'auth_update_proposals'],
    ],
    reason: 'write policies intentionally dropped by sql/restrict-rls-write-policies.sql (drops every non-SELECT policy in public)',
  },
  'add-stores.sql': {
    policies: [['stores', 'auth_insert_stores'], ['stores', 'auth_update_stores']],
    reason: 'write policies intentionally dropped by sql/restrict-rls-write-policies.sql (drops every non-SELECT policy in public)',
  },
};

// ---------- env ----------
function loadEnvLocal() {
  const envFile = join(REPO_ROOT, '.env.local');
  if (!existsSync(envFile)) return {};
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || loadEnvLocal().SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (env or .env.local) — cannot query live DB.');
  process.exit(2);
}

async function dbQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API query failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---------- sql parsing ----------
function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const ident = String.raw`(?:public\.)?"?([a-zA-Z_][\w$]*)"?`;

function parseObjects(rawSql) {
  const sql = stripComments(rawSql);
  const objects = []; // { kind, name, table? , label }
  let m;

  const reTable = new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ident}`, 'gi');
  while ((m = reTable.exec(sql))) objects.push({ kind: 'rel', name: m[1], label: `table ${m[1]}` });

  const reIndex = new RegExp(String.raw`CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${ident}`, 'gi');
  while ((m = reIndex.exec(sql))) objects.push({ kind: 'rel', name: m[1], label: `index ${m[1]}` });

  const reFn = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+${ident}\s*\(`, 'gi');
  while ((m = reFn.exec(sql))) objects.push({ kind: 'function', name: m[1], label: `function ${m[1]}` });

  const rePolicy = new RegExp(String.raw`CREATE\s+POLICY\s+"?([\w$ -]+?)"?\s+ON\s+${ident}`, 'gi');
  while ((m = rePolicy.exec(sql))) objects.push({ kind: 'policy', name: m[1], table: m[2], label: `policy ${m[1]} on ${m[2]}` });

  const reAddCol = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${ident}\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][\w$]*)"?`, 'gi');
  while ((m = reAddCol.exec(sql))) objects.push({ kind: 'column', table: m[1], name: m[2], label: `column ${m[1]}.${m[2]}` });

  const reAddCon = new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${ident}\s+ADD\s+CONSTRAINT\s+"?([a-zA-Z_][\w$]*)"?`, 'gi');
  while ((m = reAddCon.exec(sql))) objects.push({ kind: 'constraint', table: m[1], name: m[2], label: `constraint ${m[2]} on ${m[1]}` });

  // de-dup (a file may recreate the same object after a DROP)
  const seen = new Set();
  return objects.filter((o) => {
    const k = `${o.kind}:${o.table || ''}:${o.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isDeprecated(rawSql) {
  // The marker must be the FIRST line of the file (`-- DEPRECATED ...`, P1-18
  // precedent) — matching the word anywhere in a header would false-positive on
  // files whose prose merely REFERENCES deprecated files (e.g. the superseding
  // single-source-of-truth files themselves).
  return /^--\s*DEPRECATED\b/.test(rawSql.split('\n', 1)[0]);
}

// ---------- main ----------
console.log(`Verifying schema_migrations against live project ${PROJECT_REF}...\n`);

const [rels, cols, cons, procs, pols, ledger] = await Promise.all([
  dbQuery(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`),
  dbQuery(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`),
  dbQuery(`SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`),
  dbQuery(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
  dbQuery(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`),
  dbQuery(`SELECT filename, applied_at, verified_at FROM schema_migrations ORDER BY filename`),
]);

const liveRels = new Set(rels.map((r) => r.relname));
const liveCols = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));
const liveCons = new Set(cons.map((r) => `${r.tbl}.${r.conname}`));
const liveProcs = new Set(procs.map((r) => r.proname));
const livePols = new Set(pols.map((r) => `${r.tablename}.${r.policyname}`));

function existsLive(o) {
  if (o.kind === 'rel') return liveRels.has(o.name);
  if (o.kind === 'function') return liveProcs.has(o.name);
  if (o.kind === 'column') return liveCols.has(`${o.table}.${o.name}`);
  if (o.kind === 'constraint') return liveCons.has(`${o.table}.${o.name}`);
  if (o.kind === 'policy') return livePols.has(`${o.table}.${o.name}`);
  return false;
}

function isSuperseded(filename, o) {
  const entry = SUPERSEDED[filename];
  if (!entry) return false;
  if (o.kind === 'column') return (entry.columns || []).some(([t, c]) => t === o.table && c === o.name);
  if (o.kind === 'rel') return (entry.rels || []).includes(o.name);
  if (o.kind === 'constraint') return (entry.constraints || []).some(([t, c]) => t === o.table && c === o.name);
  if (o.kind === 'policy') return (entry.policies || []).some(([t, p]) => t === o.table && p === o.name);
  if (o.kind === 'function') return (entry.functions || []).includes(o.name);
  return false;
}

const results = [];
for (const row of ledger) {
  const path = join(SQL_DIR, row.filename);
  if (!existsSync(path)) {
    results.push({ filename: row.filename, status: 'MISSING_FILE', detail: 'registered but no file in sql/' });
    continue;
  }
  const raw = readFileSync(path, 'utf8');
  if (isDeprecated(raw)) {
    results.push({ filename: row.filename, status: 'DEPRECATED', detail: 'superseded per header — skipped' });
    continue;
  }
  const objects = parseObjects(raw);
  if (objects.length === 0) {
    results.push({ filename: row.filename, status: 'NOOBJ', detail: 'no statically checkable objects (backfill/grant/publication/dynamic SQL)' });
    continue;
  }
  const missing = objects.filter((o) => !existsLive(o) && !isSuperseded(row.filename, o));
  const superseded = objects.filter((o) => isSuperseded(row.filename, o));
  const found = objects.length - missing.length - superseded.length;
  let status;
  if (missing.length === 0) status = 'OK';
  else if (found === 0) status = 'GHOST';
  else status = 'PARTIAL';
  const detailParts = [];
  if (missing.length) detailParts.push(`missing: ${missing.map((o) => o.label).join(', ')}`);
  if (superseded.length) detailParts.push(`superseded (accounted): ${superseded.map((o) => o.label).join(', ')} — ${SUPERSEDED[row.filename].reason}`);
  results.push({ filename: row.filename, status, detail: detailParts.join(' | ') || `${found}/${objects.length} objects live` });
}

// unregistered files on disk (informational — a freshly authored, not-yet-applied file is normal)
const registered = new Set(ledger.map((r) => r.filename));
const onDisk = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
const unregistered = onDisk.filter((f) => !registered.has(f));

const pad = Math.max(...results.map((r) => r.filename.length)) + 2;
for (const r of results) {
  console.log(`${r.filename.padEnd(pad)} ${r.status.padEnd(12)} ${r.detail}`);
}

const counts = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
console.log(`\nSummary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}  (total ${results.length})`);
if (unregistered.length) {
  console.log(`Unregistered files on disk (not yet applied?): ${unregistered.join(', ')}`);
}

// stamp verified_at for OK rows
const okFiles = results.filter((r) => r.status === 'OK').map((r) => r.filename);
if (okFiles.length) {
  const inList = okFiles.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');
  await dbQuery(`UPDATE schema_migrations SET verified_at = now() WHERE filename IN (${inList})`);
  console.log(`Stamped verified_at on ${okFiles.length} OK row(s).`);
}

const bad = results.filter((r) => ['GHOST', 'PARTIAL', 'MISSING_FILE'].includes(r.status));
if (bad.length) {
  console.error(`\nDRIFT FOUND — ${bad.length} registered migration(s) did not fully land live:`);
  for (const r of bad) console.error(`  ${r.filename}: ${r.status} — ${r.detail}`);
  process.exit(1);
}
console.log('\nAll registered migrations verified against live. No drift.');
process.exit(0);

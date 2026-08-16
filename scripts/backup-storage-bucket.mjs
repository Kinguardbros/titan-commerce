#!/usr/bin/env node
// Weekly snapshot of the `store-docs` Storage bucket to local disk.
// Storage is NOT covered by Postgres PITR — see Docs/RUNBOOK-backup-restore.md.
// Not automated — Dan runs this manually, weekly, and moves the output off-machine.
//
// Usage: node scripts/backup-storage-bucket.mjs
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from .env.local)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BUCKET = 'store-docs';

const envFile = new URL('../.env.local', import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const outDir = join(process.cwd(), 'backups', `storage-${new Date().toISOString().slice(0, 10)}`);

// Recursively list every object under `prefix` (Storage .list() is one directory level at a
// time and paginates 100 rows per call — both need handling to get the whole bucket).
async function listAll(prefix) {
  const paths = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list(${prefix || '/'}) failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      if (item.name === '.emptyFolderPlaceholder') continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) paths.push(...await listAll(path)); // folder — recurse
      else paths.push(path);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return paths;
}

const paths = await listAll('');
console.log(`Found ${paths.length} object(s) in "${BUCKET}". Downloading to ${outDir} ...`);

let ok = 0, failed = 0;
for (const path of paths) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.error(`[fail] ${path}: ${error?.message || 'no data returned'}`);
    failed++;
    continue;
  }
  const localPath = join(outDir, path);
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
  ok++;
}

console.log(`Done. ${ok} downloaded, ${failed} failed. Snapshot: ${outDir}`);
if (failed > 0) process.exit(1);

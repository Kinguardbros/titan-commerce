// Counterpart to backup-storage-bucket.mjs: re-uploads a local storage
// snapshot into a (new) Supabase project. Built for the 2026-08-25 free-tier
// egress migration; generic for any future project move.
//
// Usage:
//   NEW_SUPABASE_URL=https://<ref>.supabase.co \
//   NEW_SUPABASE_SERVICE_KEY=<service_role key> \
//   node scripts/restore-storage-bucket.mjs [snapshot-dir]
//
// snapshot-dir defaults to the newest backups/storage-* directory.
// Idempotent: re-running upserts (overwrites) existing objects.

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

const BUCKET = 'store-docs';

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain',
  '.csv': 'text/csv', '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const url = process.env.NEW_SUPABASE_URL;
const key = process.env.NEW_SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('NEW_SUPABASE_URL and NEW_SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}

async function findSnapshotDir() {
  const argDir = process.argv[2];
  if (argDir) return argDir;
  const entries = await readdir('backups');
  const snaps = entries.filter((e) => e.startsWith('storage-')).sort();
  if (!snaps.length) {
    console.error('No backups/storage-* snapshot found and none given as argument.');
    process.exit(1);
  }
  return join('backups', snaps[snaps.length - 1]);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && !entry.name.startsWith('.')) yield full;
  }
}

const supabase = createClient(url, key);
const snapshotDir = await findSnapshotDir();
console.log(`[restore-storage] Uploading ${snapshotDir} -> ${url} bucket "${BUCKET}"`);

const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, { public: true });
if (bucketErr && !/already exists/i.test(bucketErr.message)) {
  console.error(`[restore-storage] createBucket failed: ${bucketErr.message}`);
  process.exit(1);
}

let ok = 0, failed = 0, bytes = 0;
const failures = [];
for await (const file of walk(snapshotDir)) {
  const objectPath = relative(snapshotDir, file);
  const body = await readFile(file);
  const contentType = CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, body, {
    contentType,
    upsert: true,
  });
  if (error) {
    failed++;
    failures.push(`${objectPath}: ${error.message}`);
    console.error(`[fail] ${objectPath}: ${error.message}`);
  } else {
    ok++;
    bytes += body.length;
    if (ok % 100 === 0) console.log(`[restore-storage] ${ok} uploaded...`);
  }
}

console.log(`Done. ${ok} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MB), ${failed} failed.`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(failed > 0 ? 1 : 0);

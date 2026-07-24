#!/usr/bin/env node
// One-shot bootstrap: create the first admin user for users-and-permissions feature.
// Run AFTER `sql/add-users-and-permissions.sql` has been applied to prod DB.
//
// Usage:
//   node scripts/create-first-admin.mjs <username> <password> [full_name]
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from .env.local)
//
// Idempotent: if username already exists, prints existing user + exits 0 (no overwrite).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { hashPassword } from '../lib/password.js';

const [username, password, fullName] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: node scripts/create-first-admin.mjs <username> <password> [full_name]');
  process.exit(1);
}

if (username.length < 3 || username.length > 30) {
  console.error('Username must be 3-30 chars');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be >= 8 chars (defensive; backend enforces none)');
  process.exit(1);
}

// Load env from .env.local (repo root)
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

// Idempotency: check if user exists
const { data: existing, error: checkErr } = await supabase
  .from('users')
  .select('id, username, role, active, created_at')
  .eq('username', username)
  .maybeSingle();

if (checkErr) {
  console.error('Check failed:', checkErr);
  process.exit(2);
}

if (existing) {
  console.log(`[skip] User '${username}' already exists (id=${existing.id}, role=${existing.role}, active=${existing.active}, created=${existing.created_at})`);
  console.log('Not overwriting. Delete row manually if you want to reset.');
  process.exit(0);
}

// Hash password
console.log('Hashing password...');
const hash = await hashPassword(password);
console.log(`Hash length: ${hash.length} chars`);

// Insert
console.log(`Creating admin user '${username}'...`);
const { data: created, error: insertErr } = await supabase
  .from('users')
  .insert({
    username,
    password_hash: hash,
    full_name: fullName || null,
    email: null,
    role: 'admin',
    permissions: [],  // admin trumps — ignored per lib/permissions.js
    store_access: [], // admin trumps — ignored per lib/permissions.js
    active: true,
  })
  .select('id, username, role, active, created_at')
  .single();

if (insertErr) {
  console.error('Insert failed:', insertErr);
  process.exit(3);
}

console.log('OK — first admin created:');
console.log(created);
console.log('\nYou can now log in at Titan dashboard with:');
console.log(`  username: ${username}`);
console.log(`  password: <the one you just used>`);

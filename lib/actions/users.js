import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { hasPermission, PERMISSION_LIST } from '../permissions.js';
import { hashPassword, verifyPassword } from '../password.js';
import { rateLimit } from '../rate-limit.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const USER_COLUMNS = 'id, username, full_name, email, role, permissions, store_access, active, created_at, last_login, password_hash';

// Mirrors the floor enforced on self-service change_own_password below — admin
// resets bypass this because they generate their own random temp password
// (randomTempPassword) rather than accepting user input.
const MIN_PASSWORD_LENGTH = 8;

function stripHash(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

function validPermissions(permissions) {
  return Array.isArray(permissions) && permissions.every((p) => PERMISSION_LIST.includes(p));
}

function randomTempPassword() {
  // 12-char temp password: base64url (URL-safe, no +/=) from 9 random bytes.
  return randomBytes(9).toString('base64url');
}

// Returns the current authenticated user (req.user, populated by withAuth) — no
// permission check, every authenticated caller (master or real user) may call this.
// Used by the frontend UserProvider to fetch the logged-in profile after login.
export async function me(req, res) {
  return res.status(200).json({ user: req.user });
}

export async function users_list(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { data, error } = await supabase
    .from('users')
    .select(USER_COLUMNS)
    .order('username');
  if (error) {
    console.error('[users_list] query failed:', error);
    return res.status(500).json({ error: 'failed to load users' });
  }
  return res.status(200).json({ users: (data || []).map(stripHash) });
}

export async function create_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { username, password, full_name, email, role, permissions, store_access } = req.body || {};
  if (!username || !password || !role || !Array.isArray(permissions) || !Array.isArray(store_access)) {
    return res.status(400).json({ error: 'username, password, role, permissions[], store_access[] required' });
  }
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (!validPermissions(permissions)) {
    return res.status(400).json({ error: 'permissions must be a subset of PERMISSION_LIST', valid: PERMISSION_LIST });
  }

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('users')
    .insert({
      username, password_hash, full_name: full_name || null, email: email || null,
      role, permissions, store_access, active: true,
    })
    .select(USER_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: `username "${username}" is already taken` });
    }
    console.error('[create_user] insert failed:', error);
    return res.status(500).json({ error: 'failed to create user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'info',
    message: `Admin ${req.user.username || req.user.user_id} created user "${username}" (role=${role})`,
    metadata: { created_user_id: data.id, role, permissions, store_access },
  });

  return res.status(201).json({ user: stripHash(data) });
}

export async function update_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id, role, permissions, store_access, active, full_name, email } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (role !== undefined && !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "member"' });
  }
  if (permissions !== undefined && !validPermissions(permissions)) {
    return res.status(400).json({ error: 'permissions must be a subset of PERMISSION_LIST', valid: PERMISSION_LIST });
  }

  // Explicitly NOT patchable here: username, password_hash. Password changes go
  // through reset_password; username is immutable after creation.
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (permissions !== undefined) updates.permissions = permissions;
  if (store_access !== undefined) updates.store_access = store_access;
  if (active !== undefined) updates.active = active;
  if (full_name !== undefined) updates.full_name = full_name;
  if (email !== undefined) updates.email = email;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'no updatable fields provided' });
  }

  // Last-admin protection: if this change would deactivate or demote the target,
  // and the target is currently an active admin, block it if they're the last one.
  if (updates.active === false || (updates.role !== undefined && updates.role !== 'admin')) {
    const { data: target, error: targetErr } = await supabase
      .from('users')
      .select('role, active')
      .eq('id', user_id)
      .single();
    if (targetErr || !target) {
      console.error('[update_user] failed to load target user for last-admin check:', targetErr);
      return res.status(404).json({ error: 'user not found' });
    }

    if (target.role === 'admin' && target.active === true) {
      const { data: allUsers, error: countErr } = await supabase
        .from('users')
        .select('id, role, active')
        .order('username');
      if (countErr) {
        console.error('[update_user] failed to verify admin count:', countErr);
        return res.status(500).json({ error: 'admin count check failed' });
      }
      const activeAdmins = (allUsers || []).filter((u) => u.role === 'admin' && u.active);
      if (activeAdmins.length <= 1) {
        return res.status(400).json({ error: 'cannot deactivate or demote the last active admin' });
      }
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user_id)
    .select(USER_COLUMNS)
    .single();

  if (error) {
    console.error('[update_user] update failed:', error);
    return res.status(500).json({ error: 'failed to update user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'info',
    message: `Admin ${req.user.username || req.user.user_id} updated user ${user_id}: ${Object.keys(updates).join(', ')}`,
    metadata: { target_user_id: user_id, updates },
  });

  return res.status(200).json({ user: stripHash(data) });
}

export async function delete_user(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: allUsers, error: listErr } = await supabase.from('users').select('id, role, active').order('username');
  if (listErr) {
    console.error('[delete_user] failed to list users for last-admin check:', listErr);
    return res.status(500).json({ error: 'failed to verify admin count' });
  }
  const target = (allUsers || []).find((u) => u.id === user_id);
  if (target?.role === 'admin' && target?.active) {
    const activeAdmins = (allUsers || []).filter((u) => u.role === 'admin' && u.active);
    if (activeAdmins.length <= 1) {
      return res.status(400).json({ error: 'cannot delete the last admin — promote another user first' });
    }
  }

  const { error } = await supabase.from('users').delete().eq('id', user_id);
  if (error) {
    console.error('[delete_user] delete failed:', error);
    return res.status(500).json({ error: 'failed to delete user' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} deleted user ${user_id}`,
    metadata: { deleted_user_id: user_id },
  });

  return res.status(200).json({ ok: true });
}

export async function reset_password(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Load current token_version to bump it — invalidates every outstanding
  // session for this user immediately (P1-15, AUDIT-2026-08): a stolen token
  // must die the instant an admin "fixes" the account, not linger up to 30
  // days until TTL expiry.
  const { data: current, error: fetchErr } = await supabase
    .from('users')
    .select('token_version')
    .eq('id', user_id)
    .single();
  if (fetchErr || !current) {
    console.error('[reset_password] failed to load target user:', fetchErr);
    return res.status(404).json({ error: 'user not found' });
  }

  const temp_password = randomTempPassword();
  const password_hash = await hashPassword(temp_password);

  const { data, error } = await supabase
    .from('users')
    .update({
      password_hash,
      token_version: (current.token_version || 1) + 1,
      // Force the temp password to be changed on next login (P1-14) — a
      // leaked/relayed temp password otherwise persists indefinitely.
      must_change_password: true,
    })
    .eq('id', user_id)
    .select('id, username')
    .single();

  if (error) {
    console.error('[reset_password] update failed:', error);
    return res.status(500).json({ error: 'failed to reset password' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} reset password for user "${data.username}"`,
    metadata: { target_user_id: user_id },
  });

  return res.status(200).json({ temp_password });
}

// Self-service password change (P1-14, AUDIT-2026-08). Any authenticated user
// may change their own password — no admin:users permission required. Unlike
// reset_password (admin-triggered, random temp password), this verifies the
// caller's CURRENT password first, so it's rate-limited per-user to blunt a
// brute-force guess against that check.
export async function change_own_password(req, res) {
  // Master (APP_PASSWORD) is an env-var kill-switch with no backing users row —
  // nothing to change here. Kept explicit rather than falling through to a
  // confusing "user not found" from the DB lookup below.
  if (req.user?.master) {
    return res.status(400).json({ error: 'master login has no password to change — set APP_PASSWORD via environment variable' });
  }

  const user_id = req.user?.user_id;
  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  if (!(await rateLimit(`change_password:${user_id}`, 5, 3600000))) {
    return res.status(429).json({ error: 'Too many password change attempts — try again later' });
  }

  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  if (typeof new_password !== 'string' || new_password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `new_password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('id, username, password_hash, token_version')
    .eq('id', user_id)
    .single();
  if (fetchErr || !user) {
    console.error('[change_own_password] failed to load caller:', fetchErr);
    return res.status(404).json({ error: 'user not found' });
  }

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }

  const password_hash = await hashPassword(new_password);

  const { error: updateErr } = await supabase
    .from('users')
    .update({
      password_hash,
      // Bump token_version to invalidate all sessions — including the one used
      // to make this very request. The client is expected to discard its token
      // and re-login (see apps/dashboard ChangePasswordForm).
      token_version: (user.token_version || 1) + 1,
      must_change_password: false,
    })
    .eq('id', user_id);

  if (updateErr) {
    console.error('[change_own_password] update failed:', updateErr);
    return res.status(500).json({ error: 'failed to change password' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH', level: 'info',
    message: `User "${user.username}" changed their own password`,
    metadata: { user_id },
  });

  return res.status(200).json({ ok: true });
}

export async function generate_api_token(req, res) {
  if (!hasPermission(req.user, 'admin:users')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires admin:users permission' });
  }
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const api_token = randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('users')
    .update({ api_token })
    .eq('id', user_id)
    .select('id, username')
    .single();

  if (error) {
    console.error('[generate_api_token] update failed:', error);
    return res.status(500).json({ error: 'failed to generate API token' });
  }

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH_ADMIN', level: 'warn',
    message: `Admin ${req.user.username || req.user.user_id} generated a new API token for user "${data.username}"`,
    metadata: { target_user_id: user_id },
  });

  return res.status(200).json({ api_token });
}

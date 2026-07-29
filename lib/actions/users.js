import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { hasPermission, PERMISSION_LIST } from '../permissions.js';
import { hashPassword } from '../password.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const USER_COLUMNS = 'id, username, full_name, email, role, permissions, store_access, active, created_at, last_login, password_hash';

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

  const temp_password = randomTempPassword();
  const password_hash = await hashPassword(temp_password);

  const { data, error } = await supabase
    .from('users')
    .update({ password_hash })
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

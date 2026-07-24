import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyPassword } from '../../lib/password.js';
import { rateLimit } from '../../lib/rate-limit.js';

const APP_PASSWORD = process.env.APP_PASSWORD;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Fail closed if APP_SECRET is missing — never sign tokens with a known default.
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not set');
  return s;
}

function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim() || 'unknown';
}

function signToken(payload) {
  const payloadStr = JSON.stringify(payload);
  return Buffer.from(payloadStr).toString('base64')
    + '.' + crypto.createHmac('sha256', appSecret()).update(payloadStr).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password, remember = false } = req.body || {};
  if (!password) return res.status(401).json({ error: 'Invalid credentials' });

  const ip = clientIp(req);
  if (!(await rateLimit(`login_attempts:${ip}`, 10, 3600000))) {
    return res.status(429).json({ error: 'Too many login attempts from this IP — try again later' });
  }
  if (!(await rateLimit('login_attempts_global', 200, 3600000))) {
    return res.status(429).json({ error: 'Too many login attempts — try again later' });
  }
  if (username && !(await rateLimit(`login_attempts:${username}`, 5, 900000))) {
    return res.status(429).json({ error: 'Too many login attempts for this account — try again later' });
  }

  const ttl = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  // Master fallback: empty/omitted username + APP_PASSWORD match → admin-equivalent token.
  // Kept ALWAYS available as a kill-switch, per CLAUDE.md safety rules.
  if (!username && APP_PASSWORD && password === APP_PASSWORD) {
    const token = signToken({ master: true, created: Date.now(), expires: Date.now() + ttl });
    await supabase.from('pipeline_log').insert({
      agent: 'MASTER', level: 'warn',
      message: 'Master (APP_PASSWORD) login used',
      metadata: { ip },
    });
    return res.status(200).json({ token });
  }

  if (!username) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, password_hash, role, permissions, store_access, active')
    .eq('username', username)
    .single();

  if (error || !user) {
    await logFailedLogin(username, ip, 'unknown username');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.active) {
    await logFailedLogin(username, ip, 'inactive user');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await logFailedLogin(username, ip, 'wrong password');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Fire-and-forget: never let a last_login write failure turn a successful login into a 500.
  supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)
    .then(({ error: updateError }) => {
      if (updateError) console.error('[login] last_login update failed:', { user_id: user.id, error: updateError.message });
    })
    .catch((err) => console.error('[login] last_login update threw:', { user_id: user.id, error: err.message }));

  await supabase.from('pipeline_log').insert({
    agent: 'AUTH', level: 'info',
    message: `User "${user.username}" logged in`,
    metadata: { ip, user_id: user.id },
  });

  const token = signToken({
    user_id: user.id,
    role: user.role,
    permissions: user.permissions || [],
    store_access: user.store_access || [],
    created: Date.now(),
    expires: Date.now() + ttl,
  });

  return res.status(200).json({ token });
}

async function logFailedLogin(username, ip, reason) {
  console.error('[login] Failed login attempt:', { username, ip, reason });
  await supabase.from('pipeline_log').insert({
    agent: 'AUTH', level: 'warn',
    message: `Failed login for "${username}": ${reason}`,
    metadata: { ip },
  });
}

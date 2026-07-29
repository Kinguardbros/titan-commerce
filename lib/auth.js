import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Read APP_SECRET at use-time and FAIL CLOSED if it's missing — never fall back to a
// known default (a public default secret = forgeable session tokens = auth bypass).
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not set — refusing to sign/verify tokens with a default');
  return s;
}

// Resolves a flat-hex bearer api_token (userscript flow, Task 2's generate_api_token)
// to the same user object shape as the session-token path. Called only when the token
// contains no "." (see verifyAuth's branch below) — session tokens always contain one.
async function verifyApiToken(token) {
  // Length + character-class validation before a DB round-trip — cheap short-circuit
  // for obviously-wrong input. generate_api_token issues randomBytes(32).toString('hex')
  // (64 lowercase hex chars); the >=40 guard is a defense-in-depth floor independent of
  // the exact length in case token format ever changes.
  if (token.length < 40) return null;
  if (!/^[a-f0-9]+$/.test(token)) return null;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, role, permissions, store_access, active')
    .eq('api_token', token)
    .single();

  if (error || !user || !user.active) return null;

  return {
    user_id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions || [],
    store_access: user.store_access || [],
  };
}

/**
 * Decodes + HMAC-verifies the session token, then resolves it to a user object.
 * - master token ({master:true}) → {master:true, role:'admin'} — no DB round-trip
 * - user token ({user_id}) → re-fetches the user from DB every request (must exist + be active)
 * - api_token bearer (flat hex, no ".") → verifyApiToken, same DB-freshness/active-check guarantee
 * @returns {Promise<{master:true,role:'admin'}|{user_id:string,username:string,role:string,permissions:string[],store_access:string[]}|null>}
 */
export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : req.query?.token;
  if (!token) return null;

  // Detection: session tokens are always "base64Payload.hexSignature" (contain a ".").
  // api_tokens are a flat hex string with no ".". This runs BEFORE any parsing, so a
  // malformed session token never falls through to the api_token DB lookup, and an
  // api_token never hits the HMAC/JSON try/catch below.
  if (!token.includes('.')) {
    return verifyApiToken(token);
  }

  try {
    const [payloadB64, signature] = token.split('.');
    const payloadStr = Buffer.from(payloadB64, 'base64').toString();
    const payload = JSON.parse(payloadStr);

    const expectedSig = crypto.createHmac('sha256', appSecret()).update(payloadStr).digest('hex');
    if (signature !== expectedSig) return null;

    if (payload.expires < Date.now()) return null;

    if (payload.master) {
      return { master: true, role: 'admin' };
    }

    if (!payload.user_id) return null;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, role, permissions, store_access, active')
      .eq('id', payload.user_id)
      .single();

    if (error || !user || !user.active) return null;

    return {
      user_id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions || [],
      store_access: user.store_access || [],
    };
  } catch (err) {
    console.error('[Auth] Token verification failed:', { error: err.message });
    return null;
  }
}

// Actions reachable WITHOUT a dashboard token (public storefront → TC). Hardcoded
// allow-list (never derived from user input) so only these exact actions skip auth;
// every other action stays protected. Keep this list tiny and audited.
const PUBLIC_ACTIONS = new Set(['submit_review_public', 'vote_review_helpful', 'review_helpful_counts']);

export function withAuth(handler) {
  return async (req, res) => {
    const action = req.query?.action || req.body?.action;
    if (PUBLIC_ACTIONS.has(action)) {
      return handler(req, res); // public allow-list — no token required
    }
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}

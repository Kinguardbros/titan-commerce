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

// Constant-time string equality — used for comparing secret values (HMAC
// signatures, token hashes) to avoid timing side-channels. crypto.timingSafeEqual
// throws on mismatched buffer lengths, so that's checked first: a length mismatch
// already proves inequality, and checking it first means we never call
// timingSafeEqual with unequal-length buffers.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// SHA-256 hex digest of a bearer api_token (P2 fix, AUDIT-2026-08 — api_token
// was stored in plaintext; see generate_api_token in lib/actions/users.js for
// the write side of this migration).
function hashApiToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
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

  const tokenHash = hashApiToken(token);

  // Preferred path: look up by hash. New tokens (generate_api_token, post P2-fix)
  // only ever have api_token_hash populated — api_token is cleared at generation.
  const { data: hashUser, error: hashError } = await supabase
    .from('users')
    .select('id, username, role, permissions, store_access, active, api_token_hash')
    .eq('api_token_hash', tokenHash)
    .maybeSingle();

  if (hashError) {
    console.error('[Auth] api_token_hash lookup failed:', hashError.message);
    return null;
  }

  let matchedUser = hashUser;

  if (matchedUser) {
    // Belt-and-suspenders: constant-time compare of the two hashes even though
    // the DB query above already did an exact match. Matches the "never compare
    // secrets with !==/===" discipline used elsewhere (password.js,
    // webhooks/shopify.js, and this file's session-signature check below).
    if (!safeEqual(tokenHash, matchedUser.api_token_hash)) return null;
  } else {
    // Backward-compat fallback (P2, burn-in window): rows whose api_token_hash
    // hasn't been backfilled yet still match on the legacy plaintext column.
    // Logged so we can see when this stops firing — sql/add-users-api-token-hash.sql
    // backfills every existing token, so in steady state this should be rare/never.
    const { data: legacyUser, error: legacyError } = await supabase
      .from('users')
      .select('id, username, role, permissions, store_access, active, api_token_hash')
      .eq('api_token', token)
      .maybeSingle();

    if (legacyError) {
      console.error('[Auth] legacy api_token lookup failed:', legacyError.message);
      return null;
    }
    // Only trust the plaintext match when api_token_hash is genuinely unset —
    // if it's set but didn't match tokenHash above, that's a data-integrity
    // anomaly, not a legitimate legacy token, and must not be allowed through.
    if (!legacyUser || legacyUser.api_token_hash) return null;

    console.warn(`[auth] plaintext api_token match — user ${legacyUser.id} needs to regenerate`);
    matchedUser = legacyUser;
  }

  if (!matchedUser.active) return null;

  return {
    user_id: matchedUser.id,
    username: matchedUser.username,
    role: matchedUser.role,
    permissions: matchedUser.permissions || [],
    store_access: matchedUser.store_access || [],
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
    // Constant-time compare (P2 fix, AUDIT-2026-08) — was a plain !==,
    // inconsistent with password.js / webhooks/shopify.js's timingSafeEqual
    // discipline for comparing secret values.
    if (!safeEqual(signature, expectedSig)) return null;

    if (payload.expires < Date.now()) return null;

    if (payload.master) {
      return { master: true, role: 'admin' };
    }

    if (!payload.user_id) return null;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, role, permissions, store_access, active, token_version')
      .eq('id', payload.user_id)
      .single();

    if (error || !user || !user.active) return null;

    // Session revocation (P1-15, AUDIT-2026-08): token_version is bumped on
    // password change/reset, instantly invalidating every outstanding session
    // for that user. Migration strategy: tokens signed BEFORE this deploy carry
    // no `tv` claim at all — reject them outright would log out every currently
    // active user the moment this ships. Instead, missing `tv` gets a short,
    // logged compat window; TTL means most sessions re-login within days anyway
    // (24h default, up to 30d with "remember me"), and a follow-up commit removes
    // this branch to enforce strict `tv` matching unconditionally.
    if (payload.tv === undefined) {
      console.warn('[Auth] Session token missing tv claim (pre-token_version) — accepting under compat window', { user_id: user.id });
    } else if (payload.tv !== user.token_version) {
      return null;
    }

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

// Actions reachable WITHOUT a dashboard token (public storefront → TC, or public
// infra checks). Hardcoded allow-list (never derived from user input) so only these
// exact actions skip auth; every other action stays protected. Keep this list tiny
// and audited. 'health' (P1-21, AUDIT-2026-08) is the uptime-monitor ping target —
// it returns no store/DB data, just process liveness.
const PUBLIC_ACTIONS = new Set(['submit_review_public', 'vote_review_helpful', 'review_helpful_counts', 'health']);

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

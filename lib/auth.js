import crypto from 'crypto';

// Read APP_SECRET at use-time and FAIL CLOSED if it's missing — never fall back to a
// known default (a public default secret = forgeable session tokens = auth bypass).
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not set — refusing to sign/verify tokens with a default');
  return s;
}

export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : req.query?.token;
  if (!token) return null;

  try {
    const [payloadB64, signature] = token.split('.');
    const payloadStr = Buffer.from(payloadB64, 'base64').toString();
    const payload = JSON.parse(payloadStr);

    const expectedSig = crypto.createHmac('sha256', appSecret()).update(payloadStr).digest('hex');
    if (signature !== expectedSig) return null;

    if (payload.expires < Date.now()) return null;

    return { authenticated: true };
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

import crypto from 'crypto';

const APP_SECRET = process.env.APP_SECRET || 'default-secret';

export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');

  try {
    const [payloadB64, signature] = token.split('.');
    const payloadStr = Buffer.from(payloadB64, 'base64').toString();
    const payload = JSON.parse(payloadStr);

    const expectedSig = crypto.createHmac('sha256', APP_SECRET).update(payloadStr).digest('hex');
    if (signature !== expectedSig) return null;

    if (payload.expires < Date.now()) return null;

    return { authenticated: true };
  } catch {
    return null;
  }
}

export function withAuth(handler) {
  return async (req, res) => {
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}

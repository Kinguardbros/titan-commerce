import crypto from 'crypto';

const APP_PASSWORD = process.env.APP_PASSWORD;
const APP_SECRET = process.env.APP_SECRET || 'default-secret';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, remember = false } = req.body;
  if (!password || password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const ttl = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const payload = {
    authenticated: true,
    created: Date.now(),
    expires: Date.now() + ttl,
  };
  const payloadStr = JSON.stringify(payload);
  const token = Buffer.from(payloadStr).toString('base64')
    + '.' + crypto.createHmac('sha256', APP_SECRET).update(payloadStr).digest('hex');

  return res.status(200).json({ token });
}

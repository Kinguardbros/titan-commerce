import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const APP_SECRET = 'test-secret';

// Helper to create valid tokens
function createToken(payload, secret = APP_SECRET) {
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return `${payloadB64}.${signature}`;
}

// We test verifyAuth by reimporting with controlled env
let verifyAuth;
beforeEach(async () => {
  vi.stubEnv('APP_SECRET', APP_SECRET);
  vi.resetModules();
  const mod = await import('../lib/auth.js');
  verifyAuth = mod.verifyAuth;
});

describe('verifyAuth', () => {
  it('returns null when no token provided', async () => {
    const req = { headers: {}, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('authenticates valid Bearer token', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ authenticated: true });
  });

  it('authenticates valid query token', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: {}, query: { token } };
    const result = await verifyAuth(req);
    expect(result).toEqual({ authenticated: true });
  });

  it('rejects expired token', async () => {
    const token = createToken({ expires: Date.now() - 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('rejects tampered token', async () => {
    const token = createToken({ expires: Date.now() + 60000 }, 'wrong-secret');
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('rejects malformed token', async () => {
    const req = { headers: { authorization: 'Bearer not-a-valid-token' }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });
});

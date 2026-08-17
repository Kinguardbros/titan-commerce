import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }) }) }) }),
}));

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
let withAuth;
beforeEach(async () => {
  vi.stubEnv('APP_SECRET', APP_SECRET);
  vi.resetModules();
  const mod = await import('../lib/auth.js');
  verifyAuth = mod.verifyAuth;
  withAuth = mod.withAuth;
});

// Minimal res stub capturing status + json/end.
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = () => {};
  return res;
}

describe('verifyAuth', () => {
  it('returns null when no token provided', async () => {
    const req = { headers: {}, query: {} };
    expect(await verifyAuth(req)).toBeNull();
  });

  it('authenticates a valid master Bearer token', async () => {
    const token = createToken({ master: true, expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const result = await verifyAuth(req);
    expect(result).toEqual({ master: true, role: 'admin' });
  });

  it('authenticates a valid master query token', async () => {
    const token = createToken({ master: true, expires: Date.now() + 60000 });
    const req = { headers: {}, query: { token } };
    const result = await verifyAuth(req);
    expect(result).toEqual({ master: true, role: 'admin' });
  });

  it('returns null for a token with neither master nor user_id', async () => {
    const token = createToken({ expires: Date.now() + 60000 });
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    expect(await verifyAuth(req)).toBeNull();
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

  it('rejects a signature of a different length than expected, without throwing (P2, AUDIT-2026-08 — constant-time compare)', async () => {
    // The session signature comparison switched from `!==` to a length-checked
    // crypto.timingSafeEqual (safeEqual helper). A naive direct timingSafeEqual
    // call (no length guard) throws on unequal-length buffers — this guards
    // against that regression by feeding a signature far shorter than a real
    // hex HMAC-SHA256 digest (64 chars).
    const token = createToken({ master: true, expires: Date.now() + 60000 });
    const [payloadB64] = token.split('.');
    const shortSigToken = `${payloadB64}.abcd`;
    const req = { headers: { authorization: `Bearer ${shortSigToken}` }, query: {} };
    await expect(verifyAuth(req)).resolves.toBeNull();
  });
});

describe('withAuth public allow-list', () => {
  it('lets submit_review_public through WITHOUT a token', async () => {
    const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: {}, query: { action: 'submit_review_public' }, body: {} };
    const res = mockRes();
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it.each(['vote_review_helpful', 'review_helpful_counts', 'health'])('lets %s through WITHOUT a token', async (action) => {
    const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: {}, query: { action }, body: {} };
    const res = mockRes();
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('still rejects a protected action (delete_review) without a token', async () => {
    const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: {}, query: { action: 'delete_review' }, body: {} };
    const res = mockRes();
    await wrapped(req, res);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('reads the public action from the POST body too', async () => {
    const handler = vi.fn((req, res) => res.status(200).json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: {}, query: {}, body: { action: 'submit_review_public' } };
    const res = mockRes();
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledOnce();
  });
});

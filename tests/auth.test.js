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

  it.each(['vote_review_helpful', 'review_helpful_counts'])('lets %s through WITHOUT a token', async (action) => {
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

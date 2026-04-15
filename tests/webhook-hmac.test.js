import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock Supabase so that transitive imports in api/webhooks/shopify.js don't explode
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: vi.fn() }),
}));

let verifyHmac;

beforeEach(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.resetModules();
  const mod = await import('../api/webhooks/shopify.js');
  verifyHmac = mod.verifyHmac;
});

describe('Shopify webhook HMAC verification (base64)', () => {
  const secret = 'test-secret';
  const body = '{"id":12345,"title":"Test Product"}';

  it('accepts a valid base64 HMAC signature', () => {
    const rawBody = Buffer.from(body);
    const validDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    expect(verifyHmac(rawBody, validDigest, secret)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const rawBody = Buffer.from(body);
    expect(verifyHmac(rawBody, 'bogus-signature', secret)).toBe(false);
  });

  it('rejects when hmac header is missing', () => {
    const rawBody = Buffer.from(body);
    expect(verifyHmac(rawBody, null, secret)).toBe(false);
    expect(verifyHmac(rawBody, '', secret)).toBe(false);
  });

  it('rejects when secret is missing', () => {
    const rawBody = Buffer.from(body);
    const validDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    expect(verifyHmac(rawBody, validDigest, null)).toBe(false);
    expect(verifyHmac(rawBody, validDigest, '')).toBe(false);
  });

  it('rejects when body has been modified', () => {
    const rawBody = Buffer.from(body);
    const validDigest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const tampered = Buffer.from('{"id":12345,"title":"Hacked"}');
    expect(verifyHmac(tampered, validDigest, secret)).toBe(false);
  });

  it('rejects when signed with wrong secret', () => {
    const rawBody = Buffer.from(body);
    const wrongDigest = crypto.createHmac('sha256', 'other-secret').update(rawBody).digest('base64');
    expect(verifyHmac(rawBody, wrongDigest, secret)).toBe(false);
  });
});

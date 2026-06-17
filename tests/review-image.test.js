import { describe, it, expect, vi, beforeAll } from 'vitest';

// reviews-shared.js creates a Supabase client at import time → needs env present.
let decodeAndValidateImage;
beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  ({ decodeAndValidateImage } = await import('../lib/actions/reviews-shared.js'));
});

// Helper: base64 of a buffer with given leading bytes (+ padding to a target length).
function b64(bytes, totalLen = bytes.length) {
  const buf = Buffer.alloc(totalLen);
  bytes.forEach((b, i) => { buf[i] = b; });
  return buf.toString('base64');
}

describe('decodeAndValidateImage', () => {
  const MAX = 5 * 1024 * 1024;

  it('accepts a JPEG (FF D8) and reports jpg/image/jpeg', () => {
    const r = decodeAndValidateImage(b64([0xFF, 0xD8, 0xFF, 0xE0], 64), MAX);
    expect(r.error).toBeUndefined();
    expect(r.ext).toBe('jpg');
    expect(r.contentType).toBe('image/jpeg');
  });

  it('accepts a PNG (89 50 4E 47)', () => {
    const r = decodeAndValidateImage(b64([0x89, 0x50, 0x4E, 0x47], 64), MAX);
    expect(r.ext).toBe('png');
    expect(r.contentType).toBe('image/png');
  });

  it('accepts a WebP (RIFF....WEBP)', () => {
    const buf = Buffer.alloc(64);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    const r = decodeAndValidateImage(buf.toString('base64'), MAX);
    expect(r.ext).toBe('webp');
  });

  it('rejects a non-image (plain text bytes)', () => {
    const r = decodeAndValidateImage(Buffer.from('this is not an image at all').toString('base64'), MAX);
    expect(r.error).toBeTruthy();
    expect(r.buf).toBeUndefined();
  });

  it('rejects empty input', () => {
    expect(decodeAndValidateImage('', MAX).error).toBe('empty image');
  });

  it('rejects oversized input', () => {
    const r = decodeAndValidateImage(b64([0xFF, 0xD8], 6 * 1024 * 1024), MAX);
    expect(r.error).toMatch(/too large/);
  });
});

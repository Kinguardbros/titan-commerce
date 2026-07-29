import { describe, it, expect, vi, beforeAll } from 'vitest';

// reviews-shared.js creates a Supabase client at import time → needs env present.
let validateImageBuffer, decodeAndValidateImage;
beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  ({ validateImageBuffer, decodeAndValidateImage } = await import('../lib/actions/reviews-shared.js'));
});

// Minimal valid magic-byte headers for each format (bodies are junk — only the
// header bytes are checked by validateImageBuffer).
const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
function webpBuffer() {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

describe('validateImageBuffer', () => {
  it('accepts a JPEG buffer', () => {
    const result = validateImageBuffer(JPEG_HEADER, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buf).toBe(JPEG_HEADER);
  });

  it('accepts a PNG buffer', () => {
    const result = validateImageBuffer(PNG_HEADER, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('png');
    expect(result.contentType).toBe('image/png');
  });

  it('accepts a WebP buffer', () => {
    const result = validateImageBuffer(webpBuffer(), 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('webp');
    expect(result.contentType).toBe('image/webp');
  });

  it('rejects an empty buffer', () => {
    const result = validateImageBuffer(Buffer.alloc(0), 1024);
    expect(result.error).toBe('empty image');
  });

  it('rejects a buffer over the size cap', () => {
    const big = Buffer.concat([JPEG_HEADER, Buffer.alloc(2 * 1024 * 1024)]);
    const result = validateImageBuffer(big, 1024 * 1024);
    expect(result.error).toMatch(/too large/);
  });

  it('rejects a buffer with unrecognized magic bytes', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const result = validateImageBuffer(junk, 1024 * 1024);
    expect(result.error).toBe('file is not a JPEG/PNG/WebP image');
  });
});

describe('decodeAndValidateImage — delegates to validateImageBuffer', () => {
  it('decodes base64 then validates a JPEG', () => {
    const b64 = JPEG_HEADER.toString('base64');
    const result = decodeAndValidateImage(b64, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('jpg');
  });

  it('rejects malformed base64 that decodes to empty', () => {
    const result = decodeAndValidateImage('', 1024 * 1024);
    expect(result.error).toBe('empty image');
  });

  it('rejects base64 decoding to junk magic bytes', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
    const result = decodeAndValidateImage(junk, 1024 * 1024);
    expect(result.error).toBe('file is not a JPEG/PNG/WebP image');
  });
});

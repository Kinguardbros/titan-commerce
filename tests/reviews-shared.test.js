import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// deleteReviewPhotosSettled calls the module's real `supabase` singleton (storage.
// remove()) — mock the client so those tests don't hit the network. The other tests
// below (validateImageBuffer/insertReviewsTolerant) don't touch `supabase` at all, so
// this mock is a no-op for them.
const removeMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: (...args) => removeMock(...args) }) },
  }),
}));

// reviews-shared.js creates a Supabase client at import time → needs env present.
let validateImageBuffer, decodeAndValidateImage, insertReviewsTolerant, deleteReviewPhotosSettled;
beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  ({ validateImageBuffer, decodeAndValidateImage, insertReviewsTolerant, deleteReviewPhotosSettled } = await import('../lib/actions/reviews-shared.js'));
});

// Minimal fake `db` — insertReviewsTolerant only calls `db.from('product_reviews').insert(row)`,
// so a hand-rolled stub (no real/mocked Supabase client needed) is enough to drive it.
function fakeDb(insertImpl) {
  return { from: () => ({ insert: insertImpl }) };
}

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

describe('insertReviewsTolerant — per-row 23505 tolerance (TOCTOU defense)', () => {
  it('inserts every row when none collide', async () => {
    const inserted = [];
    const db = fakeDb(async (row) => { inserted.push(row); return { error: null }; });
    const rows = [{ author: 'A', body: 'a' }, { author: 'B', body: 'b' }, { author: 'C', body: 'c' }];

    const result = await insertReviewsTolerant(db, rows);

    expect(result).toEqual({ inserted: 3, skipped_duplicates: 0 });
    expect(inserted).toHaveLength(3);
  });

  it('catches a 23505 (unique_violation) on one row, skips it, and keeps inserting the rest — does not throw', async () => {
    let call = 0;
    const attempted = [];
    const db = fakeDb(async (row) => {
      call += 1;
      attempted.push(row);
      // Simulate a concurrent request winning the insert race for the 2nd row only —
      // this is the TOCTOU window between dropExistingDuplicates()'s pre-check and here.
      if (call === 2) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_product_reviews_dedup"' } };
      return { error: null };
    });
    const rows = [{ author: 'A', body: 'a' }, { author: 'B', body: 'b' }, { author: 'C', body: 'c' }];

    await expect(insertReviewsTolerant(db, rows)).resolves.toEqual({ inserted: 2, skipped_duplicates: 1 });
    expect(attempted).toHaveLength(3); // every row was attempted — the batch wasn't aborted
  });

  it('does NOT swallow a non-23505 error — still throws (real DB errors must surface)', async () => {
    const db = fakeDb(async () => ({ error: { code: '23502', message: 'null value in column violates not-null constraint' } }));
    const rows = [{ author: 'A', body: 'a' }];

    await expect(insertReviewsTolerant(db, rows)).rejects.toMatchObject({ code: '23502' });
  });

  it('returns zeros for an empty batch without calling insert', async () => {
    const insertFn = vi.fn();
    const db = fakeDb(insertFn);

    const result = await insertReviewsTolerant(db, []);

    expect(result).toEqual({ inserted: 0, skipped_duplicates: 0 });
    expect(insertFn).not.toHaveBeenCalled();
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

// Photo cleanup (reviews Storage cleanup — set_review_status reject hook +
// cleanup_orphan_review_photos admin sweep both call this for the actual Storage
// removal work).
describe('deleteReviewPhotosSettled — batch Storage removal, tolerates per-file failures', () => {
  beforeEach(() => { removeMock.mockReset(); });

  it('parses store-docs public URLs into their Storage object paths and removes each one', async () => {
    removeMock.mockResolvedValue({ error: null });
    const urls = [
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_1.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_2.jpg',
    ];

    const result = await deleteReviewPhotosSettled(urls);

    expect(result).toEqual({ removed: 2, failed: 0, failures: [] });
    expect(removeMock).toHaveBeenCalledWith(['isola/Reviews/p1/photo_1.jpg']);
    expect(removeMock).toHaveBeenCalledWith(['isola/Reviews/p1/photo_2.jpg']);
  });

  it('tolerates one file failing (Promise.allSettled) — the rest still get removed, no throw', async () => {
    removeMock.mockImplementation(async (paths) => {
      if (paths[0].includes('photo_2')) return { error: { message: 'not found' } };
      return { error: null };
    });
    const urls = [
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_1.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_2.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_3.jpg',
    ];

    const result = await deleteReviewPhotosSettled(urls);

    expect(result.removed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ path: 'isola/Reviews/p1/photo_2.jpg', error: 'not found' }]);
  });

  it('tolerates a rejected promise (network error) the same way as a returned error', async () => {
    removeMock.mockImplementation(async (paths) => {
      if (paths[0].includes('photo_2')) throw new Error('network timeout');
      return { error: null };
    });
    const urls = [
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_1.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_2.jpg',
    ];

    const result = await deleteReviewPhotosSettled(urls);

    expect(result.removed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toEqual({ path: 'isola/Reviews/p1/photo_2.jpg', error: 'network timeout' });
  });

  it('ignores URLs not from the store-docs bucket and dedups repeated URLs', async () => {
    removeMock.mockResolvedValue({ error: null });
    const urls = [
      'https://cdn.other.com/not-ours.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_1.jpg',
      'https://example.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/photo_1.jpg', // dup
      null,
    ];

    const result = await deleteReviewPhotosSettled(urls);

    expect(result.removed).toBe(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('returns zeros for empty/no-photo input without calling remove', async () => {
    const result = await deleteReviewPhotosSettled([]);
    expect(result).toEqual({ removed: 0, failed: 0, failures: [] });
    expect(removeMock).not.toHaveBeenCalled();
  });
});

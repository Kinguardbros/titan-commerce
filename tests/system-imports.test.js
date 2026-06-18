import { describe, it, expect, vi, beforeAll } from 'vitest';

// Guards against import-time crashes (e.g. an action importing a symbol a sibling
// module doesn't export). A broken import here takes down the ENTIRE api/system.js
// router → every action returns FUNCTION_INVOCATION_FAILED. This test would have
// caught the missing deleteReviewPhoto/flagProductNeedsRepush exports.
describe('api/system.js import chain', () => {
  beforeAll(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('APP_SECRET', 'test-secret');
  });

  it('loads the router and all action modules without throwing', async () => {
    const mod = await import('../api/system.js');
    expect(typeof mod.default).toBe('function'); // the withAuth(handler) export
  });

  it('reviews-shared exports every helper the reviews modules import', async () => {
    const shared = await import('../lib/actions/reviews-shared.js');
    ['supabase', 'computeSummary', 'safePhotoUrl', 'decodeAndValidateImage',
     'uploadReviewImage', 'dropExistingDuplicates', 'deleteReviewPhoto', 'flagProductNeedsRepush']
      .forEach((name) => expect(shared[name], `missing export: ${name}`).toBeDefined());
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Review photo Storage cleanup — two mechanisms per the F04 audit finding
// that rejected/pending reviews leave their uploaded photos as orphans in
// Supabase Storage indefinitely:
//
//   1. set_review_status (lib/actions/reviews.js) — when a batch transitions
//      to 'rejected', delete the Storage photos for those rows and clear
//      photo_url/photo_urls on the DB row.
//   2. cleanup_orphan_review_photos (lib/actions/reviews-cleanup.js) — admin
//      sweep: pending/rejected reviews older than 30 days, across all stores.
//
// Both delegate the actual Storage removal to deleteReviewPhotosSettled
// (reviews-shared.js — unit-tested directly in tests/reviews-shared.test.js
// against a mocked Supabase client). Here deleteReviewPhotosSettled itself is
// mocked so these tests focus purely on each action's orchestration: which
// URLs it collects and hands off, what it writes back to the DB, and what it
// logs — not the URL-to-path parsing (already covered elsewhere).
// ---------------------------------------------------------------------------

const state = {
  selectQueues: {},   // table -> ordered array of {data, error} consumed by each .select()
  updateCalls: [],    // { table, values } for every .update() call
  updateResponse: { data: [{ id: 'r1' }], error: null },
  logged: [],
  lastLt: null,
};

function resetState() {
  state.selectQueues = {};
  state.updateCalls = [];
  state.updateResponse = { data: [{ id: 'r1' }], error: null };
  state.logged = [];
  state.lastLt = null;
}

function makeBuilder(table) {
  let mode = null; // 'select' | 'update'
  let response = null;
  const builder = {
    select: vi.fn(() => {
      if (mode !== 'update') {
        mode = 'select';
        const q = state.selectQueues[table] || [];
        response = q.length ? q.shift() : { data: [], error: null };
      }
      return builder;
    }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lt: vi.fn((col, val) => { state.lastLt = { table, col, val }; return builder; }),
    order: vi.fn(() => builder),
    update: vi.fn((values) => {
      mode = 'update';
      state.updateCalls.push({ table, values });
      response = state.updateResponse;
      return builder;
    }),
    then: (resolve, reject) => Promise.resolve(response ?? { data: [], error: null }).then(resolve, reject),
  };
  return builder;
}

const deleteReviewPhotosSettledMock = vi.fn();
const flagProductNeedsRepushMock = vi.fn();

vi.mock('../lib/actions/reviews-shared.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'pipeline_log') {
        return { insert: vi.fn(async (row) => { state.logged.push(row); return { error: null }; }) };
      }
      return makeBuilder(table);
    },
  },
  deleteReviewPhotosSettled: (...args) => deleteReviewPhotosSettledMock(...args),
  flagProductNeedsRepush: (...args) => flagProductNeedsRepushMock(...args),
  computeSummary: vi.fn(),
  safePhotoUrl: (u) => u,
  deleteReviewPhoto: vi.fn(),
}));

const ADMIN_USER = { role: 'admin', user_id: 'admin-1', permissions: [], store_access: [] };
const MEMBER_NO_ADMIN = { role: 'member', user_id: 'u-2', permissions: ['products:edit'], store_access: ['s1'] };

function mockReqRes(body, user = ADMIN_USER) {
  const req = { body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

beforeEach(() => {
  vi.resetModules();
  resetState();
  deleteReviewPhotosSettledMock.mockReset();
  flagProductNeedsRepushMock.mockReset();
});

const PHOTO_A = 'https://x.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/a.jpg';
const PHOTO_B = 'https://x.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/b.jpg';
const PHOTO_LEGACY = 'https://x.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/p1/legacy.jpg';

describe('set_review_status — reject hook cleans up Storage photos', () => {
  it("rejecting reviews with photos: collects photo_urls + legacy photo_url, calls Storage cleanup, and clears both DB fields", async () => {
    // 1st select: liveProducts check (none published). 2nd select: photo_url/photo_urls for the batch.
    state.selectQueues.product_reviews = [
      { data: [], error: null },
      {
        data: [
          { photo_url: PHOTO_LEGACY, photo_urls: [PHOTO_A, PHOTO_B] },
          { photo_url: null, photo_urls: null },
        ],
        error: null,
      },
    ];
    state.updateResponse = { data: [{ id: 'r1' }, { id: 'r2' }], error: null };
    deleteReviewPhotosSettledMock.mockResolvedValue({ removed: 3, failed: 0, failures: [] });

    const { set_review_status } = await import('../lib/actions/reviews.js');
    const { req, res } = mockReqRes({ ids: ['r1', 'r2'], status: 'rejected', store_id: 's1' });

    await set_review_status(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Photos from both photo_urls entries AND the legacy photo_url are all handed to cleanup.
    expect(deleteReviewPhotosSettledMock).toHaveBeenCalledWith([PHOTO_A, PHOTO_B, PHOTO_LEGACY]);

    const statusUpdate = state.updateCalls.find((c) => c.table === 'product_reviews');
    expect(statusUpdate.values).toMatchObject({ status: 'rejected', photo_url: null, photo_urls: null });
    expect(typeof statusUpdate.values.updated_at).toBe('string');

    const infoLog = state.logged.find((l) => l.level === 'info');
    expect(infoLog).toMatchObject({ store_id: 's1', agent: 'REVIEWS', initiator: 'user', user_id: 'admin-1' });
    expect(infoLog.message).toContain('3 photo(s) removed from Storage');
  });

  it('logs a warn-level pipeline_log entry when some Storage removals fail, but still completes the transition', async () => {
    state.selectQueues.product_reviews = [
      { data: [], error: null },
      { data: [{ photo_url: null, photo_urls: [PHOTO_A, PHOTO_B] }], error: null },
    ];
    deleteReviewPhotosSettledMock.mockResolvedValue({
      removed: 1, failed: 1, failures: [{ path: 'isola/Reviews/p1/b.jpg', error: 'not found' }],
    });

    const { set_review_status } = await import('../lib/actions/reviews.js');
    const { req, res } = mockReqRes({ ids: ['r1'], status: 'rejected', store_id: 's1' });

    await set_review_status(req, res);

    expect(res.status).toHaveBeenCalledWith(200); // failure is tolerated, not fatal
    const warnLog = state.logged.find((l) => l.level === 'warn');
    expect(warnLog).toMatchObject({ store_id: 's1', initiator: 'user', user_id: 'admin-1' });
    expect(warnLog.message).toMatch(/1.*failed/);
  });

  it('does NOT touch Storage or photo fields when approving (only "rejected" triggers cleanup)', async () => {
    state.updateResponse = { data: [{ id: 'r1' }], error: null };

    const { set_review_status } = await import('../lib/actions/reviews.js');
    const { req, res } = mockReqRes({ ids: ['r1'], status: 'approved', store_id: 's1' });

    await set_review_status(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(deleteReviewPhotosSettledMock).not.toHaveBeenCalled();
    const statusUpdate = state.updateCalls.find((c) => c.table === 'product_reviews');
    expect(statusUpdate.values).not.toHaveProperty('photo_url');
    expect(statusUpdate.values).not.toHaveProperty('photo_urls');
  });
});

describe('cleanup_orphan_review_photos — admin sweep', () => {
  it('cleans pending/rejected reviews older than 30 days and returns aggregate counts', async () => {
    state.selectQueues.product_reviews = [
      {
        data: [
          { id: 'rev1', store_id: 'sA', photo_urls: [PHOTO_A, PHOTO_B], photo_url: null },
          { id: 'rev2', store_id: 'sB', photo_urls: null, photo_url: PHOTO_LEGACY },
        ],
        error: null,
      },
    ];
    state.updateResponse = { data: [], error: null };
    deleteReviewPhotosSettledMock
      .mockResolvedValueOnce({ removed: 2, failed: 0, failures: [] })
      .mockResolvedValueOnce({ removed: 1, failed: 0, failures: [] });

    const { cleanup_orphan_review_photos } = await import('../lib/actions/reviews-cleanup.js');
    const { req, res } = mockReqRes({});

    await cleanup_orphan_review_photos(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ reviews_cleaned: 2, files_removed: 3, files_failed: 0 });
    expect(deleteReviewPhotosSettledMock).toHaveBeenNthCalledWith(1, [PHOTO_A, PHOTO_B]);
    expect(deleteReviewPhotosSettledMock).toHaveBeenNthCalledWith(2, [PHOTO_LEGACY]);

    // Both candidate rows got their DB photo fields cleared.
    const dbUpdates = state.updateCalls.filter((c) => c.table === 'product_reviews');
    expect(dbUpdates).toHaveLength(2);
    for (const u of dbUpdates) expect(u.values).toEqual({ photo_url: null, photo_urls: null });

    // One pipeline_log entry per distinct store touched.
    expect(state.logged).toHaveLength(2);
    expect(state.logged.map((l) => l.store_id).sort()).toEqual(['sA', 'sB']);
    for (const l of state.logged) expect(l).toMatchObject({ initiator: 'user', user_id: 'admin-1', agent: 'REVIEWS' });
  });

  it('respects the 30-day threshold — queries created_at older than ~30 days', async () => {
    state.selectQueues.product_reviews = [{ data: [], error: null }];

    const { cleanup_orphan_review_photos } = await import('../lib/actions/reviews-cleanup.js');
    const { req, res } = mockReqRes({});

    await cleanup_orphan_review_photos(req, res);

    expect(res.json).toHaveBeenCalledWith({ reviews_cleaned: 0, files_removed: 0, files_failed: 0 });
    expect(state.lastLt).toBeTruthy();
    expect(state.lastLt.col).toBe('created_at');
    const cutoffMs = new Date(state.lastLt.val).getTime();
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(60_000); // within a minute of "30 days ago"
  });

  it('403s a caller without admin:users permission, without touching Storage or the DB', async () => {
    const { cleanup_orphan_review_photos } = await import('../lib/actions/reviews-cleanup.js');
    const { req, res } = mockReqRes({}, MEMBER_NO_ADMIN);

    await cleanup_orphan_review_photos(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'forbidden' }));
    expect(deleteReviewPhotosSettledMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });
});

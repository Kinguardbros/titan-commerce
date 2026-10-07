import { describe, it, expect, vi, beforeEach } from 'vitest';

// set_review_count_override: a hand-set storefront review count per product (null = real count).

const state = { updated: null, row: { id: 'p1', title: 'Halter One-Piece' }, logged: [] };

vi.mock('../lib/actions/reviews-shared.js', () => ({
  supabase: {
    from: (table) => {
      if (table === 'pipeline_log') return { insert: vi.fn(async (row) => { state.logged.push(row); return { error: null }; }) };
      const b = {
        update: vi.fn((patch) => { state.updated = patch; return b; }),
        eq: vi.fn(() => b),
        select: vi.fn(() => b),
        maybeSingle: vi.fn(async () => ({ data: state.row, error: null })),
      };
      return b;
    },
  },
  computeSummary: vi.fn(),
  safePhotoUrl: (u) => u,
  flagProductNeedsRepush: vi.fn(),
  deleteReviewPhoto: vi.fn(),
  deleteReviewPhotosSettled: vi.fn(),
  withThumbnailPhotos: (r) => r,
  stripLoneSurrogates: (s) => s,
}));

const ADMIN = { role: 'admin', user_id: 'u1', permissions: [], store_access: [] };
const VIEWER = { role: 'member', user_id: 'u2', permissions: ['products:read'], store_access: ['s1'] };
function call(body, user = ADMIN) {
  const req = { body, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

beforeEach(() => {
  state.updated = null;
  state.row = { id: 'p1', title: 'Halter One-Piece' };
  state.logged = [];
});

describe('set_review_count_override', () => {
  it('stores a whole number and logs it', async () => {
    const { set_review_count_override } = await import('../lib/actions/reviews.js');
    const { req, res } = call({ store_id: 's1', product_id: 'p1', count: '320' });
    await set_review_count_override(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(state.updated).toEqual({ review_count_override: 320 });
    expect(state.logged[0].message).toMatch(/320/);
  });

  it('clears with null or an empty string', async () => {
    const { set_review_count_override } = await import('../lib/actions/reviews.js');
    for (const count of [null, '']) {
      const { req, res } = call({ store_id: 's1', product_id: 'p1', count });
      await set_review_count_override(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(state.updated).toEqual({ review_count_override: null });
    }
  });

  it('rejects negatives, fractions, text and huge numbers', async () => {
    const { set_review_count_override } = await import('../lib/actions/reviews.js');
    for (const count of [-1, 2.5, 'abc', 1000001]) {
      const { req, res } = call({ store_id: 's1', product_id: 'p1', count });
      await set_review_count_override(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(state.updated).toBeNull();
  });

  it('requires products:edit', async () => {
    const { set_review_count_override } = await import('../lib/actions/reviews.js');
    const { req, res } = call({ store_id: 's1', product_id: 'p1', count: 10 }, VIEWER);
    await set_review_count_override(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(state.updated).toBeNull();
  });

  it('404 when the product is not in the store', async () => {
    state.row = null;
    const { set_review_count_override } = await import('../lib/actions/reviews.js');
    const { req, res } = call({ store_id: 's1', product_id: 'other', count: 10 });
    await set_review_count_override(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

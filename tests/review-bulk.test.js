import { describe, it, expect, vi } from 'vitest';
import { approveAllPending } from '../apps/dashboard/src/lib/review-bulk.js';

const review = (id, status) => ({ id, status });

describe('approveAllPending', () => {
  it('approves only the pending reviews', async () => {
    const setStatus = vi.fn(async (ids) => ({ updated: ids.length }));
    const reviews = [review('a', 'pending'), review('b', 'approved'), review('c', 'published'), review('d', 'rejected'), review('e', 'pending')];

    const updated = await approveAllPending(reviews, 's1', setStatus);

    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(['a', 'e'], 'approved', 's1');
    expect(updated).toBe(2);
  });

  it('sends at most 100 ids per request', async () => {
    const setStatus = vi.fn(async (ids) => ({ updated: ids.length }));
    const reviews = Array.from({ length: 250 }, (_, i) => review(`r${i}`, 'pending'));

    const updated = await approveAllPending(reviews, 's1', setStatus);

    expect(setStatus.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 50]);
    expect(updated).toBe(250);
  });

  it('does nothing when no review is pending', async () => {
    const setStatus = vi.fn();
    const updated = await approveAllPending([review('a', 'published')], 's1', setStatus);

    expect(setStatus).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });
});

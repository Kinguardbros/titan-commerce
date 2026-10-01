import { describe, it, expect, vi } from 'vitest';
import { copyToProducts } from '../apps/dashboard/src/lib/review-bulk.js';

describe('copyToProducts', () => {
  it('copies to each target in turn and adds up the results', async () => {
    const copyOne = vi.fn(async (id) => ({ copied: id === 'b' ? 2 : 3, duplicates: 1 }));
    const progress = [];

    const result = await copyToProducts(['a', 'b'], copyOne, (done, total) => progress.push(`${done}/${total}`));

    expect(copyOne.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(result).toEqual({ copied: 5, duplicates: 2, failed: [] });
    expect(progress).toEqual(['0/2', '1/2', '2/2']);
  });

  it('keeps going after a failed product and reports it', async () => {
    const copyOne = vi.fn(async (id) => {
      if (id === 'b') throw new Error('boom');
      return { copied: 1, duplicates: 0 };
    });

    const result = await copyToProducts(['a', 'b', 'c'], copyOne, () => {});

    expect(copyOne).toHaveBeenCalledTimes(3);
    expect(result.copied).toBe(2);
    expect(result.failed).toEqual([{ id: 'b', error: 'boom' }]);
  });
});

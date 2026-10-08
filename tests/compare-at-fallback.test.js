import { describe, it, expect, vi } from 'vitest';
import {
  fallbackCompareCents,
  decideFallbackWrite,
  fallbackEnabled,
  ensureCompareAtFallback,
} from '../lib/compare-at-fallback.js';

// Struck-price fallback for Clara Atelier (2026-10-08): Shopify hides variant compare-at prices
// from EU buyers, the theme prints custom.source_compare_at_cents instead, and imported products
// arrived without it. Titan fills it from the variants on the product webhooks.

const v = (price, compare_at_price) => ({ price, compare_at_price });
const clara = { id: 's1', shopify_url: 'clara.myshopify.com', brand_config: { features: { compare_at_fallback_metafield: true } } };

function fakeFetch(currentValue, { userErrors = [] } = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const isWrite = body.query.includes('metafieldsSet');
    const data = isWrite
      ? { metafieldsSet: { userErrors } }
      : { product: { metafield: currentValue === null ? null : { value: String(currentValue) } } };
    return { json: async () => ({ data }) };
  });
  fn.calls = calls;
  return fn;
}

describe('fallbackCompareCents', () => {
  it('uses the shared compare-at of all variants, in cents', () => {
    expect(fallbackCompareCents([v('59.95', '129.95'), v('59.95', '129.95')])).toEqual({ cents: 12995, uniform: true });
  });
  it('ignores compare-at prices that are not above the price', () => {
    expect(fallbackCompareCents([v('59.95', '59.95'), v('59.95', null)])).toBeNull();
    expect(fallbackCompareCents([v('59.95', '49.95')])).toBeNull();
  });
  it('takes the lowest qualifying compare-at when variants differ, and marks it not uniform', () => {
    expect(fallbackCompareCents([v('69.95', '156.90'), v('59.95', '142.90')])).toEqual({ cents: 14290, uniform: false });
  });
  it('is not uniform when some variants carry no compare-at', () => {
    expect(fallbackCompareCents([v('59.95', '129.95'), v('59.95', null)])).toEqual({ cents: 12995, uniform: false });
  });
  it('copes with missing or empty input', () => {
    expect(fallbackCompareCents(undefined)).toBeNull();
    expect(fallbackCompareCents([])).toBeNull();
  });
});

describe('decideFallbackWrite', () => {
  it('fills an empty metafield', () => {
    expect(decideFallbackWrite(null, { cents: 12995, uniform: true })).toBe('set');
    expect(decideFallbackWrite(null, { cents: 14290, uniform: false })).toBe('set');
  });
  it('corrects a different value only when all variants share one compare-at', () => {
    expect(decideFallbackWrite(17990, { cents: 12995, uniform: true })).toBe('set');
    expect(decideFallbackWrite(14290, { cents: 13900, uniform: false })).toBe('kept');
  });
  it('keeps an equal value and does nothing without a qualifying compare-at', () => {
    expect(decideFallbackWrite(12995, { cents: 12995, uniform: true })).toBe('kept');
    expect(decideFallbackWrite(12995, null)).toBe('none');
  });
});

describe('ensureCompareAtFallback', () => {
  const product = { id: 16620093702493, title: 'KELLEY', variants: [v('59.95', '129.95'), v('59.95', '129.95')] };

  it('does nothing for a store that has not opted in', async () => {
    const f = fakeFetch(null);
    expect(fallbackEnabled({ brand_config: {} })).toBe(false);
    expect(await ensureCompareAtFallback({ id: 's2', shopify_url: 'x', brand_config: {} }, product, f)).toEqual({ action: 'off' });
    expect(f).not.toHaveBeenCalled();
  });

  it('writes the metafield when it is missing', async () => {
    const f = fakeFetch(null);
    const res = await ensureCompareAtFallback(clara, product, f);
    expect(res).toEqual({ action: 'set', cents: 12995, previous: null });
    const write = f.calls.find((c) => c.query.includes('metafieldsSet'));
    expect(write.variables.m[0]).toEqual({
      ownerId: 'gid://shopify/Product/16620093702493', namespace: 'custom', key: 'source_compare_at_cents',
      type: 'number_integer', value: '12995',
    });
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/clara\.myshopify\.com\/admin\/api\/.+\/graphql\.json$/);
  });

  it('only reads when the metafield already matches (the update webhook its own write causes)', async () => {
    const f = fakeFetch(12995);
    expect(await ensureCompareAtFallback(clara, product, f)).toEqual({ action: 'kept', cents: 12995, previous: 12995 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('skips the Shopify calls entirely without a qualifying compare-at', async () => {
    const f = fakeFetch(null);
    expect(await ensureCompareAtFallback(clara, { id: 1, variants: [v('59.95', null)] }, f)).toEqual({ action: 'none' });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws on Shopify user errors so the caller can log them', async () => {
    const f = fakeFetch(null, { userErrors: [{ field: ['value'], message: 'bad value' }] });
    await expect(ensureCompareAtFallback(clara, product, f)).rejects.toThrow('bad value');
  });
});

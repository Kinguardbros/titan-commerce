import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: upsertMock,
    }),
  }),
}));

describe('upsertProductFromShopify — status handling', () => {
  let upsertProductFromShopify;

  beforeEach(async () => {
    vi.resetModules();
    upsertMock.mockClear();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/product-upsert.js');
    upsertProductFromShopify = mod.upsertProductFromShopify;
  });

  it('preserves DRAFT status from Shopify payload', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 111, handle: 'h1', title: 'T1', status: 'draft',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' }),
      expect.any(Object),
    );
  });

  it('preserves ARCHIVED status from Shopify payload', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 112, handle: 'h2', title: 'T2', status: 'archived',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' }),
      expect.any(Object),
    );
  });

  it('defaults to active when status is missing', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 113, handle: 'h3', title: 'T3',
      variants: [{ price: '10.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.any(Object),
    );
  });
});

describe('upsertProductFromShopify — composite store scoping (P0-4, AUDIT-2026-08)', () => {
  let upsertProductFromShopify;

  beforeEach(async () => {
    vi.resetModules();
    upsertMock.mockClear();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/product-upsert.js');
    upsertProductFromShopify = mod.upsertProductFromShopify;
  });

  it('uses composite onConflict target store_id,shopify_id — not the old global shopify_id', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 201, handle: 'black-dress', title: 'Black Dress',
      variants: [{ price: '49.00' }], images: [], body_html: '',
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.any(Object),
      { onConflict: 'store_id,shopify_id' },
    );
  });

  it('two stores insert a product with the same handle → both succeed independently (no cross-store dedup)', async () => {
    await upsertProductFromShopify('store-1', 'shop-a.myshopify.com', {
      id: 301, handle: 'black-dress', title: 'Black Dress (Store A)',
      variants: [{ price: '49.00' }], images: [], body_html: '',
    });
    await upsertProductFromShopify('store-2', 'shop-b.myshopify.com', {
      id: 302, handle: 'black-dress', title: 'Black Dress (Store B)',
      variants: [{ price: '59.00' }], images: [], body_html: '',
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const [firstData] = upsertMock.mock.calls[0];
    const [secondData] = upsertMock.mock.calls[1];
    expect(firstData).toMatchObject({ store_id: 'store-1', handle: 'black-dress', shopify_id: 301 });
    expect(secondData).toMatchObject({ store_id: 'store-2', handle: 'black-dress', shopify_id: 302 });
  });

  it('same store re-syncing the same handle upserts (overwrite) — keyed on the composite store_id+shopify_id conflict target', async () => {
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 401, handle: 'black-dress', title: 'Black Dress (old title)',
      variants: [{ price: '49.00' }], images: [], body_html: '',
    });
    await upsertProductFromShopify('store-1', 'shop.myshopify.com', {
      id: 401, handle: 'black-dress', title: 'Black Dress (updated title)',
      variants: [{ price: '39.00' }], images: [], body_html: '',
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const [, firstOpts] = upsertMock.mock.calls[0];
    const [, secondOpts] = upsertMock.mock.calls[1];
    expect(firstOpts).toEqual({ onConflict: 'store_id,shopify_id' });
    expect(secondOpts).toEqual({ onConflict: 'store_id,shopify_id' });
    const [secondData] = upsertMock.mock.calls[1];
    expect(secondData).toMatchObject({
      store_id: 'store-1', shopify_id: 401, title: 'Black Dress (updated title)',
    });
  });
});

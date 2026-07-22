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

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-23 (Docs/AUDIT-2026-08.md): lib/shopify-webhook-handlers.js had ZERO test
// coverage despite being the highest-attack-surface file in the repo — it
// processes untrusted external Shopify webhook payloads and its call volume
// scales with store count. handleProductCreate/Update delegate entirely to
// upsertProductFromShopify (already covered by tests/product-upsert.test.js —
// including the "webhook path never touches tags" behavior); this file proves
// the DELEGATION happens with the right args, and that handleProductDelete
// does a soft archive (UPDATE), never a hard DELETE.
// ---------------------------------------------------------------------------

const upsertProductFromShopifyMock = vi.fn().mockResolvedValue({ shopify_id: 1, handle: 'h' });
vi.mock('../lib/product-upsert.js', () => ({
  upsertProductFromShopify: (...args) => upsertProductFromShopifyMock(...args),
}));

let selectSingleMock;
const updateMock = vi.fn();
const deleteMock = vi.fn();

const fromMock = vi.fn((table) => {
  if (table === 'products') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: (...args) => selectSingleMock(...args),
        })),
      })),
      update: vi.fn((patch) => {
        updateMock(patch);
        const chain = {
          eq: vi.fn(() => chain),
          then: (resolve, reject) => Promise.resolve(updateMock.mock.results.at(-1)?.value ?? { error: null }).then(resolve, reject),
        };
        return chain;
      }),
      delete: vi.fn((...args) => {
        deleteMock(...args);
        return { eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) };
      }),
    };
  }
  return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) })) };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fromMock }) }));

describe('lib/shopify-webhook-handlers.js', () => {
  let handleProductCreate, handleProductUpdate, handleProductDelete;

  beforeEach(async () => {
    vi.resetModules();
    upsertProductFromShopifyMock.mockClear().mockResolvedValue({ shopify_id: 1, handle: 'h' });
    updateMock.mockClear();
    deleteMock.mockClear();
    selectSingleMock = vi.fn(async () => ({ data: { id: 'db-p1' }, error: null }));
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/shopify-webhook-handlers.js');
    ({ handleProductCreate, handleProductUpdate, handleProductDelete } = mod);
  });

  describe('handleProductCreate', () => {
    it('delegates to upsertProductFromShopify with (store.id, store.shopify_url, payload) — proves the webhook path never does its own separate tags write', async () => {
      const store = { id: 's1', shopify_url: 'x.myshopify.com' };
      const payload = { id: 555, title: 'New Product' };
      await handleProductCreate(store, payload);
      expect(upsertProductFromShopifyMock).toHaveBeenCalledWith('s1', 'x.myshopify.com', payload);
      // The handler itself performs no products.update/insert of its own — the only other
      // products-table call is the read-only id lookup below. Collection membership ('tags')
      // is a full-sync-only concern (lib/actions/sync.js), never touched from the webhook path.
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('returns action:"created" + resolves the DB product_id for the notification link', async () => {
      selectSingleMock.mockResolvedValue({ data: { id: 'db-p1' }, error: null });
      const result = await handleProductCreate({ id: 's1', shopify_url: 'x.myshopify.com' }, { id: 555, title: 'New Product' });
      expect(result).toEqual({ action: 'created', shopify_id: 555, title: 'New Product', product_id: 'db-p1' });
    });

    it('falls back to product_id: null (no crash) when the post-upsert id lookup finds no row', async () => {
      selectSingleMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
      const result = await handleProductCreate({ id: 's1', shopify_url: 'x.myshopify.com' }, { id: 999, title: 'X' });
      expect(result.product_id).toBeNull();
    });
  });

  describe('handleProductUpdate', () => {
    it('delegates to upsertProductFromShopify with (store.id, store.shopify_url, payload)', async () => {
      const store = { id: 's1', shopify_url: 'x.myshopify.com' };
      const payload = { id: 555, title: 'Updated Product' };
      await handleProductUpdate(store, payload);
      expect(upsertProductFromShopifyMock).toHaveBeenCalledWith('s1', 'x.myshopify.com', payload);
    });

    it('returns action:"updated" + resolves the DB product_id', async () => {
      selectSingleMock.mockResolvedValue({ data: { id: 'db-p2' }, error: null });
      const result = await handleProductUpdate({ id: 's1', shopify_url: 'x.myshopify.com' }, { id: 556, title: 'Updated Product' });
      expect(result).toEqual({ action: 'updated', shopify_id: 556, title: 'Updated Product', product_id: 'db-p2' });
    });
  });

  describe('handleProductDelete', () => {
    it('soft-archives — issues a products UPDATE (status=archived), never a DELETE', async () => {
      const store = { id: 's1' };
      const payload = { id: 777 };
      const result = await handleProductDelete(store, payload);
      expect(updateMock).toHaveBeenCalledTimes(1);
      const patch = updateMock.mock.calls[0][0];
      expect(patch.status).toBe('archived');
      expect(deleteMock).not.toHaveBeenCalled();
      expect(result).toEqual({ action: 'archived', shopify_id: 777 });
    });

    it('the archive UPDATE writes only status + synced_at — no tags field (webhook has no collection data)', async () => {
      await handleProductDelete({ id: 's1' }, { id: 778 });
      const patch = updateMock.mock.calls[0][0];
      expect(Object.keys(patch).sort()).toEqual(['status', 'synced_at']);
    });

    it('throws a descriptive error when the archive UPDATE fails at the DB layer', async () => {
      fromMock.mockImplementationOnce((table) => {
        if (table === 'products') {
          return {
            update: vi.fn(() => {
              const chain = {
                eq: vi.fn(() => chain),
                then: (resolve, reject) => Promise.resolve({ error: { message: 'db unreachable' } }).then(resolve, reject),
              };
              return chain;
            }),
            delete: deleteMock,
          };
        }
        return {};
      });
      await expect(handleProductDelete({ id: 's1' }, { id: 779 })).rejects.toThrow('archive failed: db unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // "Missing store" guard (P1-23 follow-up, AUDIT-2026-08 sweep). The sole
  // caller (api/webhooks/shopify.js) already rejects requests with no
  // matching store row before invoking any handler, but each handler now
  // also asserts explicitly at its own entry point — defense-in-depth so a
  // future caller that skips the pre-check gets a clear, attributable Error
  // instead of an opaque TypeError from deep inside upsertProductFromShopify
  // or the Supabase query builder.
  // -------------------------------------------------------------------------
  describe('missing store (explicit guard at handler entry)', () => {
    it('handleProductCreate throws "missing store" when store is null', async () => {
      await expect(handleProductCreate(null, { id: 1, title: 'X' }))
        .rejects.toThrow(/missing store/i);
    });

    it('handleProductUpdate throws "missing store" when store is undefined', async () => {
      await expect(handleProductUpdate(undefined, { id: 1, title: 'X' }))
        .rejects.toThrow(/missing store/i);
    });

    it('handleProductDelete throws "missing store" when store is null', async () => {
      await expect(handleProductDelete(null, { id: 1 }))
        .rejects.toThrow(/missing store/i);
    });
  });
});

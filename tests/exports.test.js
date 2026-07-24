import { describe, it, expect, vi, beforeEach } from 'vitest';

const productsRows = { rows: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: productsRows.rows, error: null })),
      };
      return chain;
    },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const ADMIN_USER = { role: 'admin', permissions: [], store_access: [] };

function mockReqRes(body, user = ADMIN_USER) {
  const headers = {};
  const req = { body, headers: {}, user };
  const res = {
    _status: 200,
    _body: null,
    _headers: headers,
    status: vi.fn(function (c) { this._status = c; return this; }),
    setHeader: vi.fn(function (k, v) { headers[k.toLowerCase()] = v; return this; }),
    send: vi.fn(function (b) { this._body = b; return this; }),
    end: vi.fn(function (b) { this._body = b; return this; }),
    json: vi.fn(function (o) { this._body = o; return this; }),
  };
  return { req, res, headers };
}

describe('export_products_csv', () => {
  let export_products_csv;

  beforeEach(async () => {
    vi.resetModules();
    productsRows.rows = [];
    getStoreMock.mockReset();
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const mod = await import('../lib/actions/exports.js');
    export_products_csv = mod.export_products_csv;
  });

  it('400s when store_id missing', async () => {
    const { req, res } = mockReqRes({});
    await export_products_csv(req, res);
    expect(res._status).toBe(400);
  });

  it('returns CSV with header only when 0 rows (never 404)', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com', shopify_handle: 'isola' });
    productsRows.rows = [];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['content-type']).toContain('text/csv');
    // Body starts with UTF-8 BOM + header row
    expect(res._body.startsWith('﻿title,admin_url,visibility')).toBe(true);
    // Only header (+ trailing newline)
    expect(res._body.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('maps visibility correctly from status + publication_online_store', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com', shopify_handle: 'isola' });
    productsRows.rows = [
      { title: 'A', shopify_id: 111, status: 'archived', publication_online_store: true },
      { title: 'B', shopify_id: 222, status: 'draft', publication_online_store: true },
      { title: 'C', shopify_id: 333, status: 'active', publication_online_store: false },
      { title: 'D', shopify_id: 444, status: 'active', publication_online_store: true },
      { title: 'E', shopify_id: 555, status: 'active', publication_online_store: null },
    ];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const lines = res._body.split('\n');
    const AB = 'https://admin.shopify.com/store/isola/products';
    expect(lines[1]).toBe(`A,${AB}/111,archived`);
    expect(lines[2]).toBe(`B,${AB}/222,draft`);
    expect(lines[3]).toBe(`C,${AB}/333,unlisted`);
    expect(lines[4]).toBe(`D,${AB}/444,listed`);
    // null publication_online_store on active → listed (legacy default)
    expect(lines[5]).toBe(`E,${AB}/555,listed`);
  });

  it('RFC 4180-escapes titles with quotes, commas, and newlines', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com', shopify_handle: 'isola' });
    productsRows.rows = [
      { title: 'Say "hi"', shopify_id: 1, status: 'active', publication_online_store: true },
      { title: 'Red, White & Blue', shopify_id: 2, status: 'active', publication_online_store: true },
      { title: 'Multi\nline', shopify_id: 3, status: 'active', publication_online_store: true },
    ];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const lines = res._body.split(/\r?\n/);
    const AB = 'https://admin.shopify.com/store/isola/products';
    expect(lines[1]).toBe(`"Say ""hi""",${AB}/1,listed`);
    expect(lines[2]).toBe(`"Red, White & Blue",${AB}/2,listed`);
    // Newline inside a quoted field — line split will not cleanly separate; assert it's quoted
    expect(res._body).toContain('"Multi\nline"');
  });

  it('falls back to shopify_url subdomain admin URL when shopify_handle missing', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'xsmcwa-i9.myshopify.com' });
    productsRows.rows = [
      { title: 'A', shopify_id: 999, status: 'active', publication_online_store: true },
    ];
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const lines = res._body.split('\n');
    expect(lines[1]).toBe('A,https://xsmcwa-i9.myshopify.com/admin/products/999,listed');
  });

  it('sets Content-Disposition filename with store slug + today date', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const { req, res } = mockReqRes({ store_id: 's1' });
    await export_products_csv(req, res);
    const cd = res._headers['content-disposition'];
    expect(cd).toMatch(/attachment; filename="products-isola-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it('403s without products:publications', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const user = { role: 'member', permissions: ['products:read'], store_access: ['s1'] };
    const { req, res } = mockReqRes({ store_id: 's1' }, user);
    await export_products_csv(req, res);
    expect(res._status).toBe(403);
  });

  it('403s when store not in store_access', async () => {
    getStoreMock.mockResolvedValue({ id: 's1', slug: 'isola', shopify_url: 'isola.myshopify.com' });
    const user = { role: 'member', permissions: ['products:publications'], store_access: ['s2'] };
    const { req, res } = mockReqRes({ store_id: 's1' }, user);
    await export_products_csv(req, res);
    expect(res._status).toBe(403);
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  findSizeOptionValues, parseChartFields, slugifyHandle, fetchSizeChartMetaobjects,
  getSizeChartById, upsertSizeChartByHandle, updateSizeChartById, scanProductsSizeCharts,
  setProductsSizeChart, removeProductsSizeChart, ShopifyUserError, METAFIELDS_BATCH_SIZE,
} from '../lib/size-chart-shopify.js';

describe('findSizeOptionValues', () => {
  it('finds an option named "Größe"', () => {
    expect(findSizeOptionValues([{ name: 'Farbe', values: ['Rot'] }, { name: 'Größe', values: ['S', 'M'] }])).toEqual(['S', 'M']);
  });

  it('finds an option named "Size" (English)', () => {
    expect(findSizeOptionValues([{ name: 'Size', values: ['S', 'M'] }])).toEqual(['S', 'M']);
  });

  it('returns null when no size-like option exists', () => {
    expect(findSizeOptionValues([{ name: 'Color', values: ['Red'] }])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(findSizeOptionValues(null)).toBeNull();
    expect(findSizeOptionValues(undefined)).toBeNull();
  });

  it('supports the optionValues shape (newer GraphQL option field)', () => {
    expect(findSizeOptionValues([{ name: 'Größe', optionValues: [{ name: 'S' }, { name: 'M' }] }])).toEqual(['S', 'M']);
  });
});

describe('parseChartFields', () => {
  it('parses columns/rows JSON strings into arrays', () => {
    const out = parseChartFields([
      { key: 'name', value: 'Damen Hosen' },
      { key: 'columns', value: '["Größe","Taille"]' },
      { key: 'rows', value: '[["S","64"],["M","68"]]' },
      { key: 'note', value: 'Note text' },
      { key: 'unit', value: 'cm' },
    ]);
    expect(out).toEqual({
      name: 'Damen Hosen', columns: ['Größe', 'Taille'], rows: [['S', '64'], ['M', '68']],
      note: 'Note text', unit: 'cm',
    });
  });

  it('defaults unit to cm and columns/rows to [] on missing or malformed JSON', () => {
    const out = parseChartFields([{ key: 'name', value: 'Broken' }, { key: 'columns', value: 'not json' }]);
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.unit).toBe('cm');
  });
});

describe('slugifyHandle', () => {
  it('transliterates German umlauts and lowercases', () => {
    expect(slugifyHandle('Damen Oberteile')).toBe('damen-oberteile');
    expect(slugifyHandle('Größe & Ärmel')).toBe('groesse-aermel');
  });

  it('falls back to "chart" for an empty/unusable name', () => {
    expect(slugifyHandle('')).toBe('chart');
    expect(slugifyHandle('!!!')).toBe('chart');
  });
});

function mockClient() {
  return { graphql: vi.fn() };
}

describe('fetchSizeChartMetaobjects', () => {
  it('maps metaobject nodes into parsed chart objects', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({
      data: {
        metaobjects: {
          nodes: [{
            id: 'gid://shopify/Metaobject/1', handle: 'damen-hosen',
            capabilities: { publishable: { status: 'ACTIVE' } },
            fields: [{ key: 'name', value: 'Damen Hosen' }, { key: 'columns', value: '["Größe"]' }, { key: 'rows', value: '[["S"]]' }],
          }],
        },
      },
    });
    const charts = await fetchSizeChartMetaobjects(client);
    expect(charts).toEqual([{
      id: 'gid://shopify/Metaobject/1', handle: 'damen-hosen', status: 'ACTIVE',
      name: 'Damen Hosen', columns: ['Größe'], rows: [['S']], note: '', unit: 'cm',
    }]);
  });

  it('throws on top-level GraphQL errors', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({ errors: [{ message: 'boom' }] });
    await expect(fetchSizeChartMetaobjects(client)).rejects.toThrow(/boom/);
  });
});

describe('getSizeChartById', () => {
  it('returns null when the metaobject does not exist', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({ data: { metaobject: null } });
    expect(await getSizeChartById(client, 'gid://shopify/Metaobject/999')).toBeNull();
  });
});

describe('upsertSizeChartByHandle / updateSizeChartById', () => {
  it('sends capabilities.publishable ACTIVE and JSON-encoded columns/rows', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({
      data: { metaobjectUpsert: { metaobject: { id: 'gid://x/1', handle: 'h', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [] }, userErrors: [] } },
    });
    await upsertSizeChartByHandle(client, 'h', { name: 'N', columns: ['A'], rows: [['1']], note: '', unit: 'cm' });
    const [, variables] = client.graphql.mock.calls[0];
    expect(variables.metaobject.capabilities).toEqual({ publishable: { status: 'ACTIVE' } });
    const fields = Object.fromEntries(variables.metaobject.fields.map((f) => [f.key, f.value]));
    expect(fields.columns).toBe('["A"]');
    expect(fields.rows).toBe('[["1"]]');
  });

  it('throws ShopifyUserError with the raw userErrors on a rejected upsert', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({ data: { metaobjectUpsert: { metaobject: null, userErrors: [{ field: ['fields', '0', 'value'], message: 'bad value', code: 'INVALID' }] } } });
    await expect(upsertSizeChartByHandle(client, 'h', { name: 'N', columns: [], rows: [] }))
      .rejects.toBeInstanceOf(ShopifyUserError);
  });

  it('updateSizeChartById calls metaobjectUpdate with the given id', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({
      data: { metaobjectUpdate: { metaobject: { id: 'gid://x/1', handle: 'h', capabilities: { publishable: { status: 'ACTIVE' } }, fields: [] }, userErrors: [] } },
    });
    await updateSizeChartById(client, 'gid://x/1', { name: 'N', columns: ['A'], rows: [['1']] });
    const [query, variables] = client.graphql.mock.calls[0];
    expect(query).toContain('metaobjectUpdate');
    expect(variables.id).toBe('gid://x/1');
  });
});

describe('scanProductsSizeCharts', () => {
  it('paginates until hasNextPage is false and reports chart/legacy refs + size options', async () => {
    const client = mockClient();
    client.graphql
      .mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
            nodes: [{
              id: 'gid://shopify/Product/1', title: 'A', handle: 'a',
              options: [{ name: 'Größe', values: ['S', 'M'] }],
              chart: { value: 'gid://shopify/Metaobject/1' }, legacyText: null,
            }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              id: 'gid://shopify/Product/2', title: 'B', handle: 'b',
              options: [{ name: 'Color', values: ['Red'] }],
              chart: null, legacyText: { value: 'old csv text' },
            }],
          },
        },
      });
    const out = await scanProductsSizeCharts(client, { pageSize: 1 });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ numericId: '1', chartGid: 'gid://shopify/Metaobject/1', sizeOptionValues: ['S', 'M'], legacyText: null });
    expect(out[1]).toMatchObject({ numericId: '2', chartGid: null, sizeOptionValues: null, legacyText: 'old csv text' });
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(client.graphql.mock.calls[1][1]).toEqual({ first: 1, after: 'CUR1' });
  });
});

describe('setProductsSizeChart / removeProductsSizeChart — batch size', () => {
  it('splits 30 product gids into batches of at most 25', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({ data: { metafieldsSet: { metafields: [{ id: '1' }], userErrors: [] } } });
    const gids = Array.from({ length: 30 }, (_, i) => `gid://shopify/Product/${i}`);
    await setProductsSizeChart(client, gids, 'gid://shopify/Metaobject/1');
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(client.graphql.mock.calls[0][1].metafields).toHaveLength(METAFIELDS_BATCH_SIZE);
    expect(client.graphql.mock.calls[1][1].metafields).toHaveLength(5);
  });

  it('setProductsSizeChart collects both top-level errors and userErrors without throwing', async () => {
    const client = mockClient();
    client.graphql
      .mockResolvedValueOnce({ errors: [{ message: 'transport error' }] })
      .mockResolvedValueOnce({ data: { metafieldsSet: { metafields: [], userErrors: [{ message: 'rejected value' }] } } });
    const gids = Array.from({ length: 30 }, (_, i) => `gid://shopify/Product/${i}`);
    const { updated, errors } = await setProductsSizeChart(client, gids, 'gid://shopify/Metaobject/1');
    expect(updated).toBe(0);
    expect(errors).toEqual(['transport error', 'rejected value']);
  });

  it('removeProductsSizeChart batches metafieldsDelete at 25 too', async () => {
    const client = mockClient();
    client.graphql.mockResolvedValue({ data: { metafieldsDelete: { deletedMetafields: [{ key: 'size_chart' }], userErrors: [] } } });
    const gids = Array.from({ length: 26 }, (_, i) => `gid://shopify/Product/${i}`);
    await removeProductsSizeChart(client, gids);
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(client.graphql.mock.calls[0][1].metafields).toHaveLength(25);
    expect(client.graphql.mock.calls[1][1].metafields).toHaveLength(1);
  });
});

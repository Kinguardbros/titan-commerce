import { describe, it, expect } from 'vitest';
import { parseCollections, collectionOptions, productsInCollection } from '../apps/dashboard/src/lib/review-targets.js';

// products.tags holds collection titles, stored either as a JSON string (what sync writes)
// or as an array.

describe('parseCollections', () => {
  it('reads the JSON-string form sync writes', () => {
    expect(parseCollections('["Shop All","Camis & Tanks"]')).toEqual(['Shop All', 'Camis & Tanks']);
  });

  it('passes an array through', () => {
    expect(parseCollections(['Bikinis'])).toEqual(['Bikinis']);
  });

  it('treats empty, null and malformed values as no collections', () => {
    expect(parseCollections(null)).toEqual([]);
    expect(parseCollections('')).toEqual([]);
    expect(parseCollections('not json')).toEqual([]);
  });
});

describe('collectionOptions', () => {
  it("lists the product's collections without the catch-all Shop All", () => {
    expect(collectionOptions({ tags: '["Shop All","Camis & Tanks","Tummy Control"]' }))
      .toEqual(['Camis & Tanks', 'Tummy Control']);
  });

  it('is empty for a product in no collection', () => {
    expect(collectionOptions({ tags: null })).toEqual([]);
  });
});

describe('productsInCollection', () => {
  const products = [
    { id: 'a', title: 'Soft Tank', status: 'active', tags: '["Shop All","Camis & Tanks"]' },
    { id: 'b', title: 'Lace Cami', status: null, tags: ['Camis & Tanks'] },
    { id: 'c', title: 'Old Cami', status: 'archived', tags: '["Camis & Tanks"]' },
    { id: 'd', title: 'Bikini', status: 'active', tags: '["Bikinis"]' },
  ];

  it('returns the live products of that collection', () => {
    expect(productsInCollection(products, 'Camis & Tanks').map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for an unknown collection', () => {
    expect(productsInCollection(products, 'Nope')).toEqual([]);
  });
});

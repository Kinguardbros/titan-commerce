// Target selection for the Reviews "Collection" import: which collections a product is in,
// and which products share one. products.tags holds the collection titles (set by full sync),
// stored as a JSON string or an array.

// Every product is in this catch-all, so offering it would mean "the whole store".
const CATCH_ALL = 'Shop All';

export function parseCollections(tags) {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[review-targets] unreadable product tags:', { tags, message: err.message });
    return [];
  }
}

export function collectionOptions(product) {
  return parseCollections(product?.tags).filter((c) => c !== CATCH_ALL);
}

export function productsInCollection(products, collection) {
  return (products || []).filter((p) => p.status !== 'archived' && parseCollections(p.tags).includes(collection));
}

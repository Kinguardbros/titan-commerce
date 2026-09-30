import { useState, useEffect, useMemo } from 'react';
import { getAllProductsPaged } from '../lib/api';
import { collectionOptions, productsInCollection } from '../lib/review-targets';
import { SkeletonRow } from './Skeleton';
import './ReviewTargetPicker.css';

// "Collection" mode of the reviews import: choose one of the current product's collections,
// then the products in it that get a copy of every imported review. The current product is
// always included (the backend adds it regardless). Selection = array of product ids.
export default function ReviewTargetPicker({ storeId, productId, selected, onChange }) {
  const [products, setProducts] = useState(null); // null while loading
  const [loadError, setLoadError] = useState('');
  const [chosen, setChosen] = useState(''); // '' = the product's first collection

  useEffect(() => {
    let alive = true;
    getAllProductsPaged(storeId)
      .then((list) => {
        if (!alive) return;
        setProducts(list);
        // Start with every product of the first collection selected.
        const first = collectionOptions(list.find((p) => p.id === productId))[0];
        if (first) onChange(productsInCollection(list, first).map((p) => p.id));
      })
      .catch((err) => {
        console.error('[ReviewTargetPicker] product load failed:', err);
        if (alive) setLoadError(err.message);
      });
    return () => { alive = false; };
  }, [storeId, productId, onChange]);

  const current = useMemo(() => (products || []).find((p) => p.id === productId), [products, productId]);
  const options = useMemo(() => collectionOptions(current), [current]);
  const collection = chosen || options[0] || '';
  const members = useMemo(
    () => (collection ? productsInCollection(products, collection) : []),
    [products, collection],
  );

  // A newly chosen collection starts with every product in it selected.
  const pickCollection = (c) => {
    setChosen(c);
    onChange(productsInCollection(products, c).map((p) => p.id));
  };

  const toggle = (id) => {
    if (id === productId) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  if (loadError) return <div className="rv-target-note">Could not load products: {loadError}</div>;
  if (!products) return <div className="rv-target"><SkeletonRow /><SkeletonRow /></div>;
  if (!options.length) {
    return <div className="rv-target-note">This product is not in any collection yet. Run a Shopify sync on the Products tab first.</div>;
  }

  return (
    <div className="rv-target">
      <label className="rv-field-label" htmlFor="rv-target-collection">Collection</label>
      <select id="rv-target-collection" className="rv-input" value={collection}
        onChange={(e) => pickCollection(e.target.value)}>
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <div className="rv-import-meta">
        <span>{selected.length} of {members.length} products selected</span>
        <span className="rv-target-bulk">
          <button type="button" onClick={() => onChange(members.map((p) => p.id))}>All</button>
          <button type="button" onClick={() => onChange([productId])}>Only this one</button>
        </span>
      </div>

      <ul className="rv-target-list">
        {members.map((p) => (
          <li key={p.id}>
            <label className={p.id === productId ? 'rv-target-current' : ''}>
              <input type="checkbox" checked={selected.includes(p.id)} disabled={p.id === productId}
                onChange={() => toggle(p.id)} />
              <span>{p.title}</span>
              {p.id === productId && <em>this product</em>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

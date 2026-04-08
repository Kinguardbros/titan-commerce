import { useState, useEffect, useCallback, useMemo } from 'react';
import { getProducts, syncProducts } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './Products.css';

const PRICE_RANGES = [
  { key: 'all', label: 'All prices' },
  { key: '0-30', label: 'Under $30', min: 0, max: 30 },
  { key: '30-50', label: '$30–50', min: 30, max: 50 },
  { key: '50-100', label: '$50–100', min: 50, max: 100 },
  { key: '100+', label: '$100+', min: 100, max: Infinity },
];

const SORT_OPTIONS = [
  { key: 'name_asc', label: 'A → Z' },
  { key: 'name_desc', label: 'Z → A' },
  { key: 'price_asc', label: 'Price: Low → High' },
  { key: 'price_desc', label: 'Price: High → Low' },
  { key: 'creatives_desc', label: 'Most creatives' },
];

export default function Products({ onSelectProduct, onNavigateToStudio, storeId }) {
  const toast = useToast();
  const [allProducts, setAllProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [priceFilter, setPriceFilter] = useState('all');
  const [creativesFilter, setCreativesFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('products_view') || 'list');

  const fetchProducts = useCallback(async () => {
    try {
      const data = await getProducts(storeId);
      if (data) setAllProducts(data);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Extract unique collections from product tags
  const collections = useMemo(() => {
    const set = new Set();
    allProducts.forEach((p) => {
      const tags = typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []);
      tags.forEach((t) => set.add(t));
    });
    return ['all', ...Array.from(set).sort()];
  }, [allProducts]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let list = allProducts;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || p.handle?.includes(q));
    }

    if (collectionFilter !== 'all') {
      list = list.filter((p) => {
        const tags = typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []);
        return tags.includes(collectionFilter);
      });
    }

    if (priceFilter !== 'all') {
      const range = PRICE_RANGES.find((r) => r.key === priceFilter);
      if (range) {
        list = list.filter((p) => {
          const price = parseFloat(p.price);
          return !isNaN(price) && price >= range.min && price < range.max;
        });
      }
    }

    if (creativesFilter === 'has') {
      list = list.filter((p) => p.creative_count > 0);
    } else if (creativesFilter === 'none') {
      list = list.filter((p) => !p.creative_count);
    }

    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name_asc': return a.title.localeCompare(b.title);
        case 'name_desc': return b.title.localeCompare(a.title);
        case 'price_asc': return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
        case 'price_desc': return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
        case 'creatives_desc': return (b.creative_count || 0) - (a.creative_count || 0);
        default: return 0;
      }
    });

    return list;
  }, [allProducts, search, collectionFilter, priceFilter, creativesFilter, sortBy]);

  const handleSync = async () => {
    setSyncing(true);
    toast.info('Syncing products from Shopify...');
    try {
      const result = await syncProducts(storeId);
      await fetchProducts();
      toast.success(`${result?.synced || 'All'} products synced!`);
    } catch (err) {
      console.error('Sync failed:', err);
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div>
          <div className="products-title">Products</div>
          <div className="products-subtitle">{filtered.length} of {allProducts.length} products</div>
        </div>
        <div className="products-actions">
          <div className="products-view-toggle">
            {['grid', 'list', 'cards'].map((v) => (
              <button key={v} className={`products-view-btn${viewMode === v ? ' products-view-btn--active' : ''}`}
                onClick={() => { setViewMode(v); localStorage.setItem('products_view', v); }}>
                {v === 'grid' ? '▤' : v === 'list' ? '≡' : '▦'}
              </button>
            ))}
          </div>
          <input className="products-search" type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="products-sync-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Shopify'}
          </button>
        </div>
      </div>

      <div className="pf-bar">
        <div className="pf-group">
          <div className="pf-label">Collection</div>
          <div className="pf-chips">
            {collections.map((c) => (
              <button
                key={c}
                className={`pf-chip${collectionFilter === c ? ' pf-chip--active' : ''}`}
                onClick={() => setCollectionFilter(c)}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-group">
          <div className="pf-label">Price</div>
          <div className="pf-chips">
            {PRICE_RANGES.map((r) => (
              <button
                key={r.key}
                className={`pf-chip${priceFilter === r.key ? ' pf-chip--active' : ''}`}
                onClick={() => setPriceFilter(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-group">
          <div className="pf-label">Creatives</div>
          <div className="pf-chips">
            {[
              { key: 'all', label: 'All' },
              { key: 'has', label: 'Has creatives' },
              { key: 'none', label: 'No creatives' },
            ].map((o) => (
              <button
                key={o.key}
                className={`pf-chip${creativesFilter === o.key ? ' pf-chip--active' : ''}`}
                onClick={() => setCreativesFilter(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-group">
          <div className="pf-label">Sort</div>
          <select className="pf-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="products-loading">Loading products...</div>
      ) : filtered.length === 0 ? (
        <div className="products-empty">
          <div className="products-empty-text">No products match filters</div>
        </div>
      ) : (
        <>
          {viewMode === 'grid' && (
            <div className="products-grid">
              {filtered.map((p) => (
                <div key={p.id} className="product-card" onClick={() => onSelectProduct(p)}>
                  <div className="product-card-img" style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'var(--bg-surface)' }}>
                    {!p.image_url && <span className="product-card-no-img">No image</span>}
                    {p.creative_count > 0 && <span className="product-card-badge">{p.creative_count} creatives</span>}
                  </div>
                  <div className="product-card-body">
                    <div className="product-card-title">{p.title}</div>
                    <div className="product-card-meta">{p.price && <span className="product-card-price">${p.price}</span>}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'list' && (
            <div className="products-table-wrap">
              <table className="products-table">
                <thead><tr><th></th><th>Product</th><th>Price</th><th>Creatives</th><th>COGS</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} onClick={() => onSelectProduct(p)}>
                      <td><div className="products-table-img" style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}} /></td>
                      <td className="products-table-name">{p.title}</td>
                      <td>${p.price || '—'}</td>
                      <td>{p.creative_count > 0 ? <span style={{ color: 'var(--accent-success)' }}>{p.creative_count}</span> : <span style={{ color: 'var(--accent-danger)' }}>0 ⚠</span>}</td>
                      <td>{p.cogs ? `$${p.cogs}` : '—'}</td>
                      <td><button className="products-studio-link" onClick={(e) => { e.stopPropagation(); onNavigateToStudio(p.id); }}>Studio →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === 'cards' && (
            <div className="products-cards">
              {filtered.map((p) => (
                <div key={p.id} className="products-card-row" onClick={() => onSelectProduct(p)}>
                  <div className="products-card-img" style={p.image_url ? { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}} />
                  <div className="products-card-info">
                    <div className="products-card-name">{p.title}</div>
                    <div className="products-card-meta">{p.product_type} {p.price ? `· $${p.price}` : ''} {p.cogs ? `· COGS: $${p.cogs}` : ''}</div>
                  </div>
                  <div className="products-card-stats">
                    <span>{p.creative_count || 0} 🎨</span>
                  </div>
                  <div className="products-card-actions">
                    <button className="products-studio-link" onClick={(e) => { e.stopPropagation(); onNavigateToStudio(p.id); }}>Studio →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

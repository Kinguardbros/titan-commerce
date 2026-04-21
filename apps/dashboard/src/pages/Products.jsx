import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { getProducts, getAllProducts, syncProducts, refreshSizeCharts } from '../lib/api';
import { SkeletonGrid } from '../components/Skeleton';
import { useToast } from '../hooks/useToast.jsx';
import './Products.css';

const ImportModal = lazy(() => import('../components/ImportModal'));

function formatTimeAgo(date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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

const PAGE_SIZE = 50;
const TWO_HOURS = 2 * 60 * 60 * 1000;
const isNew = (p) => p.created_at && (Date.now() - new Date(p.created_at).getTime()) < TWO_HOURS;

export default function Products({ onSelectProduct, onNavigateToStudio, storeId }) {
  const toast = useToast();
  const [showImport, setShowImport] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshingSC, setRefreshingSC] = useState(false);
  const [lastSynced, setLastSynced] = useState(() => {
    const ts = localStorage.getItem(`last_synced_${storeId}`);
    return ts ? new Date(ts) : null;
  });
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [priceFilter, setPriceFilter] = useState('all');
  const [creativesFilter, setCreativesFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('products_view') || 'list');
  const [totalProducts, setTotalProducts] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const fetchProducts = useCallback(async (page = 1, append = false) => {
    try {
      const result = await getProducts(storeId, { page, limit: PAGE_SIZE });
      if (result) {
        setAllProducts((prev) => append ? [...prev, ...result.products] : result.products);
        setTotalProducts(result.total);
        setCurrentPage(result.page);
        setHasMore(result.page < result.pages);
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [storeId]);

  useEffect(() => { setAllProducts([]); setCurrentPage(1); setLoading(true); fetchProducts(1); }, [fetchProducts]);

  // When searching, load all products so we search the full catalog (not just page 1)
  useEffect(() => {
    if (search && search.length >= 2 && hasMore) {
      getAllProducts(storeId).then((products) => {
        if (products?.length) { setAllProducts(products); setHasMore(false); setTotalProducts(products.length); }
      }).catch(() => {});
    }
  }, [search, storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchProducts(currentPage + 1, true);
  };

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
      const q = search.toLowerCase().trim();
      // Split search into words for flexible matching — "Flowy Tankini" matches "Tie Knot Flowy Tankini Set"
      const words = q.split(/\s+/).filter(Boolean);
      list = list.filter((p) => {
        const title = p.title.toLowerCase();
        const handle = (p.handle || '').toLowerCase();
        return words.every((w) => title.includes(w) || handle.includes(w));
      });
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
      const now = new Date();
      localStorage.setItem(`last_synced_${storeId}`, now.toISOString());
      setLastSynced(now);
      toast.success(`${result?.synced || 'All'} products synced!`);
    } catch (err) {
      console.error('Sync failed:', err);
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshSizeCharts = async () => {
    setRefreshingSC(true);
    toast.info('Checking size charts...');
    try {
      const result = await refreshSizeCharts(storeId);
      await fetchProducts();
      toast.success(`${result.with_size_chart} of ${result.total} products have size charts`);
    } catch (err) {
      console.error('[Products] Refresh size charts failed:', { error: err.message });
      toast.error(`Failed: ${err.message}`);
    } finally {
      setRefreshingSC(false);
    }
  };

  return (
    <div className="products-page">
      <div className="products-header">
        <div>
          <div className="products-title">Products</div>
          <div className="products-subtitle">{filtered.length} of {totalProducts} products{hasMore ? ` (${allProducts.length} loaded)` : ''}</div>
        </div>
        <div className="products-actions">
          <div className="products-view-toggle">
            {['grid', 'list', 'cards'].map((v) => (
              <button key={v} className={`products-view-btn${viewMode === v ? ' products-view-btn--active' : ''}`}
                aria-label={`Switch to ${v} view`} aria-pressed={viewMode === v}
                onClick={() => { setViewMode(v); localStorage.setItem('products_view', v); }}>
                {v === 'grid' ? '▤' : v === 'list' ? '≡' : '▦'}
              </button>
            ))}
          </div>
          <input className="products-search" type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products by name" />
          <button className="products-import-btn" onClick={() => setShowImport(true)}>
            Import
          </button>
          <button className="products-sync-btn" onClick={handleRefreshSizeCharts} disabled={refreshingSC} title="Check Shopify for size chart metafields">
            {refreshingSC ? 'Checking...' : '📏 Size Charts'}
          </button>
          <button className="products-sync-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Shopify'}
          </button>
          <span className="products-sync-ts">{lastSynced ? `Synced ${formatTimeAgo(lastSynced)}` : 'Never synced'}</span>
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
        <SkeletonGrid count={8} />
      ) : filtered.length === 0 ? (
        <div className="products-empty">
          <div className="products-empty-icon">📦</div>
          <div className="products-empty-title">{search || collectionFilter !== 'all' || priceFilter !== 'all' || creativesFilter !== 'all' ? 'No products match filters' : 'No products yet'}</div>
          <div className="products-empty-desc">{search || collectionFilter !== 'all' || priceFilter !== 'all' || creativesFilter !== 'all' ? 'Try adjusting your filters or search query.' : 'Sync your Shopify products to get started.'}</div>
          {!(search || collectionFilter !== 'all' || priceFilter !== 'all' || creativesFilter !== 'all') && (
            <button className="products-empty-cta" onClick={handleSync} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync Shopify →'}</button>
          )}
        </div>
      ) : (
        <>
          {viewMode === 'grid' && (
            <div className="products-grid">
              {filtered.map((p) => (
                <div key={p.id} className="product-card" onClick={() => onSelectProduct(p)}>
                  <div className="product-card-img">
                    {p.image_url ? <img src={p.image_url} alt={p.title} loading="lazy" className="products-lazy-img" /> : <span className="product-card-no-img">No image</span>}
                    {isNew(p) && <span className="product-card-badge product-card-badge--new">New</span>}
                    {p.creative_count > 0 && <span className="product-card-badge">{p.creative_count} creatives</span>}
                  </div>
                  <div className="product-card-body">
                    <div className="product-card-title">{p.title}</div>
                    <div className="product-card-meta">
                      {p.price && <span className="product-card-price">${p.price}</span>}
                      {!p.has_size_chart && <span style={{ color: 'var(--accent-secondary)', fontSize: 10, marginLeft: 6 }} title="Missing size chart">⚠ Size</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'list' && (
            <div className="products-table-wrap">
              <table className="products-table">
                <thead><tr><th></th><th>Product</th><th>Price</th><th>Creatives</th><th>Size</th><th>COGS</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} onClick={() => onSelectProduct(p)}>
                      <td><div className="products-table-img">{p.image_url && <img src={p.image_url} alt={p.title} loading="lazy" className="products-lazy-img" />}</div></td>
                      <td className="products-table-name">{p.title}{isNew(p) && <span className="pill" style={{ marginLeft: 6, background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)', fontSize: 9, padding: '2px 6px' }}>New</span>}</td>
                      <td>${p.price || '—'}</td>
                      <td>{p.creative_count > 0 ? <span style={{ color: 'var(--accent-success)' }}>{p.creative_count}</span> : <span style={{ color: 'var(--accent-danger)' }}>0 ⚠</span>}</td>
                      <td>{p.has_size_chart ? <span style={{ color: 'var(--accent-success)' }}>✓</span> : <span style={{ color: 'var(--accent-secondary)' }}>⚠</span>}</td>
                      <td>{p.cogs ? `$${p.cogs}` : '—'}</td>
                      <td><button className="products-studio-link" aria-label={`Open ${p.title} in Studio`} onClick={(e) => { e.stopPropagation(); onNavigateToStudio(p.id); }}>Studio →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === 'cards' && (
            <div className="products-cards">
              {filtered.map((p) => (
                <div key={p.id} className="products-card-row" role="button" tabIndex={0} aria-label={`Open ${p.title}`} onClick={() => onSelectProduct(p)} onKeyDown={(e) => { if (e.key === 'Enter') onSelectProduct(p); }}>
                  <div className="products-card-img">
                    {p.image_url ? <img src={p.image_url} alt={p.title} loading="lazy" className="products-lazy-img" /> : null}
                  </div>
                  <div className="products-card-info">
                    <div className="products-card-name">{p.title}{isNew(p) && <span className="pill" style={{ marginLeft: 6, background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)', fontSize: 9, padding: '2px 6px' }}>New</span>}</div>
                    <div className="products-card-meta">{p.product_type} {p.price ? `· $${p.price}` : ''} {p.cogs ? `· COGS: $${p.cogs}` : ''}</div>
                  </div>
                  <div className="products-card-stats">
                    <span>{p.creative_count || 0} 🎨</span>
                    <span>{p.has_size_chart ? <span style={{ color: 'var(--accent-success)' }}>✓ Size</span> : <span style={{ color: 'var(--accent-secondary)' }}>⚠ Size</span>}</span>
                  </div>
                  <div className="products-card-actions">
                    <button className="products-studio-link" aria-label={`Open ${p.title} in Studio`} onClick={(e) => { e.stopPropagation(); onNavigateToStudio(p.id); }}>Studio →</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="products-load-more">
              <button className="products-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : `Load more (${allProducts.length} of ${totalProducts})`}
              </button>
            </div>
          )}
        </>
      )}

      {showImport && (
        <Suspense fallback={null}>
          <ImportModal
            storeId={storeId}
            onClose={() => setShowImport(false)}
            onImported={() => { setShowImport(false); fetchProducts(1); }}
          />
        </Suspense>
      )}
    </div>
  );
}

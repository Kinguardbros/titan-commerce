import { useState, useEffect } from 'react';
import ShopifyDashboard from '../components/ShopifyDashboard';
import ShopifyServices from '../components/ShopifyServices';
import { getAllProducts, bulkUpdatePrices } from '../lib/api';
import DocsBrowser from '../components/DocsBrowser';
import BrandKnowledge from '../components/BrandKnowledge';
import { useToast } from '../hooks/useToast.jsx';
import './Shopify.css';

const SUB_TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'pricing', label: 'Pricing' },
];

export default function Shopify({ onNavigateToProduct, storeId, store }) {
  const toast = useToast();
  const hasAdmin = !!(store?.has_admin || store?.admin_token);
  const [subTab, setSubTab] = useState('dashboard');

  // Pricing state
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState(['all']);
  const [selected, setSelected] = useState(new Set());
  const [newPrice, setNewPrice] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Load products for pricing tab
  useEffect(() => {
    if (storeId && hasAdmin && subTab === 'pricing') {
      getAllProducts(storeId).then((prods) => {
        setProducts(prods || []);
        const colSet = new Set();
        for (const p of prods || []) {
          const tags = typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []);
          tags.forEach((t) => colSet.add(t));
        }
        setCollections(['all', ...Array.from(colSet).sort()]);
      }).catch(() => {});
    }
  }, [storeId, hasAdmin, subTab]);

  const toggleSelect = (id) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const filteredProducts = products.filter((p) => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (collectionFilter !== 'all') {
      const tags = typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []);
      if (!tags.includes(collectionFilter)) return false;
    }
    return true;
  });

  const handleApplyPrice = async () => {
    if (!newPrice || selected.size === 0) return;
    setPriceLoading(true);
    toast.info(`Updating prices for ${selected.size} products...`);
    try {
      const result = await bulkUpdatePrices(storeId, Array.from(selected), newPrice);
      toast.success(`Updated ${result.variants_updated} variants to $${newPrice}`);
      setSelected(new Set()); setNewPrice('');
      getAllProducts(storeId).then(setProducts).catch(() => {});
    } catch (err) { toast.error(`Price update failed: ${err.message}`); }
    finally { setPriceLoading(false); }
  };

  return (
    <div className="sh-page">
      <div className="sh-header">
        <div className="sh-title gradient-heading">Shopify</div>
        <div className="sh-sub-tabs">
          {SUB_TABS.map((t) => (
            <button key={t.key} className={`sh-sub-tab${subTab === t.key ? ' sh-sub-tab--active' : ''}`}
              onClick={() => setSubTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard */}
      {subTab === 'dashboard' && (
        <>
          <ShopifyDashboard storeId={storeId} store={store} onNavigateToProduct={onNavigateToProduct} />
          <div style={{ marginTop: 24 }}>
            <div className="sh-title gradient-heading" style={{ fontSize: 11, marginBottom: 12 }}>Services</div>
            <ShopifyServices onSwitchTab={(action) => {
              if (action === 'pricing') setSubTab('pricing');
              else if (action === 'knowledge') setSubTab('knowledge');
            }} />
          </div>
        </>
      )}

      {/* Knowledge */}
      {subTab === 'knowledge' && (
        <div className="sh-knowledge">
          <BrandKnowledge storeId={storeId} storeName={store?.name} />
          {store?.name && <DocsBrowser storeName={store.name} storeId={storeId} />}
        </div>
      )}

      {/* Pricing */}
      {subTab === 'pricing' && hasAdmin && (
        <div className="sh-pricing-section">
          <div className="sh-pricing-controls">
            <select className="sh-pricing-select" value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)}>
              {collections.map((c) => <option key={c} value={c}>{c === 'all' ? 'All Collections' : c}</option>)}
            </select>
            <input className="sh-pricing-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." />
            <div className="sh-pricing-action">
              <span className="sh-pricing-selected">{selected.size} selected</span>
              <input className="sh-pricing-input" type="number" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="New price" />
              <button className="sh-pricing-apply" onClick={handleApplyPrice} disabled={priceLoading || !newPrice || selected.size === 0}>
                {priceLoading ? 'Updating...' : `Apply to ${selected.size}`}
              </button>
            </div>
          </div>

          <div className="sh-pricing-table-wrap">
            <table className="sh-pricing-table">
              <thead><tr>
                <th><input type="checkbox" checked={selected.size === filteredProducts.length && filteredProducts.length > 0} onChange={() => { if (selected.size === filteredProducts.length) setSelected(new Set()); else setSelected(new Set(filteredProducts.map((p) => p.shopify_id))); }} /></th>
                <th>Product</th><th>Price</th>
              </tr></thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <tr key={p.id} className={selected.has(p.shopify_id) ? 'sh-pricing-row--selected' : ''}>
                    <td><input type="checkbox" checked={selected.has(p.shopify_id)} onChange={() => toggleSelect(p.shopify_id)} /></td>
                    <td className="sh-pricing-name">{p.title}</td>
                    <td>${p.price || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredProducts.length === 0 && <div className="sh-pricing-empty">No products match filters</div>}
          </div>
        </div>
      )}

      {subTab === 'pricing' && !hasAdmin && (
        <div className="sh-pricing-empty">Connect Shopify Admin to manage pricing</div>
      )}
    </div>
  );
}

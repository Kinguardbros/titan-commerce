import { useState, useEffect, useCallback } from 'react';
import { StoreProvider, useActiveStore } from './hooks/useActiveStore.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Shopify from './pages/Shopify';
import Products from './pages/Products';
import ProductWorkspace from './pages/ProductWorkspace';
import Studio from './pages/Studio';
import Profit from './pages/Profit';
import './App.css';

const TABS = ['Overview', 'Shopify', 'Studio', 'Products', 'Profit'];

function isTokenValid() {
  const token = localStorage.getItem('auth_token');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[0]));
    return payload.expires > Date.now();
  } catch { return false; }
}

function AppContent() {
  const { stores, activeStore, switchStore } = useActiveStore();
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [studioProductId, setStudioProductId] = useState(null);
  const [clock, setClock] = useState('');
  const [showStorePicker, setShowStorePicker] = useState(false);

  const storeId = activeStore?.id;

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setSelectedProduct(null); setStudioProductId(null); }, [storeId]);

  const handleSelectProduct = useCallback((p) => setSelectedProduct(p), []);
  const handleBackToProducts = useCallback(() => setSelectedProduct(null), []);
  const handleNavigateToProduct = useCallback(async (productId) => {
    try {
      const { getProducts } = await import('./lib/api');
      const products = await getProducts(storeId);
      const p = products?.find((x) => x.id === productId);
      if (p) { setActiveTab('Products'); setSelectedProduct(p); }
    } catch { setActiveTab('Products'); }
  }, [storeId]);

  const handleNavigateToStudio = useCallback((productId) => {
    setActiveTab('Studio');
    setStudioProductId(productId || null);
  }, []);

  const handleLogout = () => { localStorage.removeItem('auth_token'); window.location.reload(); };

  return (
    <>
      <header className="header">
        <div className="logo">
          <div className="logo-mark">T</div>
          <div className="logo-text">
            <div className="logo-brand">Titan Commerce</div>
            <div className="logo-sub">Command Center</div>
          </div>
        </div>

        {/* Store switcher */}
        {stores.length > 1 && (
          <div className="store-switcher" onClick={() => setShowStorePicker(!showStorePicker)}>
            <span className="store-switcher-name">{activeStore?.name}</span>
            <span className="store-switcher-arrow">▾</span>
            {showStorePicker && (
              <div className="store-switcher-dropdown">
                {stores.map((s) => (
                  <div key={s.id}
                    className={`store-switcher-item${s.id === storeId ? ' store-switcher-item--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); switchStore(s); setShowStorePicker(false); }}>
                    {s.name} <span className="store-switcher-currency">{s.currency}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <nav className="nav">
          {TABS.map((tab) => (
            <button key={tab} className={activeTab === tab ? 'active' : ''}
              onClick={() => { setActiveTab(tab); setSelectedProduct(null); }}>
              {tab}
            </button>
          ))}
        </nav>
        <div className="hdr-right">
          <div className="live-pill"><span className="live-dot" /><span className="live-text">Pipeline Live</span></div>
          <div className="clock">{clock}</div>
          <button className="logout-btn" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <main className="main">
          {activeTab === 'Overview' && <Overview onNavigateToProduct={handleNavigateToProduct} onNavigateToStudio={handleNavigateToStudio} onNavigateToShopify={() => { setActiveTab('Shopify'); setTimeout(() => document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth' }), 300); }} storeId={storeId} />}
          {activeTab === 'Shopify' && <Shopify onNavigateToProduct={handleNavigateToProduct} storeId={storeId} store={activeStore} />}
          {activeTab === 'Studio' && <Studio storeId={storeId} store={activeStore} initialProductId={studioProductId} onNavigateToProduct={handleNavigateToProduct} />}
          {activeTab === 'Products' && !selectedProduct && <Products onSelectProduct={handleSelectProduct} onNavigateToStudio={handleNavigateToStudio} storeId={storeId} />}
          {activeTab === 'Products' && selectedProduct && <ProductWorkspace product={selectedProduct} onBack={handleBackToProducts} onNavigateToStudio={handleNavigateToStudio} storeId={storeId} store={activeStore} />}
          {activeTab === 'Profit' && <Profit storeId={storeId} store={activeStore} />}
        </main>
      </div>
    </>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isTokenValid()) setAuthenticated(true);
    else localStorage.removeItem('auth_token');
    setLoading(false);
  }, []);

  if (loading) return null;
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;

  return (
    <StoreProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </StoreProvider>
  );
}

import { useState, useEffect, createContext, useContext } from 'react';
import { getStores } from '../lib/api';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [stores, setStores] = useState([]);
  const [activeStore, setActiveStore] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStores().then((data) => {
      setStores(data || []);
      const savedSlug = localStorage.getItem('active_store');
      const saved = (data || []).find((s) => s.slug === savedSlug);
      setActiveStore(saved || data?.[0] || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const switchStore = (store) => {
    setActiveStore(store);
    localStorage.setItem('active_store', store.slug);
  };

  return (
    <StoreContext.Provider value={{ stores, activeStore, switchStore, loading }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useActiveStore() {
  return useContext(StoreContext);
}

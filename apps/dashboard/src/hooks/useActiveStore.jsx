import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { getStores } from '../lib/api';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [stores, setStores] = useState([]);
  const [activeStore, setActiveStore] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStores = useCallback(async () => {
    try {
      const data = await getStores();
      setStores(data || []);
      const savedSlug = localStorage.getItem('active_store');
      const saved = (data || []).find((s) => s.slug === savedSlug);
      setActiveStore((prev) => {
        // If we already have an active store, update it with fresh data
        if (prev) {
          const updated = (data || []).find((s) => s.id === prev.id);
          return updated || saved || data?.[0] || null;
        }
        return saved || data?.[0] || null;
      });
    } catch (err) {
      console.error('[useActiveStore] Failed to load stores:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  const switchStore = (store) => {
    setActiveStore(store);
    localStorage.setItem('active_store', store.slug);
  };

  return (
    <StoreContext.Provider value={{ stores, activeStore, switchStore, loading, refreshStores: loadStores }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useActiveStore() {
  return useContext(StoreContext);
}

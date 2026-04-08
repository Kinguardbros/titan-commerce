import { useState, useEffect, useCallback } from 'react';
import { getShopifyOverview } from '../lib/api';

export function useShopifyOverview(days = 7, storeId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getShopifyOverview(days, storeId);
      setData(result);
    } catch (err) {
      console.error('Shopify overview failed:', err);
      setData({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [days, storeId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

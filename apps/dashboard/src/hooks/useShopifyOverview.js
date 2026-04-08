import { useState, useEffect, useCallback } from 'react';
import { getShopifyOverview } from '../lib/api';

const CACHE = {};
const CACHE_TTL = 60000;

export function useShopifyOverview(days = 7, storeId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const cacheKey = `shopify-${storeId}-${days}`;

  const refresh = useCallback(async (force = false) => {
    if (!force && CACHE[cacheKey] && Date.now() - CACHE[cacheKey].ts < CACHE_TTL) {
      setData(CACHE[cacheKey].data);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getShopifyOverview(days, storeId);
      CACHE[cacheKey] = { data: result, ts: Date.now() };
      setData(result);
    } catch (err) {
      console.error('Shopify overview failed:', err);
      setData({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [days, storeId, cacheKey]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh: () => refresh(true) };
}

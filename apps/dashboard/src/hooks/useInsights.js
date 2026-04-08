import { useState, useEffect, useCallback } from 'react';
import { getInsights } from '../lib/api';

export function useInsights(storeId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getInsights(storeId);
      setData(result);
    } catch (err) {
      console.error('Insights fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

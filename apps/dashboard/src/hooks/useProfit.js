import { useState, useEffect, useCallback } from 'react';
import { getProfitSummary } from '../lib/api';

export function useProfit(days = 7, storeId = null) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProfitSummary(days, storeId);
      setData(result);
    } catch (err) {
      console.error('Profit fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [days, storeId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

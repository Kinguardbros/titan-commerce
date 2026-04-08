import { useState, useEffect, useCallback } from 'react';
import { getProfitSummary } from '../lib/api';

export function useProfit(days = 7) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProfitSummary(days);
      setData(result);
    } catch (err) {
      console.error('Profit fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

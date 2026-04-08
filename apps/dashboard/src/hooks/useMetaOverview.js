import { useState, useEffect, useCallback } from 'react';
import { getMetaOverview } from '../lib/api';

export function useMetaOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMetaOverview();
      setData(result);
    } catch (err) {
      console.error('Meta overview failed:', err);
      setData({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, refresh };
}

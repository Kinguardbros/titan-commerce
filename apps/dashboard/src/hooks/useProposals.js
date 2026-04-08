import { useState, useEffect, useCallback } from 'react';
import { getProposals } from '../lib/api';
import supabase from '../lib/supabase';

export function useProposals(storeId) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const data = await getProposals(storeId);
      setProposals(data || []);
    } catch (err) {
      console.error('Proposals fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase.channel(`proposals-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId, refresh]);

  return { proposals, loading, refresh };
}

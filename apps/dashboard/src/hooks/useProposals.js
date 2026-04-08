import { useState, useEffect, useCallback } from 'react';
import { getProposals } from '../lib/api';
import supabase from '../lib/supabase';

const CACHE = {};
const CACHE_TTL = 30000;

export function useProposals(storeId) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const cacheKey = `proposals-${storeId}`;

  const refresh = useCallback(async (force = false) => {
    if (!storeId) return;
    if (!force && CACHE[cacheKey] && Date.now() - CACHE[cacheKey].ts < CACHE_TTL) {
      setProposals(CACHE[cacheKey].data);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getProposals(storeId);
      CACHE[cacheKey] = { data: data || [], ts: Date.now() };
      setProposals(data || []);
    } catch (err) {
      console.error('Proposals fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId, cacheKey]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase.channel(`proposals-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, () => refresh(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId, refresh]);

  return { proposals, loading, refresh: () => refresh(true) };
}

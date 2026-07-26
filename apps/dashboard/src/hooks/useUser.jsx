import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { getMe } from '../lib/api';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const { user: u } = await getMe();
      setUser(u);
    } catch (err) {
      console.error('[useUser] Failed to load current user:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  return (
    <UserContext.Provider value={{ user, loading, refreshUser: loadUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

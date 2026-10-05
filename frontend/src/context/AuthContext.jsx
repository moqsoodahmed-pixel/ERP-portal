import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshAccessToken, setAccessToken, setAuthFailureHandler } from '../services/apiClient.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  const clear = useCallback(() => { setAccessToken(null); setState({ status: 'anonymous', user: null }); }, []);

  useEffect(() => {
    setAuthFailureHandler(clear);
    let cancelled = false;
    (async () => {
      if (await refreshAccessToken()) {
        try {
          const { data } = await api.get('/auth/me');
          if (!cancelled) setState({ status: 'authenticated', user: data });
          return;
        } catch { /* fall through to anonymous */ }
      }
      if (!cancelled) clear();
    })();
    return () => { cancelled = true; };
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setState({ status: 'authenticated', user: data.user });
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally { clear(); }
  }, [clear]);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

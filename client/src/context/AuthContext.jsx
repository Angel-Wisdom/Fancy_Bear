import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

export function AuthProvider({ children }) {

  const isBypassEnabled = import.meta.env.VITE_AUTH_DISABLED === 'true';

  const [user, setUser] = useState(() => {
    if (isBypassEnabled) {
      return { id: 'demo-user', role: 'verifier', name: 'Demo Officer', username: 'demo' };
    }
    return null;
  });

  const [token, setToken] = useState(() => {
    if (isBypassEnabled) return 'bypass-mock-token';
    return localStorage.getItem('suraksha_token');
  });

  const [loading, setLoading] = useState(true);

  // Restore session from stored token
  useEffect(() => {
    if (isBypassEnabled) {
      setLoading(false);
      return;
    }

    if (token && !isTokenExpired(token)) {
      const payload = parseJwt(token);
      setUser({
        id: payload.id || payload.userId,
        username: payload.username,
        role: payload.role,
        name: payload.name || payload.username,
      });
    } else if (token) {
      localStorage.removeItem('suraksha_token');
      setToken(null);
    }
    setLoading(false);
  }, [isBypassEnabled, token]);

  // Auto-logout timer
  useEffect(() => {
    if (isBypassEnabled || !token) return;
    const payload = parseJwt(token);
    if (!payload?.exp) return;

    const msUntilExpiry = payload.exp * 1000 - Date.now();
    if (msUntilExpiry <= 0) {
      logout();
      return;
    }

    const timer = setTimeout(() => {
      logout();
    }, msUntilExpiry);

    return () => clearTimeout(timer);
  }, [token, isBypassEnabled]);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password });
    const { token: newToken, user: userData } = res;

    localStorage.setItem('suraksha_token', newToken);
    setToken(newToken);
    setUser({
      id: userData.id || userData.userId,
      username: userData.username,
      role: userData.role,
      name: userData.name || userData.username,
    });

    return userData;
  }, []);

  const logout = useCallback(() => {
    if (isBypassEnabled) {
      window.location.href = '/';
      return;
    }
    localStorage.removeItem('suraksha_token');
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    user,
    token,
    loading,
    isAuthenticated: isBypassEnabled ? true : (!!user && !!token),
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

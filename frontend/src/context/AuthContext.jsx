import { createContext, useContext, useEffect, useState } from 'react';
import { api, authApi, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('triveni_token');
    if (!token) {
      setLoading(false);
      return;
    }
    setToken(token);
    api
      .get('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));

    const onUnauthorized = () => setUser(null);
    window.addEventListener('triveni:unauthorized', onUnauthorized);
    return () => window.removeEventListener('triveni:unauthorized', onUnauthorized);
  }, []);

  const login = async (email, password) => {
    const data = await authApi.login(email, password);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const acceptTerms = async () => {
    const data = await api.post('/auth/accept-terms', {});
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, acceptTerms }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
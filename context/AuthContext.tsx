import React, { createContext, useContext, useState, useEffect } from 'react';

const AUTH_EXPIRED_EVENT = 'app:auth-expired';

export interface User {
  id: string;
  operator_code: string;
  name: string;
  role: string;
  status?: string;
  permissions?: Array<{ key: string; module: string; action: string }>;
  visible_users?: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (operator_code: string, pin: string) => Promise<void>;
  register: (data: { operator_code: string, pin: string, name: string, role: string }) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const handleAuthExpired = () => {
      setUser(null);
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(input, init);

      if (response.status === 401) {
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

        const isAuthFormRequest = requestUrl.includes('/api/auth/login') || requestUrl.includes('/api/auth/register');
        if (!isAuthFormRequest) {
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
      }

      return response;
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, []);

  const login = async (operator_code: string, pin: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_code, pin }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en login');
    setUser(data.user);
  };

  const register = async (data: { operator_code: string, pin: string, name: string, role: string }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include'
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Error en registro');
    // If registered successfully, we might need to login immediately or wait for approval.
    // The backend returns the user object. If status is pending, we should probably set a temporary state or just login and let the backend reject the /me call, or handle it here.
    // Actually, if we just login, the backend will return 403 if pending.
    // Let's just return the user data and let the component handle it.
    return resData.user;
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error(e);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

import React, { createContext, useContext, useState, useEffect } from 'react';
import { io } from 'socket.io-client';

export interface User {
  id: string;
  operator_code: string;
  name: string;
  role: string;
  status?: string;
  session_timeout_minutes?: number;
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
const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const timeoutMinutes = data.session_timeout_minutes || data.user?.session_timeout_minutes || DEFAULT_SESSION_TIMEOUT_MINUTES;
        setUser({ ...data.user, session_timeout_minutes: timeoutMinutes });
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

  const login = async (operator_code: string, pin: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_code, pin }),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en login');
    const timeoutMinutes = data.session_timeout_minutes || data.user?.session_timeout_minutes || DEFAULT_SESSION_TIMEOUT_MINUTES;
    setUser({ ...data.user, session_timeout_minutes: timeoutMinutes });
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

  useEffect(() => {
    if (!user) {
      return;
    }

    const timeoutMinutes = user.session_timeout_minutes || DEFAULT_SESSION_TIMEOUT_MINUTES;
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let timeoutId: number | undefined;

    const closeSessionByInactivity = async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {
        console.error(e);
      }
      sessionStorage.setItem('auth_notice', 'Sesión cerrada por inactividad.');
      setUser(null);
    };

    const resetInactivityTimer = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(closeSessionByInactivity, timeoutMs);
    };

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetInactivityTimer, { passive: true }));

    resetInactivityTimer();

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetInactivityTimer));
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [user]);

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

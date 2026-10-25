import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types/index.ts';
import { api, getStoredToken, setStoredToken } from '../api/client.ts';
import { invalidateProjectCache } from '../api/projectCache.ts';
import { detachPushSubscription } from '../push.ts';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isSupervisor: boolean;
  isCameraman: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchCurrentUser = async () => {
    try {
      if (!getStoredToken()) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const currentUser = await api.getCurrentUser();
      setUser(currentUser);
    } catch (err) {
      console.warn('Session expired or invalid:', err);
      setStoredToken(null);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const login = async (username: string, password: string) => {
    // isLoading فقط برای بررسی اولیه نشست است؛ اگر هنگام ورود هم true شود،
    // صفحه لاگین جای خود را به اسپینر می‌دهد و پیام خطای ورود از بین می‌رود.
    const res = await api.login({ username, password });
    invalidateProjectCache();
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      // پیش از پاک‌شدن توکن، دستگاه از اعلان‌های این حساب جدا می‌شود تا
      // کاربر بعدی/خروج‌کرده اعلان حساب قبلی را دریافت نکند.
      await detachPushSubscription();
      await api.logout();
    } catch {
      // ignore
    } finally {
      invalidateProjectCache();
      setStoredToken(null);
      setToken(null);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    await fetchCurrentUser();
  };

  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isAdmin = user?.role === 'Admin' || isSuperAdmin;
  const isEditor = user?.role === 'Editor';
  const isSupervisor = user?.role === 'Supervisor';
  const isCameraman = user?.role === 'Cameraman';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        isSuperAdmin,
        isAdmin,
        isEditor,
        isSupervisor,
        isCameraman,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

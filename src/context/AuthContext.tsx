import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types/index.ts';
import { api, getStoredToken, setStoredToken } from '../api/client.ts';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchUserFast: (role: UserRole) => Promise<void>;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isSupervisor: boolean;
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
    setIsLoading(true);
    try {
      const res = await api.login({ username, password });
      setStoredToken(res.token);
      setToken(res.token);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    } finally {
      setStoredToken(null);
      setToken(null);
      setUser(null);
    }
  };

  const switchUserFast = async (role: UserRole) => {
    const creds: Record<UserRole, { u: string; p: string }> = {
      SuperAdmin: { u: 'superadmin', p: 'superadmin' },
      Admin: { u: 'admin1', p: 'admin1' },
      Editor: { u: 'editor1', p: 'editor1' },
      Supervisor: { u: 'supervisor1', p: 'supervisor1' },
    };
    await login(creds[role].u, creds[role].p);
  };

  const refreshUser = async () => {
    await fetchCurrentUser();
  };

  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isAdmin = user?.role === 'Admin' || isSuperAdmin;
  const isEditor = user?.role === 'Editor';
  const isSupervisor = user?.role === 'Supervisor';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        switchUserFast,
        isSuperAdmin,
        isAdmin,
        isEditor,
        isSupervisor,
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

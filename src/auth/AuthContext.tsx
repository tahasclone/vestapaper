import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getMe, setUnauthorizedHandler, type Me } from '../api/client';

type Status = 'loading' | 'anon' | 'authed';

interface AuthValue {
  status: Status;
  user: Me['user'];
  board: Me['board'] | null;
  config: any;
  setConfig: (c: any) => void;
  setBoard: (b: Me['board']) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getMe();
      setMe(next);
      setStatus('authed');
    } catch {
      // A 401 is the normal "not signed in" answer, not an error worth showing.
      setMe(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => {
    // Any 401 anywhere in the app drops us back to anonymous.
    setUnauthorizedHandler(() => {
      setMe(null);
      setStatus('anon');
    });
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{
        status,
        user: me?.user ?? null,
        board: me?.board ?? null,
        config: me?.config ?? null,
        setConfig: (c) => setMe((prev) => (prev ? { ...prev, config: c } : prev)),
        setBoard: (b) => setMe((prev) => (prev ? { ...prev, board: b } : prev)),
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

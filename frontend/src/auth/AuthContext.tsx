import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, onUnauthorized } from '../api/client';
import { decodeSession, restoreSession, type Session, tokenStore } from './session';

/** Router state passed to the login and register pages. */
export interface AuthLocationState {
  /** Path to return to after logging in. */
  from?: string;
  /** Username of an account that was just created. */
  registered?: string;
  /** Set when the API rejected the stored session. */
  sessionExpired?: boolean;
}

interface AuthContextValue {
  /** The logged-in user, or `null` when nobody is logged in. */
  user: { id: number; username: string } | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_PATHS = ['/login', '/register'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => restoreSession());
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const logout = useCallback(() => {
    tokenStore.clear();
    setSession(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { token } = await api.login(username, password);
    const next = decodeSession(token);
    if (!next) throw new Error('The server sent a login token this app can’t read. Try again.');
    tokenStore.set(token);
    setSession(next);
  }, []);

  // The API rejected the token (it expired, or the server's secret changed): end the
  // session and ask the user to log in again, then bring them back here.
  useEffect(
    () =>
      onUnauthorized(() => {
        logout();
        if (AUTH_PATHS.includes(pathname)) return;
        const state: AuthLocationState = { from: pathname + search, sessionExpired: true };
        navigate('/login', { state });
      }),
    [logout, navigate, pathname, search],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user: session && { id: session.id, username: session.username }, login, logout }),
    [session, login, logout],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/**
 * Router state for links to the login and register pages, so that logging in returns
 * to the current page. On those pages it passes along the page the user came from.
 */
export function useAuthLinkState(): AuthLocationState {
  const { pathname, search, state } = useLocation();
  if (AUTH_PATHS.includes(pathname)) return { from: (state as AuthLocationState | null)?.from };
  return { from: pathname + search };
}

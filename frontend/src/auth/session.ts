export const TOKEN_STORAGE_KEY = 'productVault.token';

export interface Session {
  username: string;
  /** When the token stops being valid, in epoch milliseconds. */
  expiresAt: number;
}

/** The login token, persisted in localStorage so a session survives reloads. */
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_STORAGE_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_STORAGE_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_STORAGE_KEY),
};

function decodeBase64Url(segment: string): string {
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * Reads the username and expiry from a JWT's payload, or returns `null` if it can't.
 * The signature isn't checked here: only the server can do that, and does on every
 * protected request.
 */
export function decodeSession(token: string): Session | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(decodeBase64Url(payload));
    const { username, exp } = (claims ?? {}) as { username?: unknown; exp?: unknown };
    if (typeof username !== 'string' || typeof exp !== 'number') return null;
    return { username, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

/** The session stored by an earlier visit, if it is still valid. Removes the token otherwise. */
export function restoreSession(now = Date.now()): Session | null {
  const token = tokenStore.get();
  if (token === null) return null;

  const session = decodeSession(token);
  if (session && session.expiresAt > now) return session;
  tokenStore.clear();
  return null;
}

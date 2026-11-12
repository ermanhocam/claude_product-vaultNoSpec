import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import App from '../App';
import { TOKEN_STORAGE_KEY } from '../auth/session';
import type { Note, Product } from '../types';
import { fakeToken } from './mockApi';

/** A starting URL, or a URL with router state as if the app had navigated there. */
type Entry = string | { pathname: string; state?: unknown };

export function renderApp(path: Entry = '/') {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user, ...utils };
}

export function product(overrides: Partial<Product> = {}): Product {
  return { id: 1, name: 'Moka pot', createdAt: '2026-10-20T09:30:00.000Z', ...overrides };
}

export function note(overrides: Partial<Note> = {}): Note {
  return { id: 1, productId: 1, content: 'Makes strong coffee', author: null, createdAt: '2026-10-20T10:00:00.000Z', ...overrides };
}

/** Stores a login token, as a previous visit would have, so the app starts logged in. */
export function signIn(username = 'alice', options?: Parameters<typeof fakeToken>[1]) {
  const token = fakeToken(username, options);
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  return token;
}

/** A promise you can settle from the outside, to hold a response and observe in-flight UI states. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

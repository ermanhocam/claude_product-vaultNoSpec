import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { API_URL } from '../api/client';
import { decodeSession } from '../auth/session';
import type { Note, Product } from '../types';

/** Absolute URL of an API path, matching what the real API client requests. */
export const apiUrl = (path: string) => `${API_URL}/api${path}`;

const newestFirst = (a: { createdAt: string; id: number }, b: { createdAt: string; id: number }) =>
  b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

export const FAKE_SIGNATURE = 'fake-signature';

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A JWT-shaped token the fake backend accepts. Only the real server can verify a real signature. */
export function fakeToken(username: string, { id = 1, expiresInSeconds = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: String(id), username, iat: now, exp: now + expiresInSeconds };
  return [base64url({ alg: 'HS256', typ: 'JWT' }), base64url(payload), FAKE_SIGNATURE].join('.');
}

const notFound = (message: string) => HttpResponse.json({ error: message }, { status: 404 });
const unauthorized = (message: string) => HttpResponse.json({ error: message }, { status: 401 });

interface FakeUser {
  id: number;
  username: string;
  password: string;
}

/** Mirrors the real auth middleware's answers for a request's Authorization header. */
function authError(authorization: string | null): string | null {
  const match = /^Bearer(?:\s+(.*))?$/i.exec(authorization ?? '');
  if (!match) return 'Authentication required';
  const token = match[1]?.trim() ?? '';
  const session = decodeSession(token);
  if (!session || !token.endsWith(`.${FAKE_SIGNATURE}`)) return 'Invalid token';
  if (session.expiresAt <= Date.now()) return 'Token expired';
  return null;
}

/**
 * In-memory stand-in for the backend. Tests seed it, drive the UI, then assert on
 * what the "server" received and stored. Validation is deliberately not duplicated
 * here: the real backend's rules are covered by the backend test suite, and tests
 * that need a validation or server error override a handler with `server.use()`.
 */
class FakeBackend {
  products: Product[] = [];
  notes: Note[] = [];
  users: FakeUser[] = [];
  /** Every request that reached the network layer, in order (including overridden ones). */
  requests: Array<{ method: string; path: string; authorization: string | null }> = [];

  reset() {
    this.products = [];
    this.notes = [];
    this.users = [];
    this.requests = [];
  }

  seed({ products = [], notes = [], users = [] }: { products?: Product[]; notes?: Note[]; users?: FakeUser[] }) {
    this.products.push(...products.map((p) => ({ ...p })));
    this.notes.push(...notes.map((n) => ({ ...n })));
    this.users.push(...users.map((u) => ({ ...u })));
  }

  /** Requests matching a method and path, e.g. `requestsTo('POST', '/api/products')`. */
  requestsTo(method: string, path: string) {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  nextId(items: Array<{ id: number }>) {
    return Math.max(0, ...items.map((item) => item.id)) + 1;
  }

  product(id: unknown) {
    return this.products.find((p) => String(p.id) === id);
  }

  note(id: unknown) {
    return this.notes.find((n) => String(n.id) === id);
  }

  notesFor(productId: number) {
    return this.notes.filter((n) => n.productId === productId).sort(newestFirst);
  }

  user(username: string) {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  }
}

export const backend = new FakeBackend();

export const handlers = [
  http.post(apiUrl('/auth/register'), async ({ request }) => {
    const { username, password } = (await request.json()) as { username: string; password: string };
    if (backend.user(username)) return HttpResponse.json({ error: 'Username is already taken' }, { status: 409 });
    const user = { id: backend.nextId(backend.users), username, password };
    backend.users.push(user);
    return HttpResponse.json({ id: user.id, username }, { status: 201 });
  }),

  http.post(apiUrl('/auth/login'), async ({ request }) => {
    const { username, password } = (await request.json()) as { username: string; password: string };
    const user = backend.user(username);
    if (!user || user.password !== password) return unauthorized('Invalid credentials');
    return HttpResponse.json({ token: fakeToken(user.username, { id: user.id }) });
  }),

  http.get(apiUrl('/products'), () => HttpResponse.json([...backend.products].sort(newestFirst))),

  // Mirrors the backend's search: name search (`q`) is public; the date range, note-text and
  // author filters require a login. Every active filter must match; results are newest first.
  http.get(apiUrl('/products/search'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const query = params.get('q')?.trim() ?? '';
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    const noteText = params.get('noteText')?.trim().toLowerCase() ?? '';
    const author = params.get('author')?.trim().toLowerCase() ?? '';

    const usesAdvanced = Boolean(from || to || noteText || author);
    if (usesAdvanced) {
      const problem = authError(request.headers.get('Authorization'));
      if (problem) return unauthorized(problem);
    }

    const terms = query ? query.split(/\s+/).map((t) => t.toLowerCase()) : [];
    const matches = backend.products.filter((p) => {
      const name = p.name.toLowerCase();
      if (!terms.every((term) => name.includes(term))) return false;
      const day = p.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      const productNotes = backend.notes.filter((n) => n.productId === p.id);
      if (noteText && !productNotes.some((n) => n.content.toLowerCase().includes(noteText))) return false;
      if (author) {
        const authorIds = backend.users
          .filter((u) => u.username.toLowerCase() === author)
          .map((u) => u.id);
        if (!productNotes.some((n) => n.author !== null && authorIds.includes(n.author))) return false;
      }
      return true;
    });
    return HttpResponse.json(matches.sort(newestFirst));
  }),

  http.post(apiUrl('/products'), async ({ request }) => {
    const { name } = (await request.json()) as { name: string };
    const product: Product = {
      id: backend.nextId(backend.products),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    backend.products.push(product);
    return HttpResponse.json(product, { status: 201 });
  }),

  http.get(apiUrl('/products/:productId'), ({ params }) => {
    const product = backend.product(params.productId);
    if (!product) return notFound('Product not found');
    return HttpResponse.json({ ...product, notes: backend.notesFor(product.id) });
  }),

  http.delete(apiUrl('/products/:productId'), ({ params, request }) => {
    const problem = authError(request.headers.get('Authorization'));
    if (problem) return unauthorized(problem);
    const product = backend.product(params.productId);
    if (!product) return notFound('Product not found');
    backend.products = backend.products.filter((p) => p !== product);
    backend.notes = backend.notes.filter((n) => n.productId !== product.id);
    return HttpResponse.json({ id: product.id, deleted: true });
  }),

  http.post(apiUrl('/products/:productId/notes'), async ({ params, request }) => {
    const problem = authError(request.headers.get('Authorization'));
    if (problem) return unauthorized(problem);
    const product = backend.product(params.productId);
    if (!product) return notFound('Product not found');
    const { content } = (await request.json()) as { content: string };
    const note: Note = {
      id: backend.nextId(backend.notes),
      productId: product.id,
      content: content.trim(),
      author: null,
      createdAt: new Date().toISOString(),
    };
    backend.notes.push(note);
    return HttpResponse.json(note, { status: 201 });
  }),

  http.put(apiUrl('/notes/:noteId'), async ({ params, request }) => {
    const note = backend.note(params.noteId);
    if (!note) return notFound('Note not found');
    const { content } = (await request.json()) as { content: string };
    note.content = content.trim();
    return HttpResponse.json(note);
  }),

  http.delete(apiUrl('/notes/:noteId'), ({ params, request }) => {
    const problem = authError(request.headers.get('Authorization'));
    if (problem) return unauthorized(problem);
    const note = backend.note(params.noteId);
    if (!note) return notFound('Note not found');
    backend.notes = backend.notes.filter((n) => n !== note);
    return HttpResponse.json({ id: note.id, deleted: true });
  }),
];

export const server = setupServer(...handlers);

server.events.on('request:start', ({ request }) => {
  backend.requests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    authorization: request.headers.get('Authorization'),
  });
});

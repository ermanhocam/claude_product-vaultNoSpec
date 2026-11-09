import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../auth/session';
import { apiUrl, server } from '../test/mockApi';
import { api, API_URL, ApiError, onUnauthorized } from './client';

/** Responds to any API request with `response` and records what the client actually sent. */
function captureRequests(response: () => Response = () => HttpResponse.json({})) {
  const sent: Array<{ method: string; url: string; headers: Headers; body: string }> = [];
  server.use(
    http.all(apiUrl('/*'), async ({ request }) => {
      sent.push({ method: request.method, url: request.url, headers: request.headers, body: await request.text() });
      return response();
    }),
  );
  return sent;
}

const credentials = { username: 'alice', password: 'secret12' };

describe('api client', () => {
  it('defaults to the local backend', () => {
    expect(API_URL).toBe('http://localhost:3001');
  });

  it('lists products with a GET request that accepts JSON', async () => {
    const sent = captureRequests(() => HttpResponse.json([{ id: 1, name: 'A', createdAt: 'x' }]));

    await expect(api.listProducts()).resolves.toEqual([{ id: 1, name: 'A', createdAt: 'x' }]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'GET', url: 'http://localhost:3001/api/products', body: '' });
    expect(sent[0]!.headers.get('Accept')).toBe('application/json');
  });

  it('sends JSON bodies for writes', async () => {
    const sent = captureRequests(() => HttpResponse.json({ id: 7 }, { status: 201 }));

    await api.createNote(3, 'Hello');

    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'http://localhost:3001/api/products/3/notes',
      body: JSON.stringify({ content: 'Hello' }),
    });
    expect(sent[0]!.headers.get('Content-Type')).toBe('application/json');
  });

  it.each([
    ['register', () => api.register('alice', 'secret12'), 'POST', '/api/auth/register', credentials],
    ['login', () => api.login('alice', 'secret12'), 'POST', '/api/auth/login', credentials],
    ['createProduct', () => api.createProduct('X'), 'POST', '/api/products', { name: 'X' }],
    ['getProduct', () => api.getProduct(5), 'GET', '/api/products/5', undefined],
    ['updateNote', () => api.updateNote(9, 'Y'), 'PUT', '/api/notes/9', { content: 'Y' }],
    ['deleteNote', () => api.deleteNote(9), 'DELETE', '/api/notes/9', undefined],
  ] as const)('%s calls the right endpoint', async (_name, call, method, path, body) => {
    const sent = captureRequests();

    await call();

    expect(sent[0]).toMatchObject({ method, url: `http://localhost:3001${path}` });
    expect(sent[0]!.body).toBe(body === undefined ? '' : JSON.stringify(body));
  });

  it('turns error responses into an ApiError carrying the server message and status', async () => {
    captureRequests(() => HttpResponse.json({ error: 'Product name is required' }, { status: 400 }));

    const error = await api.createProduct('').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Product name is required', status: 400 });
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    captureRequests(() => new HttpResponse('<html>Bad gateway</html>', { status: 502 }));

    await expect(api.listProducts()).rejects.toMatchObject({
      message: 'The server responded with status 502.',
      status: 502,
    });
  });

  it('explains when the backend cannot be reached', async () => {
    captureRequests(() => HttpResponse.error());

    await expect(api.listProducts()).rejects.toMatchObject({
      message: "Can't reach the Product Vault API at http://localhost:3001. Make sure the backend is running.",
      status: 0,
    });
  });
});

describe('api client product deletion (Requirement 19)', () => {
  it('T19.7c deleteProduct sends one DELETE to the product and resolves to the server response', async () => {
    const sent = captureRequests(() => HttpResponse.json({ id: 5, deleted: true }));

    await expect(api.deleteProduct(5)).resolves.toEqual({ id: 5, deleted: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'DELETE', url: 'http://localhost:3001/api/products/5' });
    expect(sent[0]!.body).toBe('');
  });
});

describe('api client authentication (Requirement 15)', () => {
  const storeToken = (token = 'header.payload.signature') => localStorage.setItem(TOKEN_STORAGE_KEY, token);
  const rejectWith401 = () => captureRequests(() => HttpResponse.json({ error: 'Token expired' }, { status: 401 }));

  it('sends the stored token as a Bearer Authorization header on every request', async () => {
    storeToken('abc.def.ghi');
    const sent = captureRequests(() => HttpResponse.json([]));

    await api.listProducts();
    await api.createNote(1, 'Hello');
    await api.deleteNote(2);

    expect(sent.map((r) => r.headers.get('Authorization'))).toEqual(Array(3).fill('Bearer abc.def.ghi'));
  });

  it('sends no Authorization header when no token is stored', async () => {
    const sent = captureRequests(() => HttpResponse.json([]));
    await api.listProducts();
    expect(sent[0]!.headers.has('Authorization')).toBe(false);
  });

  it('reports a 401 to the unauthorized handler when the request carried a token', async () => {
    storeToken();
    rejectWith401();
    const handler = vi.fn();
    const stop = onUnauthorized(handler);

    await expect(api.createNote(1, 'Hello')).rejects.toMatchObject({ status: 401, message: 'Token expired' });

    expect(handler).toHaveBeenCalledOnce();
    stop();
  });

  it('does not report a 401 for a request without a token, such as a failed login', async () => {
    rejectWith401();
    const handler = vi.fn();
    const stop = onUnauthorized(handler);

    await expect(api.login('alice', 'wrong-password')).rejects.toMatchObject({ status: 401 });

    expect(handler).not.toHaveBeenCalled();
    stop();
  });

  it('stops calling a handler once it is removed', async () => {
    storeToken();
    rejectWith401();
    const handler = vi.fn();
    onUnauthorized(handler)();

    await expect(api.listProducts()).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });
});

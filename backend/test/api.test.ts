import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, FRONTEND_ORIGIN } from './helpers.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  if (ctx.db.isOpen) ctx.db.close();
  vi.restoreAllMocks();
});

describe('API conventions (Requirement 6)', () => {
  it('reports health as JSON', async () => {
    const res = await ctx.api.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await ctx.api.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'Route not found' });
  });

  it('returns a JSON 404 for unsupported methods on known paths', async () => {
    const res = await ctx.api.delete('/api/products');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns 400 with a parse error message for malformed JSON on every write endpoint', async () => {
    const product = await ctx.createProduct('Widget');
    const note = await ctx.createNote(product.id, 'Hello');
    const auth = await ctx.authHeader();
    const writes = [
      () => ctx.api.post('/api/products'),
      () => ctx.api.post(`/api/products/${product.id}/notes`).set(auth),
      () => ctx.api.put(`/api/notes/${note.id}`),
      () => ctx.api.post('/api/auth/register'),
      () => ctx.api.post('/api/auth/login'),
    ];

    for (const write of writes) {
      const res = await write().set('Content-Type', 'application/json').send('{"name": "unterminated');
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({ error: 'Request body could not be parsed: malformed JSON' });
    }
  });

  it('returns 413 as JSON for oversized request bodies', async () => {
    const res = await ctx.api
      .post('/api/products')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('allows cross-origin requests from the frontend origin', async () => {
    const res = await ctx.api.get('/api/products').set('Origin', FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
  });

  it('answers CORS preflight requests for write methods from the frontend origin', async () => {
    const res = await ctx.api
      .options('/api/notes/1')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/PUT/);
    expect(res.headers['access-control-allow-methods']).toMatch(/DELETE/);
  });

  it('allows the Authorization header in cross-origin note creation', async () => {
    const res = await ctx.api
      .options('/api/products/1/notes')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('does not grant CORS access to other origins', async () => {
    const res = await ctx.api.get('/api/products').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns a generic 500 error without exposing internal details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.db.close(); // every query now throws an internal SQLite error

    const res = await ctx.api.get('/api/products');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'An unexpected error occurred' });
    expect(JSON.stringify(res.body)).not.toMatch(/sqlite|database|stack|at /i);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not advertise the server framework', async () => {
    const res = await ctx.api.get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

import bcrypt from 'bcryptjs';
import express from 'express';
import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from '../src/auth/middleware.js';
import { createTokenService } from '../src/auth/tokens.js';
import { errorHandler } from '../src/errors.js';
import { createTestContext, TEST_JWT_SECRET, TEST_PASSWORD } from './helpers.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.db.close();
});

const storedUsers = () => ctx.db.prepare('SELECT id, username, password_hash FROM users ORDER BY id').all();

interface CraftOptions {
  claims?: Record<string, unknown>;
  /** `null` leaves the claim out. */
  sub?: string | null;
  /** Relative ("1h") or absolute (epoch seconds) expiry; `null` leaves the claim out. */
  expiresAt?: string | number | null;
  secret?: string;
}

/** Signs a token with arbitrary claims, for the cases the real login never produces. */
function craftToken({
  claims = { username: 'tester' },
  sub = '1',
  expiresAt = '1h',
  secret = TEST_JWT_SECRET,
}: CraftOptions = {}) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (sub !== null) jwt.setSubject(sub);
  if (expiresAt !== null) jwt.setExpirationTime(expiresAt);
  return jwt.sign(new TextEncoder().encode(secret));
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('POST /api/auth/register (Requirement 11)', () => {
  it('creates the user and returns the username', async () => {
    const res = await ctx.api.post('/api/auth/register').send({ username: 'alice', password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ id: expect.any(Number), username: 'alice' });
    expect(storedUsers()).toEqual([expect.objectContaining({ id: res.body.id, username: 'alice' })]);
  });

  it('stores a bcrypt hash of the password, never the password itself', async () => {
    await ctx.register('alice', TEST_PASSWORD);

    const [user] = storedUsers();
    const hash = String(user!.password_hash);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
    expect(hash).not.toContain(TEST_PASSWORD);
    await expect(bcrypt.compare(TEST_PASSWORD, hash)).resolves.toBe(true);
  });

  it('returns 409 when the username is already taken, ignoring letter case', async () => {
    await ctx.register('alice');

    for (const username of ['alice', 'ALICE', 'Alice']) {
      const res = await ctx.api.post('/api/auth/register').send({ username, password: 'another password' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Username is already taken' });
    }
    expect(storedUsers()).toHaveLength(1);
  });

  it.each(['ab', 'a'.repeat(51)])('rejects the username "%s" with a length error', async (username) => {
    const res = await ctx.api.post('/api/auth/register').send({ username, password: TEST_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Username must be between 3 and 50 characters' });
  });

  it('accepts usernames of exactly 3 and 50 characters', async () => {
    await ctx.register('abc');
    await ctx.register('b'.repeat(50));
  });

  it.each([
    ['7 characters', 'x'.repeat(7)],
    ['129 characters', 'x'.repeat(129)],
  ])('rejects a password of %s with a length error', async (_label, password) => {
    const res = await ctx.api.post('/api/auth/register').send({ username: 'alice', password });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Password must be between 8 and 128 characters' });
  });

  it('accepts passwords of exactly 8 and 128 characters, counting emoji as one character', async () => {
    await ctx.register('eight', 'x'.repeat(8));
    await ctx.register('max', 'y'.repeat(128));
    await ctx.register('emoji', '🔑'.repeat(8));
  });

  it.each(['with space', 'dot.name', 'émile', 'semi;colon', 'at@sign'])(
    'rejects the username "%s" with the allowed character set',
    async (username) => {
      const res = await ctx.api.post('/api/auth/register').send({ username, password: TEST_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Username may only contain letters, numbers, hyphens and underscores' });
    },
  );

  it('accepts letters, digits, hyphens and underscores', async () => {
    const user = await ctx.register('Jane_Doe-42');
    expect(user.username).toBe('Jane_Doe-42');
  });

  it.each([
    ['a missing username', { password: TEST_PASSWORD }, 'Username is required'],
    ['an empty username', { username: '', password: TEST_PASSWORD }, 'Username is required'],
    ['a null username', { username: null, password: TEST_PASSWORD }, 'Username is required'],
    ['a non-string username', { username: 42, password: TEST_PASSWORD }, 'Username must be a string'],
    ['a missing password', { username: 'alice' }, 'Password is required'],
    ['a non-string password', { username: 'alice', password: ['secret123'] }, 'Password must be a string'],
    ['an empty body', {}, 'Username is required'],
  ])('rejects %s, naming the field', async (_label, body, error) => {
    const res = await ctx.api.post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
  });

  it('does not create a user when validation fails', async () => {
    await ctx.api.post('/api/auth/register').send({ username: 'alice', password: 'short' }).expect(400);
    expect(storedUsers()).toEqual([]);
  });
});

describe('POST /api/auth/login (Requirement 12)', () => {
  it('returns a signed JWT carrying the user id and username, valid for 24 hours', async () => {
    const user = await ctx.register('alice');

    const res = await ctx.api.post('/api/auth/login').send({ username: 'alice', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ token: expect.any(String) });

    const token = res.body.token as string;
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'HS256' });
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({ sub: String(user.id), username: 'alice' });
    expect(claims.exp! - claims.iat!).toBe(24 * 60 * 60);
    await expect(createTokenService(TEST_JWT_SECRET).verify(token)).resolves.toEqual({ id: user.id, username: 'alice' });
  });

  it('matches the username regardless of letter case and returns it as registered', async () => {
    await ctx.register('Alice');
    const token = await ctx.login('aLICE');
    expect(decodeJwt(token)).toMatchObject({ username: 'Alice' });
  });

  it('returns 401 "Invalid credentials" for an unknown username', async () => {
    const res = await ctx.api.post('/api/auth/login').send({ username: 'nobody', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  it('returns 401 "Invalid credentials" for a wrong password', async () => {
    await ctx.register('alice');
    const res = await ctx.api.post('/api/auth/login').send({ username: 'alice', password: `${TEST_PASSWORD}!` });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  it('does not trim passwords', async () => {
    await ctx.register('alice', '  padded secret  ');
    await ctx.api.post('/api/auth/login').send({ username: 'alice', password: 'padded secret' }).expect(401);
    await ctx.login('alice', '  padded secret  ');
  });

  it.each([
    ['a missing username', { password: TEST_PASSWORD }, 'Username is required'],
    ['an empty username', { username: '', password: TEST_PASSWORD }, 'Username is required'],
    ['a missing password', { username: 'alice' }, 'Password is required'],
    ['an empty password', { username: 'alice', password: '' }, 'Password is required'],
    ['a non-string password', { username: 'alice', password: 12345678 }, 'Password must be a string'],
  ])('returns 400 for %s, naming the required field', async (_label, body, error) => {
    const res = await ctx.api.post('/api/auth/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
  });
});

describe('Authentication middleware (Requirement 13)', () => {
  /** A minimal app with one protected route that echoes `req.user`. */
  function protectedRoute() {
    const handler = vi.fn<express.RequestHandler>((req, res) => {
      res.json(req.user);
    });
    const app = express();
    app.get('/protected', createAuthMiddleware(createTokenService(TEST_JWT_SECRET)), handler);
    app.use(errorHandler);
    return { api: request(app), handler };
  }

  async function expectRejected(authorization: string | undefined, error: string) {
    const { api, handler } = protectedRoute();
    const req = api.get('/protected');
    const res = await (authorization === undefined ? req : req.set('Authorization', authorization));

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error });
    expect(handler).not.toHaveBeenCalled();
  }

  it('attaches the user id and username to the request and calls the next handler', async () => {
    const { api, handler } = protectedRoute();
    const token = await craftToken({ sub: '7' });
    const res = await api.get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, username: 'tester' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('accepts the scheme name in any letter case', async () => {
    const { api } = protectedRoute();
    const token = await craftToken();
    await api.get('/protected').set('Authorization', `bearer ${token}`).expect(200);
  });

  it('rejects a request without an Authorization header', async () => {
    await expectRejected(undefined, 'Authentication required');
  });

  it.each(['Basic dXNlcjpwYXNz', 'Token abc', 'Bearerabc', 'abc'])(
    'rejects the non-Bearer header "%s"',
    async (authorization) => {
      await expectRejected(authorization, 'Authentication required');
    },
  );

  it('rejects an expired token with "Token expired"', async () => {
    const expired = await craftToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await expectRejected(`Bearer ${expired}`, 'Token expired');
  });

  it.each([
    ['an empty token', async () => ''],
    ['an empty token after whitespace', async () => '   '],
    ['a value that is not a JWT', async () => 'not-a-token'],
    ['a token signed with another secret', () => craftToken({ secret: 'some-other-secret-of-at-least-32-chars' })],
    [
      'an expired token signed with another secret',
      () => craftToken({ secret: 'some-other-secret-of-at-least-32-chars', expiresAt: 1 }),
    ],
    [
      'a token whose payload was tampered with',
      async () => {
        const [header, , signature] = (await craftToken()).split('.');
        return [header, base64url({ sub: '1', username: 'admin', exp: 9999999999 }), signature].join('.');
      },
    ],
    [
      'an unsigned token (alg "none")',
      async () => `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: '1', username: 'x', exp: 9999999999 })}.`,
    ],
    ['a token without an expiry', () => craftToken({ expiresAt: null })],
    ['a token without a subject', () => craftToken({ sub: null })],
    ['a token with a non-numeric subject', () => craftToken({ sub: 'alice' })],
    ['a token without a username', () => craftToken({ claims: {} })],
  ])('rejects %s with "Invalid token"', async (_label, makeToken) => {
    await expectRejected(`Bearer ${await makeToken()}`, 'Invalid token');
  });
});

describe('Protected note creation (Requirement 14)', () => {
  let productId: number;

  beforeEach(async () => {
    productId = (await ctx.createProduct('Kettle')).id;
  });

  const storedNotes = async () => (await ctx.api.get(`/api/products/${productId}/notes`).expect(200)).body;

  it('creates the note when a valid token from login is sent', async () => {
    const auth = await ctx.authHeader();
    const res = await ctx.api.post(`/api/products/${productId}/notes`).set(auth).send({ content: 'Boils fast' });

    expect(res.status).toBe(201);
    expect(await storedNotes()).toEqual([res.body]);
  });

  it.each([
    ['no Authorization header', undefined, 'Authentication required'],
    ['a non-Bearer header', 'Basic dXNlcjpwYXNz', 'Authentication required'],
    ['a malformed token', 'Bearer abc.def.ghi', 'Invalid token'],
  ])('rejects a request with %s and creates nothing', async (_label, authorization, error) => {
    const req = ctx.api.post(`/api/products/${productId}/notes`);
    const res = await (authorization === undefined ? req : req.set('Authorization', authorization)).send({
      content: 'Sneaky',
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error });
    expect(await storedNotes()).toEqual([]);
  });

  it('rejects an expired token', async () => {
    const expired = await craftToken({ expiresAt: 1 });
    const res = await ctx.api
      .post(`/api/products/${productId}/notes`)
      .set('Authorization', `Bearer ${expired}`)
      .send({ content: 'Late' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token expired' });
  });

  it('checks authentication before looking up the product', async () => {
    const res = await ctx.api.post('/api/products/9999/notes').send({ content: 'Orphan' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('keeps every read endpoint open to anonymous users', async () => {
    await ctx.createNote(productId, 'Readable');

    await ctx.api.get('/api/products').expect(200);
    await ctx.api.get(`/api/products/${productId}`).expect(200);
    await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
  });

  it('protects product creation and note edits from anonymous callers', async () => {
    const note = await ctx.createNote(productId, 'Original');

    // Product creation now requires a login: an anonymous POST is rejected.
    await ctx.api.post('/api/products').send({ name: 'Toaster' }).expect(401);
    // Note editing also requires a login (notes-edit-auth): an anonymous PUT is rejected.
    await ctx.api.put(`/api/notes/${note.id}`).send({ content: 'Edited' }).expect(401);
  });
});

describe('Protected deletion', () => {
  let productId: number;
  let noteId: number;

  beforeEach(async () => {
    productId = (await ctx.createProduct('Kettle')).id;
    noteId = (await ctx.createNote(productId, 'Boils fast')).id;
  });

  const storedNotes = async () => (await ctx.api.get(`/api/products/${productId}/notes`).expect(200)).body;

  const endpoints = [
    ['DELETE /api/products/:id', () => `/api/products/${productId}`],
    ['DELETE /api/notes/:id', () => `/api/notes/${noteId}`],
  ] as const;

  describe.each(endpoints)('%s', (_name, path) => {
    it('deletes when a valid token from login is sent', async () => {
      const auth = await ctx.authHeader();
      const res = await ctx.api.delete(path()).set(auth);
      expect(res.status).toBe(200);
    });

    it.each([
      ['no Authorization header', undefined, 'Authentication required'],
      ['a non-Bearer header', 'Basic dXNlcjpwYXNz', 'Authentication required'],
      ['a malformed token', 'Bearer abc.def.ghi', 'Invalid token'],
    ])('rejects a request with %s and deletes nothing', async (_label, authorization, error) => {
      const req = ctx.api.delete(path());
      const res = await (authorization === undefined ? req : req.set('Authorization', authorization));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error });
      expect(await storedNotes()).toHaveLength(1);
    });

    it('rejects a token signed with another secret and deletes nothing', async () => {
      const forged = await craftToken({ secret: 'another-secret-that-is-at-least-32-characters' });
      const res = await ctx.api.delete(path()).set('Authorization', `Bearer ${forged}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid token' });
      expect(await storedNotes()).toHaveLength(1);
    });

    it('rejects an expired token and deletes nothing', async () => {
      const expired = await craftToken({ expiresAt: 1 });
      const res = await ctx.api.delete(path()).set('Authorization', `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Token expired' });
      expect(await storedNotes()).toHaveLength(1);
    });
  });

  it.each(['/api/products/9999', '/api/notes/9999'])(
    'checks authentication before looking up the record (%s)',
    async (path) => {
      const res = await ctx.api.delete(path);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Authentication required' });
    },
  );
});

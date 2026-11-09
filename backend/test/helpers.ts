import request from 'supertest';
import { createApp } from '../src/app.js';
import { IN_MEMORY, openDatabase } from '../src/db/database.js';

export const FRONTEND_ORIGIN = 'http://localhost:5173';
export const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
export const TEST_PASSWORD = 'correct horse battery';

export function createTestContext() {
  const db = openDatabase(IN_MEMORY);
  // The minimum bcrypt cost keeps the suite fast; the hashing itself is the same.
  const app = createApp({ db, corsOrigins: [FRONTEND_ORIGIN], jwtSecret: TEST_JWT_SECRET, bcryptRounds: 4 });
  const api = request(app);

  const register = async (username: string, password = TEST_PASSWORD) => {
    const res = await api.post('/api/auth/register').send({ username, password }).expect(201);
    return res.body as { id: number; username: string };
  };

  const login = async (username: string, password = TEST_PASSWORD) => {
    const res = await api.post('/api/auth/login').send({ username, password }).expect(200);
    return res.body.token as string;
  };

  // Registers and logs in a default user the first time an authenticated request is needed.
  let token: Promise<string> | undefined;
  const authHeader = async () => {
    token ??= register('tester').then(() => login('tester'));
    return { Authorization: `Bearer ${await token}` };
  };

  const createProduct = async (name: string) => {
    // Creating a product now requires a login; send a valid token.
    const auth = await authHeader();
    const res = await api.post('/api/products').set(auth).send({ name }).expect(201);
    return res.body as { id: number; name: string; createdAt: string };
  };

  const createNote = async (productId: number, content: string) => {
    // Resolve the header first: supertest requests must not be left pending across an await.
    const auth = await authHeader();
    const res = await api.post(`/api/products/${productId}/notes`).set(auth).send({ content }).expect(201);
    return res.body as { id: number; productId: number; content: string; createdAt: string };
  };

  return { db, app, api, register, login, authHeader, createProduct, createNote };
}

export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

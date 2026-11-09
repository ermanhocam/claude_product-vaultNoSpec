import cors from 'cors';
import express, { type Express } from 'express';
import { createAuthMiddleware } from './auth/middleware.js';
import { createPasswordHasher } from './auth/passwords.js';
import { createTokenService } from './auth/tokens.js';
import type { Database } from './db/database.js';
import { createNoteRepository, createProductRepository, createUserRepository } from './db/repositories.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createNotesRouter } from './routes/notes.js';
import { createProductsRouter } from './routes/products.js';

export interface AppOptions {
  db: Database;
  corsOrigins: string[];
  jwtSecret: string;
  /** bcrypt cost factor. Tests lower it to keep hashing fast. */
  bcryptRounds?: number;
}

export function createApp({ db, corsOrigins, jwtSecret, bcryptRounds }: AppOptions): Express {
  const products = createProductRepository(db);
  const notes = createNoteRepository(db);
  const users = createUserRepository(db);
  const tokens = createTokenService(jwtSecret);
  const requireAuth = createAuthMiddleware(tokens);

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', createAuthRouter(users, createPasswordHasher(bcryptRounds), tokens));
  app.use('/api/products', createProductsRouter(products, notes, requireAuth));
  app.use('/api/notes', createNotesRouter(notes, requireAuth));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

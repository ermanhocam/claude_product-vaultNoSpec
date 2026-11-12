import type { RequestHandler } from 'express';
import { MESSAGES, unauthorized } from '../errors.js';
import { type AuthUser, TokenError, type TokenService } from './tokens.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the auth middleware once the bearer token has been verified. */
      user?: AuthUser;
    }
  }
}

// The scheme name is case-insensitive (RFC 7235). The token part is optional here because HTTP
// parsing strips trailing whitespace: a client's "Bearer " (empty token) arrives as "Bearer".
const BEARER = /^Bearer(?:\s+(.*))?$/i;

/** Verifies `token` and attaches the user to `req`, translating token failures to 401s. */
async function attachUser(req: Parameters<RequestHandler>[0], tokens: TokenService, token: string): Promise<void> {
  try {
    req.user = await tokens.verify(token);
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    throw unauthorized(error.reason === 'expired' ? MESSAGES.tokenExpired : MESSAGES.invalidToken);
  }
}

/**
 * Lets a request through only with a valid `Authorization: Bearer <token>` header, and
 * attaches the token's user as `req.user`. Rejections become `401 { "error": ... }`
 * through the error handler, and the route handler is never called.
 */
export function createAuthMiddleware(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const match = BEARER.exec(req.get('Authorization') ?? '');
    if (!match) throw unauthorized(MESSAGES.authenticationRequired);

    const token = match[1]?.trim();
    if (!token) throw unauthorized(MESSAGES.invalidToken);

    await attachUser(req, tokens, token);
    next();
  };
}

/**
 * Attaches `req.user` when a valid bearer token is present, but lets requests without any
 * `Authorization` header through as anonymous (`req.user` stays undefined). A header that
 * is present but malformed, invalid or expired is still rejected with 401, so a broken
 * session gets a clear error rather than silently falling back to anonymous access.
 * Used for endpoints that are public but offer extra behaviour to logged-in users.
 */
export function createOptionalAuthMiddleware(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('Authorization');
    if (header === undefined || header === '') {
      next();
      return;
    }
    const match = BEARER.exec(header);
    if (!match) throw unauthorized(MESSAGES.invalidToken);

    const token = match[1]?.trim();
    if (!token) throw unauthorized(MESSAGES.invalidToken);

    await attachUser(req, tokens, token);
    next();
  };
}

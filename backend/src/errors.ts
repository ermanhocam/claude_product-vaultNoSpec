import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message: string) => new HttpError(401, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export const MESSAGES = {
  malformedJson: 'Request body could not be parsed: malformed JSON',
  routeNotFound: 'Route not found',
  internal: 'An unexpected error occurred',
  authenticationRequired: 'Authentication required',
  tokenExpired: 'Token expired',
  invalidToken: 'Invalid token',
  invalidCredentials: 'Invalid credentials',
  usernameTaken: 'Username is already taken',
} as const;

/** Shape of errors raised by Express' JSON body parser (body-parser / http-errors). */
interface BodyParserError {
  type: string;
  status: number;
  expose: boolean;
  message: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as BodyParserError).type === 'string' &&
    typeof (err as BodyParserError).status === 'number'
  );
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: MESSAGES.routeNotFound });
};

/**
 * Converts every error into a JSON response. Unexpected errors are logged
 * server-side and reported to the client with a generic message only.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (isBodyParserError(err) && err.status >= 400 && err.status < 500) {
    const message = err.type === 'entity.parse.failed' ? MESSAGES.malformedJson : err.message;
    res.status(err.status).json({ error: err.expose ? message : 'Bad request' });
    return;
  }

  console.error('Unhandled error while processing request:', err);
  res.status(500).json({ error: MESSAGES.internal });
};

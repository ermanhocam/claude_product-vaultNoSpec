import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  corsOrigins: string[];
  /** HMAC secret for signing login tokens; `undefined` when JWT_SECRET is not set. */
  jwtSecret: string | undefined;
}

const DEFAULT_PORT = 3001;
// HS256 keys should be at least as long as the 256-bit hash output.
const JWT_SECRET_MIN_LENGTH = 32;
const DEFAULT_HOST = 'localhost';
const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/product-vault.db', import.meta.url));
// Vite dev server (5173) and `vite preview` (4173), on both common loopback hostnames.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parsePort(env.PORT),
    host: env.HOST?.trim() || DEFAULT_HOST,
    dbPath: env.DB_PATH?.trim() || DEFAULT_DB_PATH,
    corsOrigins: parseList(env.CORS_ORIGINS) ?? DEFAULT_CORS_ORIGINS,
    jwtSecret: parseJwtSecret(env.JWT_SECRET),
  };
}

function parseJwtSecret(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (value.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`Invalid JWT_SECRET: expected at least ${JWT_SECRET_MIN_LENGTH} characters`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${value}": expected an integer between 0 and 65535`);
  }
  return port;
}

function parseList(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

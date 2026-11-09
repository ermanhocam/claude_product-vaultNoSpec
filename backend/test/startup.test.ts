import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { describeStartupError } from '../src/server.js';

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const children: ChildProcess[] = [];
const blockers: Server[] = [];
const tempDirs: string[] = [];

interface RunResult {
  output: string;
  exitCode: number | null;
}

/** Launches the real entry point exactly like `npm start` does (tsx + node:sqlite). */
function startBackend(env: Record<string, string>) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--disable-warning=ExperimentalWarning', 'src/index.ts'],
    { cwd: BACKEND_DIR, env: { ...process.env, HOST: '127.0.0.1', ...env } },
  );
  children.push(child);

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const waitFor = (pattern: RegExp, timeoutMs = 15_000) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}. Output:\n${output}`)), timeoutMs);
      const check = () => {
        const match = output.match(pattern);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      child.stdout.on('data', check);
      child.stderr.on('data', check);
      check();
    });

  const exited = new Promise<RunResult>((resolve) => {
    child.on('exit', (exitCode) => resolve({ output, exitCode }));
  });

  return { child, waitFor, exited };
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'product-vault-startup-'));
  tempDirs.push(dir);
  return join(dir, 'data', 'app.db');
}

function occupyPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    blockers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  await Promise.all(blockers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Application startup (Requirement 8)', () => {
  it('logs a ready message with its URL, creates the database automatically and serves requests', async () => {
    const dbPath = tempDbPath();
    const backend = startBackend({ PORT: '0', DB_PATH: dbPath });

    const ready = await backend.waitFor(/ready and listening at (http:\/\/\S+)/);
    const url = ready.split(' at ')[1]!;

    expect(existsSync(dbPath)).toBe(true);
    const res = await fetch(`${url}/api/products`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('exits with a clear message when the port is already in use', async () => {
    const { port } = await occupyPort();
    const backend = startBackend({ PORT: String(port), DB_PATH: tempDbPath() });

    const { output, exitCode } = await backend.exited;

    expect(exitCode).toBe(1);
    expect(output).toContain(`Port ${port} is already in use`);
  });
});

describe('describeStartupError', () => {
  it('explains port conflicts', () => {
    const error = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    expect(describeStartupError(error, 3001)).toMatch(/^Port 3001 is already in use/);
  });

  it('falls back to the underlying error message', () => {
    expect(describeStartupError(new Error('boom'), 3001)).toBe('Failed to start the server: boom');
  });
});

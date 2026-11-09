import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Starts listening and resolves once the port is bound; rejects on errors such as EADDRINUSE. */
export function listen(handler: RequestListener, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

export function serverUrl(server: Server, host: string): string {
  const { port } = server.address() as AddressInfo;
  const displayHost = host.includes(':') ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

/** Human-readable explanation for common startup failures. */
export function describeStartupError(error: unknown, port: number): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Stop the process using it or set the PORT environment variable to a different port.`;
  }
  if (code === 'EACCES') {
    return `Permission denied to listen on port ${port}. Choose a different port with the PORT environment variable.`;
  }
  return `Failed to start the server: ${error instanceof Error ? error.message : String(error)}`;
}

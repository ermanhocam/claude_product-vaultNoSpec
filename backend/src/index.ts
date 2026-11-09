import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { describeStartupError, listen, serverUrl } from './server.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
// Without JWT_SECRET a random secret keeps the app zero-config; logins then end when the API restarts.
const jwtSecret = config.jwtSecret ?? randomBytes(32).toString('base64url');
const app = createApp({ db, corsOrigins: config.corsOrigins, jwtSecret });

try {
  const server = await listen(app, config.port, config.host);
  console.log(`Product Vault API is ready and listening at ${serverUrl(server, config.host)}`);
  console.log(`Using SQLite database at ${config.dbPath}`);
  if (!config.jwtSecret) {
    console.log('JWT_SECRET is not set: using a random signing secret, so logins last until the API restarts.');
  }

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(`Error: ${describeStartupError(error, config.port)}`);
  db.close();
  process.exit(1);
}

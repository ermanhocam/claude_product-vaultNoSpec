# Product Vault

A personal product notes app: keep a list of products you buy, try or consider, and record notes about each one.

- **Frontend:** React 19 single-page app (Vite, React Router), in [`frontend/`](frontend)
- **Backend:** Express 5 REST API in TypeScript, in [`backend/`](backend)
- **Database:** SQLite through Node's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module, so there is no database server and no native add-on to compile
- **Accounts:** register and log in with a username and password. Anyone can browse products and read notes; adding a note and deleting a product or a note require a login. Passwords are hashed with bcrypt and sessions use JSON Web Tokens.

## Prerequisites

- **Node.js 22.13 or newer** (this provides `node:sqlite`) and npm

That's all. You don't need a database server, Docker, or a C++ build toolchain.

## Quick start

```bash
npm install
```

```bash
npm start
```

Then open <http://localhost:5173>. `npm start` runs the API (port 3001) and the web app (port 5173) side by side. The SQLite database is created automatically at `backend/data/product-vault.db` the first time the API starts.

### Starting each part on its own

After `npm install` at the root:

| What | Command (from the repo root) | Or, from its folder |
| --- | --- | --- |
| Backend API | `npm run start:backend` | `cd backend && npm start` |
| Frontend | `npm run start:frontend` | `cd frontend && npm start` |
| Both, with file watching | `npm run dev` | |

When the backend is ready it prints its URL:

```
Product Vault API is ready and listening at http://localhost:3001
```

Unless `JWT_SECRET` is set, it also says it generated a random signing secret: logins then last until the API restarts.

If a port is taken, startup stops with an explicit message, for example `Error: Port 3001 is already in use.` from the API or `Error: Port 5173 is already in use` from Vite.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start backend and frontend together |
| `npm run dev` | Same, with the backend restarting on file changes |
| `npm test` | Run the backend and frontend test suites |
| `npm run typecheck` | Type-check both workspaces |
| `npm run build` | Production build of the frontend into `frontend/dist` |
| `npm run verify` | Type check and tests together |

## Configuration

All settings are optional environment variables.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | backend | `3001` | API port |
| `HOST` | backend | `localhost` | Interface to bind to |
| `DB_PATH` | backend | `backend/data/product-vault.db` | SQLite database file (parent folders are created) |
| `JWT_SECRET` | backend | random per start | Secret for signing login tokens, at least 32 characters. Set it to keep users logged in across restarts |
| `CORS_ORIGINS` | backend | `http://localhost:5173`, `http://127.0.0.1:5173`, plus the same on `4173` | Comma-separated origins allowed to call the API |
| `VITE_API_URL` | frontend | `http://localhost:3001` | Base URL of the API |

If you change ports, keep `VITE_API_URL` and `CORS_ORIGINS` consistent with them.

## REST API

All requests and responses use JSON. Errors have the shape `{ "error": "message" }`.

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| `GET` | `/api/products` | `200`, products newest first | |
| `POST` | `/api/products` | `201`, created product | `400` validation |
| `GET` | `/api/products/:id` | `200`, product with `notes` newest first | `404` |
| `GET` | `/api/products/:id/notes` | `200`, notes newest first | `404` |
| `POST` | `/api/products/:id/notes` | `201`, created note. **Requires a login token** | `400`, `401`, `404` |
| `DELETE` | `/api/products/:id` | `200`, `{ "id": 1, "deleted": true }`; the product's notes are deleted too. **Requires a login token** | `401`, `404` |
| `PUT` | `/api/notes/:id` | `200`, updated note | `400`, `404` |
| `DELETE` | `/api/notes/:id` | `200`, `{ "id": 1, "deleted": true }`. **Requires a login token** | `401`, `404` |
| `POST` | `/api/auth/register` | `201`, `{ "id": 1, "username": "alice" }` | `400`, `409` username taken |
| `POST` | `/api/auth/login` | `200`, `{ "token": "<JWT>" }` | `400`, `401` |
| `GET` | `/api/health` | `200`, `{ "status": "ok" }` | |

```jsonc
// Product
{ "id": 1, "name": "Moka pot", "createdAt": "2026-10-21T12:24:03.512Z" }
// Note
{ "id": 7, "productId": 1, "content": "Brews in 5 minutes", "createdAt": "2026-10-21T12:25:41.090Z" }
```

Behaviour details:

- **Authentication.** Register with `{ "username", "password" }`, then log in with the same body to get a token valid for 24 hours. Send it as `Authorization: Bearer <token>` to create notes and to delete products or notes. Without a valid token, these requests return `401` with `Authentication required`, `Invalid token` or `Token expired`, before the product or note is looked up. Any logged-in user may delete any product or note. Reading and creating products, and editing notes, don't need a token.
- **Credentials.** Usernames are 3–50 letters, digits, hyphens or underscores, unique regardless of letter case. Passwords are 8–128 characters and are never trimmed. A wrong username or password returns `401` with `Invalid credentials`.
- **Validation.** Leading and trailing whitespace is trimmed before validation and storage. Product names must be 1–200 characters and note content 1–5000 characters. Characters are counted as Unicode code points, so an emoji counts as one.
- **Malformed JSON** returns `400` with `Request body could not be parsed: malformed JSON`.
- **Unexpected errors** return `500` with a generic `An unexpected error occurred`. Details are logged on the server only.
- **Invalid ids** that aren't positive integers (such as `/api/products/abc`) are treated as not found and return `404`.
- **Deleting a product** also deletes all of its notes, in one transaction: either everything goes or nothing does. The app asks for confirmation first, on the product's page and on its card in the list. The Delete actions for products and notes are shown only to logged-in users.

## Data model

```sql
products (id INTEGER PK AUTOINCREMENT, name TEXT ≤255 chars, created_at TEXT ISO-8601)
notes    (id INTEGER PK AUTOINCREMENT, product_id → products.id ON DELETE RESTRICT,
          content TEXT ≤10,000 chars, created_at TEXT ISO-8601)
users    (id INTEGER PK AUTOINCREMENT, username TEXT UNIQUE (case-insensitive) ≤150 chars,
          password_hash TEXT bcrypt, created_at TEXT ISO-8601)
```

Tables are created with `CREATE TABLE IF NOT EXISTS` whenever the API starts, so no migration step is needed. Foreign keys are enforced, so the database refuses to delete a product that still has notes; the API's product delete removes the notes first, in the same transaction. The schema's length limits are deliberately looser than the API's validation limits.

## Project structure

```
backend/
  src/
    index.ts            entry point: config → database → HTTP server
    app.ts              Express app (CORS, JSON parsing, routes, error handling)
    config.ts           environment variables
    server.ts           listening and startup error messages
    validation.ts       request validation rules
    errors.ts           HttpError and JSON error/404 handlers
    auth/               password hashing (bcrypt), tokens (JWT), Bearer-token middleware
    db/database.ts      SQLite connection and schema
    db/repositories.ts  product, note and user queries
    routes/             /api/auth, /api/products and /api/notes routers
  test/                 API, auth, database, config and startup tests (Vitest + Supertest)
frontend/
  src/
    api/client.ts       typed fetch wrapper and ApiError; sends the login token
    auth/               token storage and decoding, AuthProvider / useAuth
    pages/              product list, product detail, login, register, not found
    components/         forms, note entry (edit/delete), product delete, text field, feedback
    lib/                formatting, validation, data loading hook
    test/               MSW fake backend, test setup and helpers
    styles.css          card-based UI (dark top bar, white cards, indigo accents)
```

## Testing

```bash
npm test
```

- **Backend** (`backend/test`): HTTP-level tests for every endpoint, run against an in-memory database. They include registration and login rules, and expired, tampered, unsigned and wrongly signed tokens. Database tests cover the schema (including the users table), constraints, foreign-key protection and the all-or-nothing product delete. Startup tests launch the real server process to check the ready message, automatic database creation and the port-in-use error.
- **Frontend** (`frontend/src/**/*.test.ts(x)`): React Testing Library tests running against an in-memory fake backend served by [Mock Service Worker](https://mswjs.io) (`frontend/src/test/mockApi.ts`). The real API client and `fetch` run in every test. They cover loading, empty and error states, an unreachable backend, creating products and notes without a page reload, client-side and server validation, delete confirmation and cancellation for notes and products, and editing. Auth tests cover login, registration, session restore and expiry, logout, the note form and the Delete actions shown only when logged in, and the redirect to the login page when the API rejects a session.

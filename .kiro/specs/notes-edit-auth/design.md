# Design Document

## Overview

This feature closes the open edit hole on notes. Today `PUT /api/notes/:noteId` has no `requireAuth` and any caller can rewrite any note, while the frontend always renders the Edit control. The design makes the backend the real gate: editing requires authentication and succeeds only for the user who authored the note. The frontend mirrors that by hiding the Edit control when the viewer cannot edit.

Author-only editing needs the author to be persisted. The `notes` table has no author column, so the design adds a nullable `author_id` foreign key to `users`, records the creating user on note creation, and exposes an `author` field on the Note payload. The server already has a user id available in every authenticated request (`AuthUser.id`, from the JWT `sub`), so the shared identifier is that numeric user id. The frontend currently exposes only `{ username }`; the design surfaces the user id to the frontend so the two sides can compare authorship directly.

### Resolved design decisions (deferred from requirements)

These three decisions were flagged in requirements as design-phase choices. This section states each chosen default and the reasoning, so the rest of the design builds on them.

**(a) Authorless-note authorization outcome — Requirement 2.3: refuse the edit (403).**
During the clarify phase the "authorless notes are editable by anyone" option was deliberately not selected. The safe, consistent reading of an author-only rule is therefore: a note with no recorded author belongs to nobody, so nobody may edit it. An authorless note (`author_id IS NULL`) produces the same outcome as a note owned by a different user: HTTP 403, note unchanged. This is the conservative default — it never grants an edit the system cannot attribute — and it keeps the ownership check as a single comparison (`note.author === req.user.id`), which is false when `note.author` is `null`. If the product later wants legacy notes to be adoptable or openly editable, that is an additive change against this baseline.

**(b) Migration / backfill strategy — Requirement 3.4: additive `ALTER TABLE ADD COLUMN`, existing rows keep NULL.**
The database uses a single idempotent `SCHEMA` string run on every startup (`openDatabase`), with no migration framework. The backward-compatible approach that fits this pattern is to add a nullable column: `ALTER TABLE notes ADD COLUMN author_id INTEGER REFERENCES users(id)`. New databases get the column from the fresh `CREATE TABLE`; existing databases get it added once, and every pre-existing row keeps `author_id = NULL`, becoming an Authorless_Note. No data is rewritten and no row is lost. Because `node:sqlite` has no "add column if not exists", the migration checks `PRAGMA table_info(notes)` and only runs the `ALTER` when the column is absent, so startup stays idempotent. A nullable column (rather than `NOT NULL DEFAULT`) is required precisely because existing rows have no real author — NULL is the honest representation of "unknown author".

**(c) Shared Author_Identifier shape and how it reaches the frontend — Requirement 4: the numeric `users.id`.**
The identifier is the integer primary key `users.id`. It is already the JWT `sub` claim and already present server-side as `AuthUser.id`, so no new identity concept is introduced. It surfaces in two matching places:
- On the Note payload as `author: number | null` (the `author_id`, or `null` for an authorless note).
- On the frontend current user as `user.id: number`, decoded from the token's `sub` claim.

Both are the same numeric kind, so the frontend comparison is `user.id === note.author`. The login flow needs one addition: the token today carries `sub` (the id) and a `username` claim, but the frontend `decodeSession` only reads `username`/`exp`. The design extends `decodeSession` to also read the numeric `sub`, so the id reaches the frontend without any server change to the token itself. (The server already signs `sub = user.id`; see `tokens.ts`.)

## Architecture

The change spans the existing layers without adding new ones. The arrows show how an authenticated edit flows and where the two new gates sit.

```
Frontend                              Backend
--------                              -------
ProductDetailPage                     notes router  PUT /:noteId
  useAuth().user.id  ──gate──►          requireAuth (NEW)  ──► 401 if no valid token
    renders NoteItem                    requireNote lookup ──► 404 if missing
      with/without onSave               ownership check (NEW) ──► 403 if author != user.id
                                        notes.update
AuthContext / session                 note repository
  decodeSession reads sub (NEW)         author_id column (NEW)
    user = { id, username }             create(productId, content, authorId) (CHANGED)
                                      database schema
                                        notes.author_id INTEGER REFERENCES users(id) (NEW)
                                        + ALTER migration for existing DBs (NEW)
```

Layer responsibilities:

- **Schema / migration** (`database.ts`) — owns the `author_id` column and the one-time additive migration for existing databases.
- **Repository** (`repositories.ts`) — owns persistence of the author and surfacing it on the `Note` object. `create` gains an `authorId` parameter; `Note`/`NoteRow` gain an `author` field.
- **Routes** (`notes.ts`, `products.ts`) — own the gates. `PUT /api/notes/:noteId` adds `requireAuth` before the lookup (mirroring the existing `DELETE` pattern) and adds the 403 ownership check. `POST /:productId/notes` passes `req.user.id` into `notes.create`.
- **Token decode** (`session.ts`) — surfaces the numeric id from the JWT to the frontend.
- **Auth context** (`AuthContext.tsx`) — exposes `user.id` alongside `username`.
- **Page** (`ProductDetailPage.tsx`) — gates the per-note edit handler by comparing `user.id` to `note.author`.
- **Note item** (`NoteItem.tsx`) — makes `onSave` optional and hides Edit when it is absent, mirroring the existing optional `onDelete`.

## Components and Interfaces

### Schema change and migration (`backend/src/db/database.ts`)

Add the column to the `CREATE TABLE` in the `SCHEMA` string so fresh databases have it:

```ts
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  content    TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 10000),
  author_id  INTEGER          REFERENCES users (id),          -- nullable: NULL = Authorless_Note
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

For databases created before this feature, `CREATE TABLE IF NOT EXISTS` is a no-op, so an explicit additive migration runs after the schema is applied:

```ts
/** Adds notes.author_id to databases created before the column existed. Idempotent. */
function migrateNotesAuthor(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
  const hasAuthor = columns.some((column) => column.name === 'author_id');
  if (!hasAuthor) {
    db.exec('ALTER TABLE notes ADD COLUMN author_id INTEGER REFERENCES users (id)');
  }
}
```

`openDatabase` calls `migrateNotesAuthor(db)` after `db.exec(SCHEMA)`. Existing rows keep `author_id = NULL` (Authorless_Notes); no row is rewritten or removed. The column is deliberately nullable — there is no truthful author to backfill for legacy rows.

> Note on foreign keys: `ALTER TABLE ... ADD COLUMN` with a `REFERENCES` clause adds the column with the constraint for future rows; SQLite does not retro-validate existing rows, and existing rows hold `NULL`, which satisfies a nullable FK regardless. `PRAGMA foreign_keys = ON` stays as-is.

### Repository changes (`backend/src/db/repositories.ts`)

`Note` and `NoteRow` gain the author field; `author` is the public payload name, `author_id` the column:

```ts
export interface Note {
  id: number;
  productId: number;
  content: string;
  author: number | null;   // NEW: Author_Identifier, or null for an Authorless_Note
  createdAt: string;
}

interface NoteRow {
  id: number;
  product_id: number;
  content: string;
  author_id: number | null; // NEW
  created_at: string;
}

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  productId: row.product_id,
  content: row.content,
  author: row.author_id,    // NEW
  createdAt: row.created_at,
});

const NOTE_COLUMNS = 'id, product_id, content, author_id, created_at';
```

`create` takes the author id and persists it; `update` is unchanged (it rewrites content only and preserves `author_id`):

```ts
const insert = db.prepare(
  `INSERT INTO notes (product_id, content, author_id) VALUES (?, ?, ?) RETURNING ${NOTE_COLUMNS}`,
);

create(productId: number, content: string, authorId: number): Note {
  return toNote(insert.get(productId, content, authorId) as unknown as NoteRow);
}
```

`findById`, `findByProductId`, `update`, and `delete` keep their signatures; they return the richer `Note` (now including `author`) automatically via the expanded `NOTE_COLUMNS` and `toNote`.

### Route changes

**`PUT /api/notes/:noteId` (`backend/src/routes/notes.ts`)** — add `requireAuth` before the lookup (mirroring the existing `DELETE` handler so anonymous callers get 401 without learning which ids exist), then enforce ownership before updating:

```ts
import { forbidden } from '../errors.js';

router.put('/:noteId', requireAuth, (req: Request<{ noteId: string }>, res) => {
  const note = requireNote(req.params.noteId);        // 404 if missing (after auth)
  if (note.author !== req.user!.id) throw forbidden('You can only edit your own notes');
  res.json(notes.update(note.id, parseNoteContent(req.body)));
});
```

Outcome matrix for `PUT`:

| Caller | Note state | Result |
| --- | --- | --- |
| No/invalid token | any | 401, no lookup, no change (Req 1.1, 1.2) |
| Authenticated | note missing | 404 (Req 1.3) |
| Authenticated, is author | authored note | 200 + updated note (Req 2.1) |
| Authenticated, not author | authored by someone else | 403, no change (Req 2.2) |
| Authenticated | authorless (`author === null`) | 403, no change (Req 2.3 — decision a) |

The authorless case needs no special branch: `note.author` is `null`, `req.user.id` is a number, so `note.author !== req.user.id` is true and the request is refused.

**`POST /:productId/notes` (`backend/src/routes/products.ts`)** — capture the authenticated creator (the handler already has `requireAuth`):

```ts
router.post('/:productId/notes', requireAuth, (req: Request<{ productId: string }>, res) => {
  const product = requireProduct(req.params.productId);
  const note = notes.create(product.id, parseNoteContent(req.body), req.user!.id);
  res.status(201).location(`/api/notes/${note.id}`).json(note);
});
```

`forbidden` is added to `backend/src/errors.ts` alongside the existing `unauthorized`/`notFound` helpers if it does not already exist, returning HTTP 403 with the standard `{ error }` body.

### Token / response changes to surface the user id (`backend/src/auth/tokens.ts`, `backend/src/routes/auth.ts`)

No server-side change is required to the token: `tokens.sign` already sets `sub = user.id` and a `username` claim, and `tokens.verify` already returns `{ id, username }`. The id therefore already travels in the token the login route returns. The only gap is on the client, which never reads `sub`. (If the team prefers an explicit id in the login response body in addition to the token, `POST /auth/login` could return `{ token, user: { id, username } }`; this design keeps the single-source-of-truth in the token and decodes it on the client, avoiding a second place that can drift.)

### Frontend session decode (`frontend/src/auth/session.ts`)

Extend `Session` and `decodeSession` to read the numeric `sub`:

```ts
export interface Session {
  id: number;          // NEW: Author_Identifier (numeric users.id from JWT sub)
  username: string;
  expiresAt: number;
}

export function decodeSession(token: string): Session | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(decodeBase64Url(payload));
    const { sub, username, exp } = (claims ?? {}) as { sub?: unknown; username?: unknown; exp?: unknown };
    const id = typeof sub === 'string' ? Number(sub) : NaN;
    if (!Number.isInteger(id) || typeof username !== 'string' || typeof exp !== 'number') return null;
    return { id, username, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}
```

`sub` is a string in JWTs (the server signs `String(user.id)`), so the client parses it back to a number to match `note.author`'s numeric kind. A token whose `sub` is missing or non-numeric is rejected as unreadable, exactly as a missing `username` already is.

### Frontend auth context (`frontend/src/auth/AuthContext.tsx`)

Expose the id on the current user:

```ts
interface AuthContextValue {
  user: { id: number; username: string } | null;   // id NEW
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const value = useMemo<AuthContextValue>(
  () => ({ user: session && { id: session.id, username: session.username }, login, logout }),
  [session, login, logout],
);
```

### Frontend Note type (`frontend/src/types.ts`)

Mirror the payload field so the page can compare it:

```ts
export interface Note {
  id: number;
  productId: number;
  content: string;
  author: number | null;   // NEW
  createdAt: string;
}
```

### Frontend edit-handler gating (`frontend/src/pages/ProductDetailPage.tsx`)

Gate `onSave` the same way `onDelete` is gated today — the handler is passed only when the viewer is the author:

```tsx
{product.notes.map((note) => {
  const canEdit = user != null && user.id === note.author;
  return (
    <NoteItem
      key={note.id}
      note={note}
      onSave={canEdit ? (content) => saveNote(note.id, content) : undefined}
      onDelete={user ? () => deleteNote(note.id) : undefined}
    />
  );
})}
```

`canEdit` is false when `user` is `null` (Req 5.1) and when `user.id` does not equal `note.author`, including the authorless case where `note.author` is `null` (Req 5.2); it is true only when the ids match (Req 5.3). This is client-side convenience only — the backend remains the real gate.

### Frontend note item (`frontend/src/components/NoteItem.tsx`)

Make `onSave` optional and hide Edit when it is absent, mirroring the existing optional `onDelete`:

```tsx
interface NoteItemProps {
  note: Note;
  /** Leave out to hide the Edit action (editing needs to be the author). */
  onSave?: (content: string) => Promise<void>;
  /** Leave out to hide the Delete action (deleting needs a login). */
  onDelete?: () => Promise<void>;
}
```

In the actions row the Edit button renders only when `onSave` is provided (same guard shape as `{onDelete && ...}`):

```tsx
{onSave && (
  <button ref={editButtonRef} className="text-button" type="button" onClick={startEditing}>
    Edit<span className="visually-hidden"> note from {timestamp}</span>
  </button>
)}
```

`save()` already calls `onSave`; it is only reachable from the editor, which is only reachable through the Edit button, so the optional handler is never invoked when absent. (Req 5.4.)

## Data Models

### `Note` (backend and frontend payload)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `number` | unchanged |
| `productId` | `number` | unchanged |
| `content` | `string` | unchanged |
| `author` | `number \| null` | NEW — Author_Identifier (`users.id`); `null` for an Authorless_Note (Req 4.1, 4.2) |
| `createdAt` | `string` | unchanged |

### `notes` table

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | unchanged |
| `product_id` | INTEGER NOT NULL FK products(id) | unchanged |
| `content` | TEXT NOT NULL CHECK len 1..10000 | unchanged |
| `author_id` | INTEGER NULL FK users(id) | NEW — nullable; NULL for pre-feature rows |
| `created_at` | TEXT NOT NULL | unchanged |

### Current user (frontend)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `number` | NEW — same kind as `Note.author` (Req 4.3) |
| `username` | `string` | unchanged |

## Error Handling

- **401 Unauthorized** — `PUT /api/notes/:noteId` without a valid bearer token. `requireAuth` runs first, so the response is identical whether or not the note id exists (Req 1.1, 1.2). Produced by existing `createAuthMiddleware` + `unauthorized`.
- **404 Not Found** — authenticated `PUT` to a note id that does not exist, via the existing `requireNote` → `notFound` path, which runs only after auth (Req 1.3).
- **403 Forbidden** — authenticated `PUT` where `note.author !== req.user.id`, covering both a different author (Req 2.2) and an authorless note (Req 2.3). New `forbidden` helper; note is not modified.
- **Validation errors** — `parseNoteContent` continues to guard content length/shape and runs after the ownership check passes, so an unauthorized edit never reaches validation.
- **Frontend** — gating is defensive UI only; if a stale client somehow shows Edit, the backend still returns 403 and the existing `errorMessage`/`ApiError` flow surfaces it in the note editor. A token lacking a usable `sub` makes `decodeSession` return `null`, which the existing login/restore flow already treats as an unreadable session.

## Testing Strategy

The suite extends the existing tests rather than introducing new frameworks (backend: Vitest in `backend/test`; frontend: Vitest + Testing Library in `frontend/src`).

**Backend — `backend/test/notes.test.ts` (PUT auth + ownership):**
- Example: unauthenticated `PUT` (missing header, malformed header, empty bearer, expired/invalid token) → 401, note content unchanged (Req 1.1, 1.2).
- Example: unauthenticated `PUT` to existing vs non-existent id both → 401 (no existence leak) (Req 1.2).
- Example: authenticated `PUT` to non-existent note → 404 (Req 1.3).
- Property (P1): author updates own note → 200 and persisted content equals the new content, author unchanged (Req 2.1).
- Property (P2): a different authenticated user `PUT`s → 403 and content unchanged (Req 2.2).
- Edge: authenticated `PUT` to an authorless note (`author === null`) → 403, content unchanged (Req 2.3).

**Backend — `backend/test/products.test.ts` (creation records author):**
- Property (P3): authenticated `POST /:productId/notes` → created note's `author` equals the caller's id (Req 3.2, 3.3, 4.1).
- Example: created note payload includes `author` (Req 4.1).

**Backend — `backend/test/database.test.ts` (schema + migration):**
- Smoke: `notes` table has `author_id` referencing `users(id)` (Req 3.1).
- Example/integration: seed a legacy `notes` table without `author_id`, run `openDatabase`/`migrateNotesAuthor`, assert all rows survive with `author_id = NULL` and ids/content intact, and that re-running is a no-op (Req 3.4).
- Example: a note with `author_id = NULL` serializes to `author: null` (Req 4.2).

**Frontend — `frontend/src/pages/ProductDetailPage.test.tsx` (edit-control gating):**
- Example: no logged-in user → no note shows Edit (Req 5.1).
- Example: logged-in user with a mix of notes (own, another user's, authorless) → Edit shown only on own notes (Req 5.2, 5.3).

**Frontend — `frontend/src/components/NoteItem` and `frontend/src/auth/session.test.ts`:**
- Example: `NoteItem` with and without `onSave` → Edit control present only when `onSave` is provided, mirroring `onDelete`/Delete (Req 5.4).
- Example: `decodeSession` returns a numeric `id` from the token `sub`; a token with missing/non-numeric `sub` returns `null` (Req 4.3).

**Property test configuration:** property tests run a minimum of 100 iterations and each is tagged `Feature: notes-edit-auth, Property {number}: {property text}`. Example, edge, smoke, and integration cases run once.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: An author can update the content of their own note

*For any* authenticated user and any note that user authored and any valid replacement content, a `PUT /api/notes/:noteId` request from that user returns HTTP 200 and the persisted note's content equals the replacement content while its author remains unchanged.

**Validates: Requirements 2.1**

### Property 2: A non-author cannot change a note

*For any* two distinct authenticated users A and B and any note authored by A and any valid content, a `PUT /api/notes/:noteId` request from B returns HTTP 403 and the stored note's content is unchanged.

**Validates: Requirements 2.2**

### Property 3: Note creation records the authenticated creator as author

*For any* authenticated user and any existing product and any valid content, creating a note via `POST /api/products/:productId/notes` produces a stored note whose `author` equals that user's Author_Identifier.

**Validates: Requirements 3.2, 3.3**

### Property 4: The author identifier round-trips through persistence and payload

*For any* author identifier, product, and valid content, a note created with that author identifier and then read back exposes an `author` field on its payload equal to the identifier that was stored.

**Validates: Requirements 3.3, 4.1**

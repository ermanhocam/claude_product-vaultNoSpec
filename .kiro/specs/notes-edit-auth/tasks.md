# Implementation Plan: notes-edit-auth

## Overview

Implement author-only note editing end to end. The backend becomes the real gate: `PUT /api/notes/:noteId` requires authentication and succeeds only for the note's author, and note creation records the creating user. This requires persisting the author (`notes.author_id`, nullable FK to `users`) via an idempotent additive migration, surfacing it as `author` on the Note payload, and exposing the numeric user id to the frontend so it can hide the Edit control for notes the viewer cannot edit.

Tasks are ordered so persistence lands first (schema → repository), then the backend gates (errors helper → routes), then the frontend identity plumbing (session decode → auth context → types), and finally the UI gating (page → note item). Each step builds on the previous and ends wired into the running app. Property tests from the design are placed next to the code they validate.

## Tasks

- [x] 1. Add author column and idempotent migration to the schema
  - In `backend/src/db/database.ts`, add `author_id INTEGER REFERENCES users (id)` (nullable) to the `notes` `CREATE TABLE` in the `SCHEMA` string so fresh databases include it
  - Add a `migrateNotesAuthor(db)` function that reads `PRAGMA table_info(notes)` and only runs `ALTER TABLE notes ADD COLUMN author_id INTEGER REFERENCES users (id)` when the column is absent, keeping startup idempotent
  - Call `migrateNotesAuthor(db)` in `openDatabase` after `db.exec(SCHEMA)`; leave `PRAGMA foreign_keys = ON` as-is
  - _Requirements: 3.1, 3.4_

  - [x]* 1.1 Write schema + migration tests in `backend/test/database.test.ts`
    - Smoke: `notes` table has `author_id` referencing `users(id)` (Req 3.1)
    - Integration: seed a legacy `notes` table without `author_id`, run `openDatabase`/`migrateNotesAuthor`, assert all rows survive with `author_id = NULL` and ids/content intact, and that re-running is a no-op (Req 3.4)
    - Example: a note with `author_id = NULL` serializes to `author: null` (Req 4.2)
    - _Requirements: 3.1, 3.4, 4.2_

- [x] 2. Persist and surface the author in the note repository
  - [x] 2.1 Add the author field to `Note`, `NoteRow`, `toNote`, and `NOTE_COLUMNS` in `backend/src/db/repositories.ts`
    - Add `author: number | null` to `Note` and `author_id: number | null` to `NoteRow`
    - Map `author: row.author_id` in `toNote`; add `author_id` to `NOTE_COLUMNS` so `findById`/`findByProductId`/`update`/`delete` return the richer `Note` unchanged in signature
    - _Requirements: 4.1, 4.2_

  - [x] 2.2 Add the `authorId` parameter to `create` in `backend/src/db/repositories.ts`
    - Change the insert to `INSERT INTO notes (product_id, content, author_id) VALUES (?, ?, ?) RETURNING ${NOTE_COLUMNS}`
    - Change the signature to `create(productId: number, content: string, authorId: number): Note` and pass `authorId` through; leave `update` untouched so it preserves `author_id`
    - _Requirements: 3.3_

  - [x]* 2.3 Write property test for author round-trip in `backend/test/products.test.ts`
    - **Property 4: The author identifier round-trips through persistence and payload**
    - **Validates: Requirements 3.3, 4.1**

- [x] 3. Add the `forbidden` 403 helper
  - In `backend/src/errors.ts`, add a `forbidden(message)` helper alongside `unauthorized`/`notFound` that produces an HTTP 403 error with the standard `{ error }` body (skip if it already exists)
  - _Requirements: 2.2, 2.3_

- [x] 4. Enforce auth and ownership on `PUT /api/notes/:noteId`
  - In `backend/src/routes/notes.ts`, add `requireAuth` to the `PUT /:noteId` handler before the `requireNote` lookup (mirroring the existing `DELETE` handler) so anonymous callers get 401 without learning which ids exist
  - After the lookup, throw `forbidden('You can only edit your own notes')` when `note.author !== req.user!.id`; this single comparison also refuses authorless notes (`note.author === null`)
  - On success, respond 200 with `notes.update(note.id, parseNoteContent(req.body))`
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [x]* 4.1 Write auth + ownership tests in `backend/test/notes.test.ts`
    - Example: unauthenticated `PUT` (missing header, malformed header, empty bearer, expired/invalid token) → 401, content unchanged (Req 1.1, 1.2)
    - Example: unauthenticated `PUT` to existing vs non-existent id both → 401 (no existence leak) (Req 1.2)
    - Example: authenticated `PUT` to non-existent note → 404 (Req 1.3)
    - Edge: authenticated `PUT` to an authorless note (`author === null`) → 403, content unchanged (Req 2.3)
    - _Requirements: 1.1, 1.2, 1.3, 2.3_

  - [x]* 4.2 Write property test for author self-edit in `backend/test/notes.test.ts`
    - **Property 1: An author can update the content of their own note**
    - **Validates: Requirements 2.1**

  - [x]* 4.3 Write property test for non-author rejection in `backend/test/notes.test.ts`
    - **Property 2: A non-author cannot change a note**
    - **Validates: Requirements 2.2**

- [x] 5. Record the creator on note creation
  - In `backend/src/routes/products.ts`, pass `req.user!.id` as the third argument to `notes.create(product.id, parseNoteContent(req.body), req.user!.id)` in the `POST /:productId/notes` handler (which already has `requireAuth`)
  - _Requirements: 3.2, 3.3, 4.1_

  - [x]* 5.1 Write property test for creation recording author in `backend/test/products.test.ts`
    - **Property 3: Note creation records the authenticated creator as author**
    - **Validates: Requirements 3.2, 3.3**
    - Also add an example asserting the created note payload includes `author` (Req 4.1)

- [x] 6. Checkpoint - backend gates and persistence
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Surface the numeric user id to the frontend session
  - In `frontend/src/auth/session.ts`, add `id: number` to the `Session` interface and extend `decodeSession` to read `sub` from the JWT claims, parse it to a number, and reject the token (return `null`) when `sub` is missing or non-numeric, exactly as a missing `username`/`exp` is rejected
  - _Requirements: 4.3_

  - [x]* 7.1 Write `decodeSession` tests in `frontend/src/auth/session.test.ts`
    - Example: `decodeSession` returns a numeric `id` from the token `sub`
    - Example: a token with missing/non-numeric `sub` returns `null` (Req 4.3)
    - _Requirements: 4.3_

- [x] 8. Expose `user.id` on the auth context
  - In `frontend/src/auth/AuthContext.tsx`, change the context user to `{ id: number; username: string } | null` and build `user` from `{ id: session.id, username: session.username }`
  - _Requirements: 4.3_

- [x] 9. Add the `author` field to the frontend Note type
  - In `frontend/src/types.ts`, add `author: number | null` to the `Note` interface to mirror the backend payload
  - _Requirements: 4.1, 4.2_

- [x] 10. Gate the edit handler on the product detail page
  - In `frontend/src/pages/ProductDetailPage.tsx`, compute `canEdit = user != null && user.id === note.author` per note and pass `onSave={canEdit ? (content) => saveNote(note.id, content) : undefined}` to `NoteItem`
  - `canEdit` is false when `user` is `null` and when `user.id` does not match `note.author` (including authorless `null`), and true only when the ids match
  - _Requirements: 5.1, 5.2, 5.3_

  - [x]* 10.1 Write edit-control gating tests in `frontend/src/pages/ProductDetailPage.test.tsx`
    - Example: no logged-in user → no note shows Edit (Req 5.1)
    - Example: logged-in user with a mix of notes (own, another user's, authorless) → Edit shown only on own notes (Req 5.2, 5.3)
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 11. Make `onSave` optional and hide Edit in the note item
  - In `frontend/src/components/NoteItem.tsx`, make the `onSave` prop optional and render the Edit button only when `onSave` is provided (`{onSave && ...}`), mirroring the existing optional `onDelete`/Delete guard
  - _Requirements: 5.4_

  - [x]* 11.1 Write `NoteItem` Edit-visibility tests
    - Example: `NoteItem` with and without `onSave` → Edit control present only when `onSave` is provided, mirroring `onDelete`/Delete (Req 5.4)
    - _Requirements: 5.4_

- [x] 12. Final checkpoint - full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements for traceability; property tasks also cite the design property number and its Validates clause.
- Property tests run a minimum of 100 iterations and are tagged `Feature: notes-edit-auth, Property {number}: {property text}`; example/edge/smoke/integration cases run once.
- The backend is the real gate; the frontend gating (tasks 10-11) is defensive UI only.
- No server-side token change is needed — `tokens.sign` already sets `sub = user.id`; only the client decode changes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "3", "7", "9"] },
    { "id": 1, "tasks": ["1.1", "2.1", "7.1", "8"] },
    { "id": 2, "tasks": ["2.2", "4", "5", "10"] },
    { "id": 3, "tasks": ["2.3", "4.1", "5.1", "10.1", "11"] },
    { "id": 4, "tasks": ["4.2", "4.3", "11.1"] }
  ]
}
```

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export const IN_MEMORY = ':memory:';

// Timestamps are stored as ISO-8601 UTC strings with millisecond precision so they
// sort lexicographically and can be handed to the client unchanged.

/**
 * Case-folds `value` for case-insensitive search, Unicode-aware. SQLite's `LIKE` and `lower()`
 * fold only ASCII A–Z, so "Éclair" and "éclair" would not match; folding in JS instead means
 * accented and non-Latin text compares case-insensitively. Stored once in a shadow `*_folded`
 * column at write time and applied to the search term at query time, so both sides use the same
 * engine. NFC-normalises first so canonically-equivalent spellings of the same string match.
 */
export function foldText(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    -- Unicode case-folded copy of name (foldText), kept in sync on write, for case-insensitive search.
    name_folded TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    content        TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 10000),
    -- Unicode case-folded copy of content (foldText), kept in sync on write, for case-insensitive search.
    content_folded TEXT    NOT NULL DEFAULT '',
    author_id      INTEGER          REFERENCES users (id),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notes_product_created
    ON notes (product_id, created_at DESC, id DESC);

  -- NOCASE makes the UNIQUE constraint case-insensitive, so "Alice" and "alice" can't both exist.
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(username) BETWEEN 1 AND 150),
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Direct messages between two users. A conversation is the set of rows where the pair
  -- {sender_id, recipient_id} matches, in either direction.
  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recipient_id INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    body         TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Both orderings are indexed so fetching a conversation (sender/recipient in either
  -- direction) and listing a user's threads stay fast as the table grows.
  CREATE INDEX IF NOT EXISTS idx_messages_sender_recipient
    ON messages (sender_id, recipient_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient_sender
    ON messages (recipient_id, sender_id, created_at DESC, id DESC);
`;

/** SQLite extended result code SQLITE_CONSTRAINT_UNIQUE. */
const SQLITE_CONSTRAINT_UNIQUE = 2067;

export function isUniqueConstraintError(error: unknown): boolean {
  return (error as { errcode?: unknown } | null)?.errcode === SQLITE_CONSTRAINT_UNIQUE;
}

/**
 * Runs `fn` between `BEGIN` and `COMMIT` and returns its result. If `fn` throws, the
 * transaction is rolled back and the original error rethrown (`node:sqlite` has no
 * transaction helper).
 */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite may already have rolled back by itself (e.g. after RAISE(ROLLBACK) or a full
      // disk), so ROLLBACK fails with "no transaction is active". The original error matters.
    }
    throw error;
  }
}

/**
 * Adds `notes.author_id` to databases created before the column existed. The fresh
 * `CREATE TABLE` already has it, so this only fires on pre-feature databases. Because
 * `node:sqlite` has no "add column if not exists", we inspect `PRAGMA table_info` and
 * run the additive `ALTER` only when the column is absent, keeping startup idempotent.
 * Existing rows keep `author_id = NULL` (Authorless_Notes); no row is rewritten.
 */
export function migrateNotesAuthor(db: Database): void {
  const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
  const hasAuthor = columns.some((column) => column.name === 'author_id');
  if (!hasAuthor) {
    db.exec('ALTER TABLE notes ADD COLUMN author_id INTEGER REFERENCES users (id)');
  }
}

/**
 * Checks whether `table` has a column named `column`, via `PRAGMA table_info`. Used to make the
 * additive folded-column migrations idempotent (`node:sqlite` has no "add column if not exists").
 */
function hasColumn(db: Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

/**
 * Adds and backfills the `*_folded` search columns on databases created before they existed.
 * The fresh `CREATE TABLE` already has them, so the `ALTER` only fires on pre-feature databases.
 * The backfill re-derives each row's folded value in JS (SQLite's `lower()` can't case-fold
 * non-ASCII), inside a transaction so a crash mid-backfill doesn't leave rows partially folded.
 * Idempotent: once the column exists the `ALTER` is skipped, and only empty folded values are
 * backfilled, so re-running costs nothing. A brand-new row's `''` default is corrected on write.
 */
export function migrateFoldedColumns(db: Database): void {
  if (!hasColumn(db, 'products', 'name_folded')) {
    db.exec("ALTER TABLE products ADD COLUMN name_folded TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(db, 'notes', 'content_folded')) {
    db.exec("ALTER TABLE notes ADD COLUMN content_folded TEXT NOT NULL DEFAULT ''");
  }

  transaction(db, () => {
    backfillFolded(db, 'products', 'name', 'name_folded');
    backfillFolded(db, 'notes', 'content', 'content_folded');
  });
}

/** Fills `foldedColumn` from `sourceColumn` (JS-folded) for rows whose folded value is still blank. */
function backfillFolded(db: Database, table: string, sourceColumn: string, foldedColumn: string): void {
  const rows = db
    .prepare(`SELECT id, ${sourceColumn} AS source FROM ${table} WHERE ${foldedColumn} = ''`)
    .all() as Array<{ id: number; source: string }>;
  if (rows.length === 0) return;
  const update = db.prepare(`UPDATE ${table} SET ${foldedColumn} = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(foldText(row.source), row.id);
  }
}

/**
 * Opens (creating if necessary) the SQLite database at `path` and ensures the
 * schema exists. Safe to call on every startup: no manual migrations needed.
 */
export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== IN_MEMORY) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(SCHEMA);
  migrateNotesAuthor(db);
  migrateFoldedColumns(db);
  return db;
}

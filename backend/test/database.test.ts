import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Database,
  IN_MEMORY,
  isUniqueConstraintError,
  migrateNotesAuthor,
  openDatabase,
} from '../src/db/database.js';
import { createNoteRepository, createProductRepository, createUserRepository } from '../src/db/repositories.js';
import { ISO_TIMESTAMP } from './helpers.js';

const tempDirs: string[] = [];
const openDbs: Database[] = [];

function open(path = IN_MEMORY): Database {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'product-vault-'));
  tempDirs.push(dir);
  return join(dir, 'nested', 'dir', 'test.db');
}

afterEach(() => {
  for (const db of openDbs.splice(0)) if (db.isOpen) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Embedded SQLite database (Requirement 7)', () => {
  it('creates the products, notes, users and messages tables on startup', () => {
    const db = open();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(['messages', 'notes', 'products', 'users']);
  });

  it('creates the database file and parent directories when missing, and keeps data across restarts', () => {
    const path = tempDbPath();
    const first = open(path);
    const product = createProductRepository(first).create('Persisted');
    createNoteRepository(first).create(product.id, 'Still here', null as unknown as number);
    first.close();

    const second = open(path); // re-running the schema must be a no-op
    expect(createProductRepository(second).findAll()).toEqual([product]);
    expect(createNoteRepository(second).findByProductId(product.id)).toHaveLength(1);
  });

  it('auto-generates unique, increasing identifiers and creation timestamps', () => {
    const db = open();
    const products = createProductRepository(db);
    const a = products.create('A');
    const b = products.create('B');
    expect(b.id).toBeGreaterThan(a.id);
    expect(Number.isNaN(Date.parse(a.createdAt))).toBe(false);
  });

  it('enforces a 255 character maximum on product names', () => {
    const db = open();
    const insert = db.prepare('INSERT INTO products (name) VALUES (?)');
    expect(() => insert.run('n'.repeat(255))).not.toThrow();
    expect(() => insert.run('n'.repeat(256))).toThrow(/CHECK constraint failed/);
  });

  it('enforces a 10,000 character maximum on note content', () => {
    const db = open();
    const product = createProductRepository(db).create('P');
    const insert = db.prepare('INSERT INTO notes (product_id, content) VALUES (?, ?)');
    expect(() => insert.run(product.id, 'c'.repeat(10_000))).not.toThrow();
    expect(() => insert.run(product.id, 'c'.repeat(10_001))).toThrow(/CHECK constraint failed/);
  });

  it('rejects notes that reference a non-existent product', () => {
    const db = open();
    expect(() => createNoteRepository(db).create(12345, 'Orphan', null as unknown as number)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('prevents deleting a product while it has notes', () => {
    const db = open();
    const product = createProductRepository(db).create('Guarded');
    const notes = createNoteRepository(db);
    const note = notes.create(product.id, 'Blocking note', null as unknown as number);

    const deleteProduct = db.prepare('DELETE FROM products WHERE id = ?');
    expect(() => deleteProduct.run(product.id)).toThrow(/FOREIGN KEY constraint failed/);

    notes.delete(note.id);
    expect(Number(deleteProduct.run(product.id).changes)).toBe(1);
  });

  it('has foreign key enforcement switched on', () => {
    const db = open();
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
  });
});

describe('Users table (Requirement 18)', () => {
  it('has id, username, password_hash and created_at columns', () => {
    const db = open();
    const columns = db
      .prepare('PRAGMA table_info(users)')
      .all()
      .map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
    expect(columns).toEqual([
      { name: 'id', type: 'INTEGER', notnull: 0, pk: 1 },
      { name: 'username', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'password_hash', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
    ]);
  });

  it('auto-increments ids and defaults created_at to an ISO 8601 timestamp', () => {
    const users = createUserRepository(open());
    const a = users.create('alice', 'hash-a');
    const b = users.create('bob', 'hash-b');
    expect(b.id).toBeGreaterThan(a.id);
    expect(a.createdAt).toMatch(ISO_TIMESTAMP);
  });

  it('finds users by username, ignoring letter case', () => {
    const users = createUserRepository(open());
    const alice = users.create('Alice', 'hash');
    expect(users.findByUsername('alice')).toEqual(alice);
    expect(users.findByUsername('nobody')).toBeUndefined();
  });

  it('enforces unique usernames at the database level, ignoring letter case', () => {
    const db = open();
    const insert = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    insert.run('alice', 'hash');

    for (const username of ['alice', 'ALICE']) {
      let error: unknown;
      try {
        insert.run(username, 'other-hash');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/UNIQUE constraint failed: users.username/);
      expect(isUniqueConstraintError(error)).toBe(true);
    }
  });

  it('surfaces the constraint violation from the repository', () => {
    const users = createUserRepository(open());
    users.create('alice', 'hash');
    expect(() => users.create('alice', 'hash')).toThrow(/UNIQUE constraint failed/);
  });

  it('does not report other errors as unique violations', () => {
    const db = open();
    const insert = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    expect(() => insert.run('u'.repeat(151), 'hash')).toThrow(/CHECK constraint failed/);
    try {
      insert.run('u'.repeat(151), 'hash');
    } catch (error) {
      expect(isUniqueConstraintError(error)).toBe(false);
    }
    expect(isUniqueConstraintError(new Error('UNIQUE constraint failed'))).toBe(false);
  });

  it('enforces a 150 character maximum and requires a username and password hash', () => {
    const db = open();
    const insert = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    expect(() => insert.run('u'.repeat(150), 'hash')).not.toThrow();
    expect(() => insert.run('v'.repeat(151), 'hash')).toThrow(/CHECK constraint failed/);
    expect(() => insert.run(null, 'hash')).toThrow(/NOT NULL constraint failed: users.username/);
    expect(() => insert.run('carol', null)).toThrow(/NOT NULL constraint failed: users.password_hash/);
  });
});

describe('Notes author column and migration (notes-edit-auth, Requirements 3.1, 3.4, 4.2)', () => {
  const noteColumns = (db: Database) =>
    db
      .prepare('PRAGMA table_info(notes)')
      .all()
      .map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));

  const foreignKeys = (db: Database) =>
    db
      .prepare('PRAGMA foreign_key_list(notes)')
      .all()
      .map(({ table, from, to }) => ({ table, from, to }));

  it('Smoke: fresh databases have an author_id column referencing users(id) (Req 3.1)', () => {
    const db = open();
    const author = noteColumns(db).find((column) => column.name === 'author_id');
    // Nullable foreign key: present, not NOT NULL, not part of the primary key.
    expect(author).toEqual({ name: 'author_id', type: 'INTEGER', notnull: 0, pk: 0 });
    expect(foreignKeys(db)).toContainEqual({ table: 'users', from: 'author_id', to: 'id' });
  });

  it('Integration: migrateNotesAuthor backfills a legacy notes table, preserves rows, and re-runs as a no-op (Req 3.4)', () => {
    const path = tempDbPath();
    // A connection shaped like a pre-feature database: notes has no author_id column.
    const legacy = open(path);
    legacy.exec('DROP TABLE notes');
    legacy.exec(`
      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
        content    TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 10000),
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    legacy.prepare('INSERT INTO products (id, name) VALUES (1, ?)').run('Legacy product');
    legacy.prepare('INSERT INTO notes (id, product_id, content) VALUES (?, ?, ?)').run(1, 1, 'First legacy note');
    legacy.prepare('INSERT INTO notes (id, product_id, content) VALUES (?, ?, ?)').run(2, 1, 'Second legacy note');
    expect(noteColumns(legacy).some((column) => column.name === 'author_id')).toBe(false);

    migrateNotesAuthor(legacy);

    // Column was added as a nullable FK to users(id).
    expect(noteColumns(legacy).find((column) => column.name === 'author_id')).toEqual({
      name: 'author_id',
      type: 'INTEGER',
      notnull: 0,
      pk: 0,
    });
    expect(foreignKeys(legacy)).toContainEqual({ table: 'users', from: 'author_id', to: 'id' });

    // Every pre-existing row survives with its id and content intact and author_id = NULL.
    const rows = legacy.prepare('SELECT id, content, author_id FROM notes ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, content: 'First legacy note', author_id: null },
      { id: 2, content: 'Second legacy note', author_id: null },
    ]);

    // Re-running the migration is a no-op: no throw, rows untouched.
    expect(() => migrateNotesAuthor(legacy)).not.toThrow();
    expect(legacy.prepare('SELECT id, content, author_id FROM notes ORDER BY id').all()).toEqual(rows);

    // openDatabase runs the migration on startup; reopening the same file is also a no-op.
    legacy.close();
    openDbs.splice(openDbs.indexOf(legacy), 1);
    const reopened = open(path);
    expect(reopened.prepare('SELECT id, content, author_id FROM notes ORDER BY id').all()).toEqual(rows);
  });

  it('Example: a note with no recorded author stores author_id = NULL, the representation of author: null (Req 4.2)', () => {
    const db = open();
    db.prepare('INSERT INTO products (id, name) VALUES (1, ?)').run('P');
    db.prepare('INSERT INTO notes (product_id, content) VALUES (?, ?)').run(1, 'Authorless note');
    const row = db.prepare('SELECT author_id FROM notes WHERE content = ?').get('Authorless note') as {
      author_id: number | null;
    };
    expect(row.author_id).toBeNull();
  });
});

describe('Deleting a product (Requirement 19)', () => {
  const countProductRows = (db: Database, id: number) =>
    Number(db.prepare('SELECT COUNT(*) AS count FROM products WHERE id = ?').get(id)?.count);
  const noteIdsOf = (db: Database, productId: number) =>
    db
      .prepare('SELECT id FROM notes WHERE product_id = ? ORDER BY id')
      .all(productId)
      .map((row) => Number(row.id));

  it('T19.1f deletes the product together with its notes and reports whether a product was deleted', () => {
    const db = open();
    const products = createProductRepository(db);
    const notes = createNoteRepository(db);
    const product = products.create('Moka pot');
    notes.create(product.id, 'First note', null as unknown as number);
    notes.create(product.id, 'Second note', null as unknown as number);

    expect(products.delete(product.id)).toBe(true);
    expect(countProductRows(db, product.id)).toBe(0);
    expect(noteIdsOf(db, product.id)).toEqual([]);

    expect(products.delete(9999)).toBe(false);
  });

  it('T19.3a leaves the product and its notes untouched when the delete fails part-way, and no transaction open', () => {
    const path = tempDbPath();
    const db = open(path);
    const products = createProductRepository(db);
    const notes = createNoteRepository(db);
    const product = products.create('Moka pot');
    const first = notes.create(product.id, 'First note', null as unknown as number);
    const second = notes.create(product.id, 'Second note', null as unknown as number);
    db.exec(`
      CREATE TEMP TRIGGER fail_product_delete BEFORE DELETE ON products
      BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
    `);

    expect(() => products.delete(product.id)).toThrow(/^forced failure$/);
    expect(countProductRows(db, product.id)).toBe(1);
    expect(noteIdsOf(db, product.id)).toEqual([first.id, second.id]);

    db.exec('DROP TRIGGER fail_product_delete');
    const later = products.create('Written afterwards');
    db.close();

    // Closing a connection rolls back any transaction it still has open, so the row only
    // survives the reopen if the insert ran in autocommit mode.
    const reopened = open(path);
    expect(createProductRepository(reopened).findById(later.id)).toEqual(later);
    expect(countProductRows(reopened, product.id)).toBe(1);
    expect(noteIdsOf(reopened, product.id)).toEqual([first.id, second.id]);
  });

  it('T19.3c keeps the original error when SQLite rolls the transaction back by itself', () => {
    const path = tempDbPath();
    const db = open(path);
    const products = createProductRepository(db);
    const notes = createNoteRepository(db);
    const product = products.create('Moka pot');
    const first = notes.create(product.id, 'First note', null as unknown as number);
    const second = notes.create(product.id, 'Second note', null as unknown as number);
    // RAISE(ROLLBACK) ends the transaction inside SQLite before the error reaches JavaScript.
    db.exec(`
      CREATE TEMP TRIGGER rollback_product_delete BEFORE DELETE ON products
      BEGIN SELECT RAISE(ROLLBACK, 'forced rollback'); END;
    `);

    expect(() => products.delete(product.id)).toThrow(/^forced rollback$/);
    expect(countProductRows(db, product.id)).toBe(1);
    expect(noteIdsOf(db, product.id)).toEqual([first.id, second.id]);

    db.exec('DROP TRIGGER rollback_product_delete');
    const later = products.create('Written afterwards');
    db.close();

    // Closing a connection rolls back any transaction it still has open, so the row only
    // survives the reopen if the insert ran in autocommit mode.
    const reopened = open(path);
    expect(createProductRepository(reopened).findById(later.id)).toEqual(later);
    expect(countProductRows(reopened, product.id)).toBe(1);
    expect(noteIdsOf(reopened, product.id)).toEqual([first.id, second.id]);
  });
});

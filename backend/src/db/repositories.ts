import type { SearchCriteria } from '../validation.js';
import { type Database, transaction } from './database.js';

export interface Product {
  id: number;
  name: string;
  createdAt: string;
}

export interface Note {
  id: number;
  productId: number;
  content: string;
  author: number | null;
  createdAt: string;
}

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface ProductRow {
  id: number;
  name: string;
  created_at: string;
}

interface NoteRow {
  id: number;
  product_id: number;
  content: string;
  author_id: number | null;
  created_at: string;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
});

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  productId: row.product_id,
  content: row.content,
  author: row.author_id,
  createdAt: row.created_at,
});

const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

const PRODUCT_COLUMNS = 'id, name, created_at';
const NOTE_COLUMNS = 'id, product_id, content, author_id, created_at';
const USER_COLUMNS = 'id, username, password_hash, created_at';

export type ProductRepository = ReturnType<typeof createProductRepository>;
export type NoteRepository = ReturnType<typeof createNoteRepository>;
export type UserRepository = ReturnType<typeof createUserRepository>;

/** Escapes the LIKE wildcards so user input is matched literally (paired with ESCAPE '\'). */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** The day after `date` (YYYY-MM-DD) at UTC midnight, as an ISO string — an exclusive upper bound. */
function startOfNextDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * Builds the WHERE clauses and bound parameters for a product search from validated criteria.
 * Only placeholders (`?`) go into the SQL; every user value is a bound parameter. The clauses
 * are ANDed together, so each added filter narrows the result.
 */
function buildSearchQuery(criteria: SearchCriteria): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const term of criteria.terms) {
    clauses.push("p.name LIKE ? ESCAPE '\\'");
    params.push(likeContains(term));
  }
  if (criteria.createdFrom !== undefined) {
    clauses.push('p.created_at >= ?');
    params.push(`${criteria.createdFrom}T00:00:00.000Z`);
  }
  if (criteria.createdTo !== undefined) {
    // Exclusive upper bound at the next day's midnight makes the `to` date inclusive.
    clauses.push('p.created_at < ?');
    params.push(startOfNextDay(criteria.createdTo));
  }
  if (criteria.noteText !== undefined) {
    // A product matches when at least one of its notes contains the text.
    clauses.push("EXISTS (SELECT 1 FROM notes n WHERE n.product_id = p.id AND n.content LIKE ? ESCAPE '\\')");
    params.push(likeContains(criteria.noteText));
  }
  if (criteria.author !== undefined) {
    // A product matches when it has a note whose author is the named user (username is NOCASE).
    clauses.push(
      'EXISTS (SELECT 1 FROM notes n JOIN users u ON u.id = n.author_id WHERE n.product_id = p.id AND u.username = ?)',
    );
    params.push(criteria.author);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function createProductRepository(db: Database) {
  const insert = db.prepare(`INSERT INTO products (name) VALUES (?) RETURNING ${PRODUCT_COLUMNS}`);
  // `id` breaks ties between rows created within the same millisecond.
  const selectAll = db.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY created_at DESC, id DESC`);
  const selectById = db.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`);
  // Prefixed column list for the aliased table used by `search` (notes/users may also appear).
  const SEARCH_COLUMNS = PRODUCT_COLUMNS.split(', ')
    .map((column) => `p.${column}`)
    .join(', ');
  // The notes go first: the foreign key is ON DELETE RESTRICT.
  const removeNotes = db.prepare('DELETE FROM notes WHERE product_id = ?');
  const remove = db.prepare('DELETE FROM products WHERE id = ?');

  return {
    create(name: string): Product {
      return toProduct(insert.get(name) as unknown as ProductRow);
    },

    findAll(): Product[] {
      return (selectAll.all() as unknown as ProductRow[]).map(toProduct);
    },

    /**
     * Returns products matching every filter in `criteria` (name terms, creation-date range,
     * note text, note author), newest first. Criteria with no filters returns all products.
     * Only bound parameters carry user input, so the query is injection-safe.
     */
    search(criteria: SearchCriteria): Product[] {
      const { where, params } = buildSearchQuery(criteria);
      const sql = `SELECT ${SEARCH_COLUMNS} FROM products p ${where} ORDER BY p.created_at DESC, p.id DESC`;
      const rows = db.prepare(sql).all(...(params as never[])) as unknown as ProductRow[];
      return rows.map(toProduct);
    },

    findById(id: number): Product | undefined {
      const row = selectById.get(id) as unknown as ProductRow | undefined;
      return row && toProduct(row);
    },

    /** Deletes the product and its notes, all or nothing. Returns `true` if a product was deleted. */
    delete(id: number): boolean {
      return transaction(db, () => {
        removeNotes.run(id);
        return Number(remove.run(id).changes) > 0;
      });
    },
  };
}

export function createNoteRepository(db: Database) {
  const insert = db.prepare(
    `INSERT INTO notes (product_id, content, author_id) VALUES (?, ?, ?) RETURNING ${NOTE_COLUMNS}`,
  );
  const selectById = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`);
  const selectByProduct = db.prepare(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE product_id = ? ORDER BY created_at DESC, id DESC`,
  );
  const update = db.prepare(`UPDATE notes SET content = ? WHERE id = ? RETURNING ${NOTE_COLUMNS}`);
  const remove = db.prepare('DELETE FROM notes WHERE id = ?');

  return {
    create(productId: number, content: string, authorId: number): Note {
      return toNote(insert.get(productId, content, authorId) as unknown as NoteRow);
    },

    findById(id: number): Note | undefined {
      const row = selectById.get(id) as unknown as NoteRow | undefined;
      return row && toNote(row);
    },

    findByProductId(productId: number): Note[] {
      return (selectByProduct.all(productId) as unknown as NoteRow[]).map(toNote);
    },

    /** Returns the updated note, or `undefined` if no note has that id. */
    update(id: number, content: string): Note | undefined {
      const row = update.get(content, id) as unknown as NoteRow | undefined;
      return row && toNote(row);
    },

    /** Returns `true` if a note was deleted. */
    delete(id: number): boolean {
      return Number(remove.run(id).changes) > 0;
    },
  };
}

export function createUserRepository(db: Database) {
  const insert = db.prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING ${USER_COLUMNS}`);
  // The column's NOCASE collation makes this lookup case-insensitive too.
  const selectByUsername = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`);

  return {
    /** Throws the SQLite constraint error (see `isUniqueConstraintError`) if the username is taken. */
    create(username: string, passwordHash: string): User {
      return toUser(insert.get(username, passwordHash) as unknown as UserRow);
    },

    findByUsername(username: string): User | undefined {
      const row = selectByUsername.get(username) as unknown as UserRow | undefined;
      return row && toUser(row);
    },
  };
}

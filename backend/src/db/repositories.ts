import type { SearchCriteria } from '../validation.js';
import { type Database, foldText, transaction } from './database.js';

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

export interface Message {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  createdAt: string;
}

/** A summary of the latest message exchanged with one other user. */
export interface MessageThread {
  partnerId: number;
  partnerUsername: string;
  lastBody: string;
  lastCreatedAt: string;
}

/** A user stripped of secrets, safe to send to the client (no password hash). */
export interface PublicUser {
  id: number;
  username: string;
}

export const toPublicUser = (user: User): PublicUser => ({ id: user.id, username: user.username });

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

interface MessageRow {
  id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  created_at: string;
}

interface MessageThreadRow {
  partner_id: number;
  partner_username: string;
  last_body: string;
  last_created_at: string;
  /** Latest message id; used only as a deterministic tiebreaker for thread ordering. */
  last_id: number;
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

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  senderId: row.sender_id,
  recipientId: row.recipient_id,
  body: row.body,
  createdAt: row.created_at,
});

const toMessageThread = (row: MessageThreadRow): MessageThread => ({
  partnerId: row.partner_id,
  partnerUsername: row.partner_username,
  lastBody: row.last_body,
  lastCreatedAt: row.last_created_at,
});

const PRODUCT_COLUMNS = 'id, name, created_at';
const NOTE_COLUMNS = 'id, product_id, content, author_id, created_at';
const USER_COLUMNS = 'id, username, password_hash, created_at';
const MESSAGE_COLUMNS = 'id, sender_id, recipient_id, body, created_at';

export type ProductRepository = ReturnType<typeof createProductRepository>;
export type NoteRepository = ReturnType<typeof createNoteRepository>;
export type UserRepository = ReturnType<typeof createUserRepository>;
export type MessageRepository = ReturnType<typeof createMessageRepository>;

/**
 * Builds a `LIKE` pattern matching `term` as a substring, case-insensitively and Unicode-aware.
 * The term is folded with the same `foldText` used to populate the `*_folded` columns, then its
 * LIKE wildcards are escaped so they match literally (paired with `ESCAPE '\'`). Folding before
 * escaping is safe: `foldText` never produces `\`, `%` or `_` from other characters.
 */
function likeContains(term: string): string {
  return `%${foldText(term).replace(/[\\%_]/g, '\\$&')}%`;
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
    // Match the Unicode-folded copy so "éclair" finds a stored "Éclair"; the term is folded too.
    clauses.push("p.name_folded LIKE ? ESCAPE '\\'");
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
    // A product matches when at least one of its notes contains the text (Unicode case-insensitive).
    clauses.push("EXISTS (SELECT 1 FROM notes n WHERE n.product_id = p.id AND n.content_folded LIKE ? ESCAPE '\\')");
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
  const insert = db.prepare(`INSERT INTO products (name, name_folded) VALUES (?, ?) RETURNING ${PRODUCT_COLUMNS}`);
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
      return toProduct(insert.get(name, foldText(name)) as unknown as ProductRow);
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
    `INSERT INTO notes (product_id, content, content_folded, author_id) VALUES (?, ?, ?, ?) RETURNING ${NOTE_COLUMNS}`,
  );
  const selectById = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`);
  const selectByProduct = db.prepare(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE product_id = ? ORDER BY created_at DESC, id DESC`,
  );
  const update = db.prepare(`UPDATE notes SET content = ?, content_folded = ? WHERE id = ? RETURNING ${NOTE_COLUMNS}`);
  const remove = db.prepare('DELETE FROM notes WHERE id = ?');

  return {
    create(productId: number, content: string, authorId: number): Note {
      return toNote(insert.get(productId, content, foldText(content), authorId) as unknown as NoteRow);
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
      const row = update.get(content, foldText(content), id) as unknown as NoteRow | undefined;
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
  const selectById = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
  // Everyone except the caller, so a user never messages themselves. Case-insensitive A→Z.
  const selectOthers = db.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE id <> ? ORDER BY username COLLATE NOCASE ASC`,
  );

  return {
    /** Throws the SQLite constraint error (see `isUniqueConstraintError`) if the username is taken. */
    create(username: string, passwordHash: string): User {
      return toUser(insert.get(username, passwordHash) as unknown as UserRow);
    },

    findByUsername(username: string): User | undefined {
      const row = selectByUsername.get(username) as unknown as UserRow | undefined;
      return row && toUser(row);
    },

    findById(id: number): User | undefined {
      const row = selectById.get(id) as unknown as UserRow | undefined;
      return row && toUser(row);
    },

    /** Every user other than `exceptId`, username A→Z — the list of people you can message. */
    listOthers(exceptId: number): User[] {
      return (selectOthers.all(exceptId) as unknown as UserRow[]).map(toUser);
    },
  };
}

export function createMessageRepository(db: Database) {
  const insert = db.prepare(
    `INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?) RETURNING ${MESSAGE_COLUMNS}`,
  );
  // A conversation is every message exchanged between the pair, in either direction, oldest first
  // so it reads top-to-bottom like a chat transcript.
  const selectConversation = db.prepare(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
       ORDER BY created_at ASC, id ASC`,
  );
  // The other party in each of the caller's threads, most-recently-active first, with the latest
  // message body and time. `partner_id` is whichever side of the row isn't the caller.
  // Plain positional `?` placeholders (bound four times, once each) rather than numbered `?1`:
  // node:sqlite before the fix for nodejs/node#59340 misclassifies `?1` as a *named* parameter,
  // so positional binding to it throws "column index out of range" on Node 22.13–22.1x — within
  // this project's `engines` range. `?` avoids that entirely and matches every other query here.
  // `last_id` is carried out so the outer sort has a deterministic tiebreaker when two threads'
  // latest messages share a millisecond.
  const selectThreads = db.prepare(
    `SELECT
        partner_id,
        (SELECT username FROM users WHERE id = partner_id) AS partner_username,
        last_body,
        last_created_at
       FROM (
         SELECT
           CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS partner_id,
           body AS last_body,
           created_at AS last_created_at,
           id AS last_id,
           ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END
             ORDER BY created_at DESC, id DESC
           ) AS rn
         FROM messages
         WHERE sender_id = ? OR recipient_id = ?
       )
       WHERE rn = 1
       ORDER BY last_created_at DESC, last_id DESC`,
  );

  return {
    create(senderId: number, recipientId: number, body: string): Message {
      return toMessage(insert.get(senderId, recipientId, body) as unknown as MessageRow);
    },

    /** Every message between the two users, in either direction, oldest first. */
    findConversation(userId: number, partnerId: number): Message[] {
      return (
        selectConversation.all(userId, partnerId, partnerId, userId) as unknown as MessageRow[]
      ).map(toMessage);
    },

    /** One entry per person the user has a conversation with, most recent activity first. */
    findThreads(userId: number): MessageThread[] {
      return (
        selectThreads.all(userId, userId, userId, userId) as unknown as MessageThreadRow[]
      ).map(toMessageThread);
    },
  };
}

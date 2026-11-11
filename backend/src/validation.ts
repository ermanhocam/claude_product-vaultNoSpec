import { badRequest } from './errors.js';

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 5000;
export const MESSAGE_BODY_MAX_LENGTH = 5000;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Counts Unicode code points rather than UTF-16 code units, so an emoji counts
 * as one character. This matches SQLite's `length()` used by the schema checks.
 */
export function characterCount(value: string): number {
  return [...value].length;
}

function readField(body: unknown, field: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
}

function readRequiredText(body: unknown, field: string, label: string, maxLength: number): string {
  const value = readField(body, field);

  if (value === undefined || value === null) {
    throw badRequest(`${label} is required`);
  }
  if (typeof value !== 'string') {
    throw badRequest(`${label} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw badRequest(`${label} is required`);
  }
  if (characterCount(trimmed) > maxLength) {
    throw badRequest(`${label} must not exceed ${maxLength} characters`);
  }
  return trimmed;
}

/** Like `readRequiredText` but never trims: whitespace in a password is significant. */
function readCredential(body: unknown, field: string, label: string): string {
  const value = readField(body, field);

  if (value === undefined || value === null || value === '') {
    throw badRequest(`${label} is required`);
  }
  if (typeof value !== 'string') {
    throw badRequest(`${label} must be a string`);
  }
  return value;
}

/** Validates a product creation body and returns the trimmed name. */
export function parseProductName(body: unknown): string {
  return readRequiredText(body, 'name', 'Product name', PRODUCT_NAME_MAX_LENGTH);
}

/** Validates a note create/update body and returns the trimmed content. */
export function parseNoteContent(body: unknown): string {
  return readRequiredText(body, 'content', 'Note content', NOTE_CONTENT_MAX_LENGTH);
}

/** Validates a send-message body and returns the trimmed message text. */
export function parseMessageBody(body: unknown): string {
  return readRequiredText(body, 'body', 'Message', MESSAGE_BODY_MAX_LENGTH);
}

export const SEARCH_QUERY_MAX_LENGTH = 200;
export const NOTE_TEXT_QUERY_MAX_LENGTH = 200;

/** A single-value string query param, rejecting a repeated param (which arrives as an array). */
function readQueryString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`${label} must be a single string`);
  }
  return value;
}

/**
 * Validates the `q` search query param and returns the whitespace-separated terms.
 * A missing or blank query yields an empty array (match everything). The value must
 * be a string within the length limit; multiple occurrences of `q` (an array) are rejected.
 */
export function parseSearchQuery(value: unknown): string[] {
  const raw = readQueryString(value, 'Search query');
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (characterCount(trimmed) > SEARCH_QUERY_MAX_LENGTH) {
    throw badRequest(`Search query must not exceed ${SEARCH_QUERY_MAX_LENGTH} characters`);
  }
  return trimmed.split(/\s+/);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a `YYYY-MM-DD` calendar date param and returns it, or `undefined` when absent.
 * The date must be real (e.g. 2026-02-30 is rejected), so a range can be trusted downstream.
 */
function parseDateParam(value: unknown, label: string): string | undefined {
  const raw = readQueryString(value, label);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!DATE_PATTERN.test(trimmed)) {
    throw badRequest(`${label} must be a date in YYYY-MM-DD format`);
  }
  // Round-trip through Date to reject impossible calendar dates like 2026-13-01.
  const asDate = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== trimmed) {
    throw badRequest(`${label} is not a valid date`);
  }
  return trimmed;
}

/** Validates the note-text filter: a non-empty string within the length limit, or `undefined`. */
function parseNoteTextParam(value: unknown): string | undefined {
  const raw = readQueryString(value, 'Note text');
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (characterCount(trimmed) > NOTE_TEXT_QUERY_MAX_LENGTH) {
    throw badRequest(`Note text must not exceed ${NOTE_TEXT_QUERY_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/** Validates the author-username filter: a non-empty string within the username limit, or `undefined`. */
function parseAuthorParam(value: unknown): string | undefined {
  const raw = readQueryString(value, 'Author');
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (characterCount(trimmed) > USERNAME_MAX_LENGTH) {
    throw badRequest(`Author must not exceed ${USERNAME_MAX_LENGTH} characters`);
  }
  return trimmed;
}

/** The validated, structured filters a product search can apply. */
export interface SearchCriteria {
  /** Name terms; every term must appear in the product name (case-insensitive). */
  terms: string[];
  /** Inclusive lower bound on creation date, `YYYY-MM-DD`. */
  createdFrom?: string;
  /** Inclusive upper bound on creation date, `YYYY-MM-DD`. */
  createdTo?: string;
  /** Substring that must appear in at least one of the product's notes. */
  noteText?: string;
  /** Username whose note the product must have. */
  author?: string;
}

/** True when the criteria use any filter beyond the public name search. */
export function hasAdvancedCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.createdFrom !== undefined ||
    criteria.createdTo !== undefined ||
    criteria.noteText !== undefined ||
    criteria.author !== undefined
  );
}

/** Reads `q`, `from`, `to`, `noteText` and `author` from a query object into validated criteria. */
export function parseSearchCriteria(query: Record<string, unknown>): SearchCriteria {
  const createdFrom = parseDateParam(query.from, 'From date');
  const createdTo = parseDateParam(query.to, 'To date');
  if (createdFrom !== undefined && createdTo !== undefined && createdFrom > createdTo) {
    throw badRequest('From date must not be after the to date');
  }
  return {
    terms: parseSearchQuery(query.q),
    createdFrom,
    createdTo,
    noteText: parseNoteTextParam(query.noteText),
    author: parseAuthorParam(query.author),
  };
}

export interface Credentials {
  username: string;
  password: string;
}

/** Validates a login body: both fields must be present, non-empty strings. */
export function parseLogin(body: unknown): Credentials {
  return {
    username: readCredential(body, 'username', 'Username'),
    password: readCredential(body, 'password', 'Password'),
  };
}

/** Validates a registration body against the username and password rules. */
export function parseRegistration(body: unknown): Credentials {
  const { username, password } = parseLogin(body);

  const usernameLength = characterCount(username);
  if (usernameLength < USERNAME_MIN_LENGTH || usernameLength > USERNAME_MAX_LENGTH) {
    throw badRequest(`Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`);
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw badRequest('Username may only contain letters, numbers, hyphens and underscores');
  }

  const passwordLength = characterCount(password);
  if (passwordLength < PASSWORD_MIN_LENGTH || passwordLength > PASSWORD_MAX_LENGTH) {
    throw badRequest(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`);
  }

  return { username, password };
}

/** Parses a positive integer route id; returns `undefined` for anything else. */
export function parseId(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

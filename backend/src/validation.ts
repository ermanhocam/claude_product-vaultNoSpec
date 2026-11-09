import { badRequest } from './errors.js';

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 5000;
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

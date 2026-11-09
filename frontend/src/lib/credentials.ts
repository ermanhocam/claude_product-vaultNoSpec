import { characterCount } from './text';

// Rules mirror the backend's registration validation.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Returns a validation message for a username, or `null` if it is acceptable. */
export function validateUsername(value: string): string | null {
  if (value.length === 0) return 'Username is required';
  const length = characterCount(value);
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    return `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_PATTERN.test(value)) return 'Username may only contain letters, numbers, hyphens and underscores';
  return null;
}

/** Returns a validation message for a password, or `null` if it is acceptable. Passwords are never trimmed. */
export function validatePassword(value: string): string | null {
  if (value.length === 0) return 'Password is required';
  const length = characterCount(value);
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

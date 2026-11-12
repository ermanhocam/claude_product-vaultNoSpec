// Limits mirror the backend's validation rules.
export const PRODUCT_NAME_MAX_LENGTH = 200;
export const NOTE_CONTENT_MAX_LENGTH = 5000;
export const MESSAGE_BODY_MAX_LENGTH = 5000;

/** Counts Unicode code points so an emoji counts as one character, as the backend does. */
export function characterCount(value: string): number {
  return [...value].length;
}

/** Returns a validation message for `value`, or `null` if it is acceptable. */
export function validateText(value: string, label: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} is required`;
  if (characterCount(trimmed) > maxLength) return `${label} must not exceed ${maxLength} characters`;
  return null;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

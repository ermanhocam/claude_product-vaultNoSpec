import { tokenStore } from '../auth/session';
import type {
  Conversation,
  Message,
  MessageThread,
  Note,
  Product,
  ProductSearchCriteria,
  ProductWithNotes,
  PublicUser,
} from '../types';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export class ApiError extends Error {
  /** HTTP status code, or 0 when the server could not be reached at all. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | undefined;

/**
 * Sets the callback for a `401` response to a request that carried a login token, meaning
 * the server no longer accepts the session. Returns a function that removes the callback.
 */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = undefined;
  };
}

function hasErrorMessage(body: unknown): body is { error: string } {
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(`Can't reach the Product Vault API at ${API_URL}. Make sure the backend is running.`, 0);
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401 && token) unauthorizedHandler?.();
    const message = hasErrorMessage(body) ? body.error : `The server responded with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const api = {
  register: (username: string, password: string) =>
    request<{ id: number; username: string }>('/auth/register', json('POST', { username, password })),

  login: (username: string, password: string) =>
    request<{ token: string }>('/auth/login', json('POST', { username, password })),

  listProducts: () => request<Product[]>('/products'),

  searchProducts: (criteria: ProductSearchCriteria) => {
    const params = new URLSearchParams();
    if (criteria.query) params.set('q', criteria.query);
    if (criteria.from) params.set('from', criteria.from);
    if (criteria.to) params.set('to', criteria.to);
    if (criteria.noteText) params.set('noteText', criteria.noteText);
    if (criteria.author) params.set('author', criteria.author);
    return request<Product[]>(`/products/search?${params.toString()}`);
  },

  createProduct: (name: string) => request<Product>('/products', json('POST', { name })),

  getProduct: (productId: number | string) =>
    request<ProductWithNotes>(`/products/${encodeURIComponent(productId)}`),

  deleteProduct: (productId: number) =>
    request<{ id: number; deleted: true }>(`/products/${productId}`, { method: 'DELETE' }),

  createNote: (productId: number, content: string) =>
    request<Note>(`/products/${productId}/notes`, json('POST', { content })),

  updateNote: (noteId: number, content: string) => request<Note>(`/notes/${noteId}`, json('PUT', { content })),

  deleteNote: (noteId: number) => request<{ id: number; deleted: true }>(`/notes/${noteId}`, { method: 'DELETE' }),

  // People you can start a conversation with (everyone but you).
  listMessageUsers: () => request<PublicUser[]>('/messages/users'),

  // Your existing conversations, most recent activity first.
  listThreads: () => request<MessageThread[]>('/messages/threads'),

  // The full transcript with one other user, plus who they are.
  getConversation: (userId: number | string) =>
    request<Conversation>(`/messages/conversations/${encodeURIComponent(userId)}`),

  sendMessage: (userId: number, body: string) =>
    request<Message>(`/messages/conversations/${userId}`, json('POST', { body })),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

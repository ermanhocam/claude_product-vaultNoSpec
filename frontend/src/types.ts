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

export interface ProductWithNotes extends Product {
  notes: Note[];
}

/** A user as exposed to other users (no secrets). */
export interface PublicUser {
  id: number;
  username: string;
}

/** A single direct message between two users. */
export interface Message {
  id: number;
  senderId: number;
  recipientId: number;
  body: string;
  createdAt: string;
}

/** A conversation and the other participant, as returned when opening a thread. */
export interface Conversation {
  partner: PublicUser;
  messages: Message[];
}

/** A summary of the latest message exchanged with one other user. */
export interface MessageThread {
  partnerId: number;
  partnerUsername: string;
  lastBody: string;
  lastCreatedAt: string;
}

/**
 * Product search filters. `query` (name) is public; `from`, `to`, `noteText` and `author`
 * are advanced filters only logged-in users may use. Each field is a `YYYY-MM-DD` date
 * (`from`/`to`) or free text; empty fields are omitted from the request.
 */
export interface ProductSearchCriteria {
  query: string;
  from?: string;
  to?: string;
  noteText?: string;
  author?: string;
}

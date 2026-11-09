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

export interface Product {
  id: number;
  name: string;
  createdAt: string;
}

export interface Note {
  id: number;
  productId: number;
  content: string;
  createdAt: string;
}

export interface ProductWithNotes extends Product {
  notes: Note[];
}

import { type Request, type RequestHandler, Router } from 'express';
import type { NoteRepository, Product, ProductRepository } from '../db/repositories.js';
import { notFound } from '../errors.js';
import { parseId, parseNoteContent, parseProductName } from '../validation.js';

export function createProductsRouter(
  products: ProductRepository,
  notes: NoteRepository,
  requireAuth: RequestHandler,
): Router {
  const router = Router();

  const requireProduct = (rawId: string | undefined): Product => {
    const id = parseId(rawId);
    const product = id === undefined ? undefined : products.findById(id);
    if (!product) throw notFound('Product not found');
    return product;
  };

  router.get('/', (_req, res) => {
    res.json(products.findAll());
  });

  router.post('/', (req, res) => {
    const product = products.create(parseProductName(req.body));
    res.status(201).location(`/api/products/${product.id}`).json(product);
  });

  router.get('/:productId', (req, res) => {
    const product = requireProduct(req.params.productId);
    res.json({ ...product, notes: notes.findByProductId(product.id) });
  });

  // Deleting needs a login. Authentication runs before the product lookup, so anonymous
  // callers get 401 without learning which product ids exist.
  router.delete('/:productId', requireAuth, (req: Request<{ productId: string }>, res) => {
    const { id } = requireProduct(req.params.productId);
    products.delete(id);
    res.json({ id, deleted: true });
  });

  router.get('/:productId/notes', (req, res) => {
    const product = requireProduct(req.params.productId);
    res.json(notes.findByProductId(product.id));
  });

  // Creating a note needs a login, checked before the product lookup like deletion above.
  router.post('/:productId/notes', requireAuth, (req: Request<{ productId: string }>, res) => {
    const product = requireProduct(req.params.productId);
    const note = notes.create(product.id, parseNoteContent(req.body));
    res.status(201).location(`/api/notes/${note.id}`).json(note);
  });

  return router;
}

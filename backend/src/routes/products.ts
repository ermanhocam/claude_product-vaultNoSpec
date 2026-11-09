import { type Request, type RequestHandler, Router } from 'express';
import type { NoteRepository, Product, ProductRepository } from '../db/repositories.js';
import { notFound, unauthorized } from '../errors.js';
import { hasAdvancedCriteria, parseId, parseNoteContent, parseProductName, parseSearchCriteria } from '../validation.js';

export function createProductsRouter(
  products: ProductRepository,
  notes: NoteRepository,
  requireAuth: RequestHandler,
  optionalAuth: RequestHandler,
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

  // Name search (`q`) is public, like the listing above. The advanced filters — creation-date
  // range, note text and note author — are only for logged-in users, so `optionalAuth` attaches
  // the user when a token is present and the handler rejects advanced filters for anonymous
  // callers. Declared before `/:productId` so the literal "search" segment isn't a product id.
  router.get('/search', optionalAuth, (req, res) => {
    const criteria = parseSearchCriteria(req.query);
    if (!req.user && hasAdvancedCriteria(criteria)) {
      throw unauthorized('Log in to search by date, note text or author');
    }
    res.json(products.search(criteria));
  });

  // Creating a product needs a login, like deletion and note creation below.
  router.post('/', requireAuth, (req, res) => {
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
    const note = notes.create(product.id, parseNoteContent(req.body), req.user!.id);
    res.status(201).location(`/api/notes/${note.id}`).json(note);
  });

  return router;
}

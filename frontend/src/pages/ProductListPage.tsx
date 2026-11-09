import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DateChip } from '../components/DateChip';
import { DeleteProduct } from '../components/DeleteProduct';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { ProductForm } from '../components/ProductForm';
import { ProductSearch } from '../components/ProductSearch';
import { pluralize } from '../lib/text';
import { useResource } from '../lib/useResource';
import type { Product, ProductSearchCriteria } from '../types';

export interface ProductListLocationState {
  /** Name of a product that was just deleted on its detail page. */
  deletedProduct?: string;
}

const EMPTY_CRITERIA: ProductSearchCriteria = { query: '' };

/** True when any filter is set, so the page is showing search results rather than the full list. */
function isSearching(criteria: ProductSearchCriteria): boolean {
  return Boolean(
    criteria.query || criteria.from || criteria.to || criteria.noteText || criteria.author,
  );
}

/** A short human description of the active filters, for the results heading and empty state. */
function describeCriteria(criteria: ProductSearchCriteria): string {
  const parts: string[] = [];
  if (criteria.query) parts.push(`“${criteria.query}”`);
  if (criteria.from && criteria.to) parts.push(`created ${criteria.from} to ${criteria.to}`);
  else if (criteria.from) parts.push(`created on or after ${criteria.from}`);
  else if (criteria.to) parts.push(`created on or before ${criteria.to}`);
  if (criteria.noteText) parts.push(`a note containing “${criteria.noteText}”`);
  if (criteria.author) parts.push(`a note by ${criteria.author}`);
  return parts.join(', ');
}

export function ProductListPage() {
  // Empty criteria list everything; any filter runs a search. Name search is public, so it
  // works for everyone; the advanced filters are only offered to logged-in users.
  const [criteria, setCriteria] = useState<ProductSearchCriteria>(EMPTY_CRITERIA);
  const searching = isSearching(criteria);
  // Serialize the criteria so `useResource` refetches whenever any filter changes.
  const key = JSON.stringify(criteria);
  const { state, update, reload } = useResource(
    () => (searching ? api.searchProducts(criteria) : api.listProducts()),
    [key],
  );
  const { user } = useAuth();
  const [newestId, setNewestId] = useState<number | null>(null);

  const navigate = useNavigate();
  const { pathname, state: locationState } = useLocation();
  const deletedFromRoute = (locationState as ProductListLocationState | null)?.deletedProduct;
  // A new object per deletion, so the notice takes focus again even when it shows the same name.
  const [deleted, setDeleted] = useState<{ name: string } | null>(
    deletedFromRoute ? { name: deletedFromRoute } : null,
  );
  const deletedNoticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.title = 'Product Vault';
  }, []);

  useEffect(() => {
    if (deleted) deletedNoticeRef.current?.focus();
  }, [deleted]);

  // The notice keeps the name, so clear the router state: a reload shouldn't repeat it.
  useEffect(() => {
    if (deletedFromRoute) navigate(pathname, { replace: true, state: null });
  }, [deletedFromRoute, pathname, navigate]);

  async function handleCreate(name: string) {
    const product = await api.createProduct(name);
    setNewestId(product.id);
    // While a search is active a new product may not match it, so clear the filters to show the
    // full list (which re-fetches and includes the new product). Otherwise just prepend it.
    if (searching) {
      setCriteria(EMPTY_CRITERIA);
    } else if (state.status === 'success') {
      update((products) => [product, ...products]);
    } else {
      reload();
    }
  }

  function showDeleted(product: Product) {
    update((products) => products.filter((p) => p.id !== product.id));
    setDeleted({ name: product.name });
  }

  return (
    <section aria-labelledby="products-heading">
      <div className="page-header">
        <h1 id="products-heading" className="page-title">
          Products
        </h1>
        {state.status === 'success' && state.data.length > 0 && (
          <p className="page-header__meta">
            {searching
              ? `${pluralize(state.data.length, 'match', 'matches')} for ${describeCriteria(criteria)}`
              : pluralize(state.data.length, 'product')}
          </p>
        )}
      </div>

      {user && <ProductForm onCreate={handleCreate} />}

      <ProductSearch criteria={criteria} canUseAdvanced={Boolean(user)} onSearch={setCriteria} />

      {deleted && (
        <p ref={deletedNoticeRef} className="form-notice" role="status" tabIndex={-1}>
          “{deleted.name}” was deleted.
        </p>
      )}

      {state.status === 'loading' && <Loading>Loading products…</Loading>}

      {state.status === 'error' && (
        <ErrorNotice
          title="Products couldn’t be loaded."
          detail={state.error.message}
          action={
            <button className="button button--secondary" type="button" onClick={reload}>
              Try again
            </button>
          }
        />
      )}

      {state.status === 'success' &&
        (state.data.length === 0 ? (
          <EmptyState>
            {searching
              ? `No products match ${describeCriteria(criteria)}. Try different filters.`
              : user
                ? 'No products yet. Add your first one above to start keeping notes on it.'
                : 'No products yet. Log in to add the first one.'}
          </EmptyState>
        ) : (
          <ul className="product-grid">
            {state.data.map((product) => (
              <li key={product.id} className={product.id === newestId ? 'card product-card is-new' : 'card product-card'}>
                <Link className="product-card__link" to={`/products/${product.id}`}>
                  <span className="product-card__name">{product.name}</span>
                </Link>
                <div className="product-card__footer">
                  <DateChip iso={product.createdAt} />
                  {user && (
                    <DeleteProduct product={product} onDeleted={showDeleted} buttonLabel={`Delete ${product.name}`}>
                      Delete
                    </DeleteProduct>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

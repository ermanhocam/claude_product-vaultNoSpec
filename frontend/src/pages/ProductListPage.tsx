import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DateChip } from '../components/DateChip';
import { DeleteProduct } from '../components/DeleteProduct';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { ProductForm } from '../components/ProductForm';
import { pluralize } from '../lib/text';
import { useResource } from '../lib/useResource';
import type { Product } from '../types';

export interface ProductListLocationState {
  /** Name of a product that was just deleted on its detail page. */
  deletedProduct?: string;
}

export function ProductListPage() {
  const { state, update, reload } = useResource(() => api.listProducts(), []);
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
    if (state.status === 'success') {
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
          <p className="page-header__meta">{pluralize(state.data.length, 'product')}</p>
        )}
      </div>

      {user && <ProductForm onCreate={handleCreate} />}

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
            {user
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

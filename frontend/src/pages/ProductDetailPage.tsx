import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { useAuth, useAuthLinkState } from '../auth/AuthContext';
import { DateChip } from '../components/DateChip';
import { DeleteProduct } from '../components/DeleteProduct';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { NoteForm } from '../components/NoteForm';
import { NoteItem } from '../components/NoteItem';
import { pluralize } from '../lib/text';
import { useResource } from '../lib/useResource';
import type { Note, Product } from '../types';
import type { ProductListLocationState } from './ProductListPage';

function BackLink() {
  return (
    <Link className="back-link" to="/">
      <span aria-hidden="true">←</span> Back to products
    </Link>
  );
}

/** Shown instead of the note form to visitors who aren't logged in. */
function LoginPrompt() {
  const linkState = useAuthLinkState();
  return (
    <div className="card composer login-prompt">
      <p className="login-prompt__text">
        <Link to="/login" state={linkState}>
          Log in
        </Link>{' '}
        to add notes to this product.
      </p>
      <p className="login-prompt__meta">
        No account yet?{' '}
        <Link to="/register" state={linkState}>
          Create one
        </Link>
      </p>
    </div>
  );
}

export function ProductDetailPage() {
  const { productId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { state, update, reload } = useResource(() => api.getProduct(productId), [productId]);

  const productName = state.status === 'success' ? state.data.name : null;
  useEffect(() => {
    document.title = productName ? `${productName} | Product Vault` : 'Product Vault';
  }, [productName]);

  if (state.status === 'loading') {
    return <Loading>Loading product…</Loading>;
  }

  if (state.status === 'error') {
    const notFound = state.error.status === 404;
    return (
      <>
        <BackLink />
        <ErrorNotice
          title={notFound ? 'This product doesn’t exist.' : 'This product couldn’t be loaded.'}
          detail={
            notFound
              ? 'The requested product does not exist. It may have been removed, or the link may be wrong.'
              : state.error.message
          }
          action={
            notFound ? (
              <Link className="button button--secondary" to="/">
                Go to all products
              </Link>
            ) : (
              <button className="button button--secondary" type="button" onClick={reload}>
                Try again
              </button>
            )
          }
        />
      </>
    );
  }

  const product = state.data;
  const setNotes = (change: (notes: Note[]) => Note[]) =>
    update((current) => ({ ...current, notes: change(current.notes) }));

  async function addNote(content: string) {
    const note = await api.createNote(product.id, content);
    setNotes((notes) => [note, ...notes]);
  }

  async function saveNote(noteId: number, content: string) {
    const updated = await api.updateNote(noteId, content);
    setNotes((notes) => notes.map((note) => (note.id === noteId ? updated : note)));
  }

  async function deleteNote(noteId: number) {
    try {
      await api.deleteNote(noteId);
    } catch (error) {
      // Already gone on the server: the outcome the user wanted, so just drop it here too.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    setNotes((notes) => notes.filter((note) => note.id !== noteId));
  }

  function showDeleted(deleted: Product) {
    // Replace this page, so Back doesn't return to a product that no longer exists.
    const listState: ProductListLocationState = { deletedProduct: deleted.name };
    navigate('/', { replace: true, state: listState });
  }

  return (
    <article>
      <BackLink />
      <header className="page-header page-header--stacked">
        <h1 className="page-title">{product.name}</h1>
        <div className="page-header__row">
          <DateChip iso={product.createdAt} withTime prefix="Added" />
          {user && (
            <DeleteProduct product={product} onDeleted={showDeleted}>
              Delete product
            </DeleteProduct>
          )}
        </div>
      </header>

      {user ? <NoteForm onAdd={addNote} /> : <LoginPrompt />}

      <section className="notes" aria-labelledby="notes-heading">
        <div className="section-header">
          <h2 id="notes-heading" className="section-header__title">
            Notes
          </h2>
          {product.notes.length > 0 && <p className="section-header__meta">{pluralize(product.notes.length, 'note')}</p>}
        </div>

        {product.notes.length === 0 ? (
          <EmptyState>{user ? 'No notes yet. Write down your first observation above.' : 'No notes yet.'}</EmptyState>
        ) : (
          <ol className="note-list" aria-label={`Notes on ${product.name}, newest first`}>
            {product.notes.map((note) => {
              const canEdit = user != null && user.id === note.author;
              return (
                <NoteItem
                  key={note.id}
                  note={note}
                  onSave={canEdit ? (content) => saveNote(note.id, content) : undefined}
                  onDelete={user ? () => deleteNote(note.id) : undefined}
                />
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}

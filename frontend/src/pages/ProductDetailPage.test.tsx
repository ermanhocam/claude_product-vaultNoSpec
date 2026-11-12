import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../lib/format';
import type { Note } from '../types';
import { apiUrl, backend, server } from '../test/mockApi';
import { deferred, note, product, renderApp, signIn } from '../test/utils';

const moka = product({ id: 1, name: 'Moka pot' });
// Authored by alice (id 1), who signs in by default, so her Edit control shows on them.
const first = note({ id: 10, content: 'Arrived with a dented lid', author: 1, createdAt: '2026-10-18T07:15:00.000Z' });
const second = note({ id: 11, content: 'Brews in about 5 minutes\non a medium flame', author: 1, createdAt: '2026-10-19T18:40:00.000Z' });

const notesList = () => screen.getByRole('list', { name: /notes on moka pot/i });
const noteContents = () =>
  within(notesList())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.note-card__content')?.textContent);
const noteItem = (text: string) => screen.getByText(text, { exact: false }).closest('li')!;
const storedNote = (id: number) => backend.notes.find((n) => n.id === id);
const productRequests = () => backend.requestsTo('GET', '/api/products/1');

/** Opens Moka pot's page; logged in unless `loggedIn` is false, since adding notes requires it. */
async function openProduct(notes: Note[] = [first, second], { loggedIn = true } = {}) {
  backend.seed({ products: [moka], notes });
  if (loggedIn) signIn('alice');
  const view = renderApp('/products/1');
  await screen.findByRole('heading', { level: 1, name: 'Moka pot' });
  return view;
}

describe('Product detail view (Requirements 3 and 5)', () => {
  it('requests the product identified in the URL', async () => {
    await openProduct();
    expect(productRequests()).toHaveLength(1);
  });

  it('shows the product name and every note with its content and creation timestamp, newest first', async () => {
    await openProduct();

    expect(noteContents()).toEqual([second.content, first.content]);
    expect(screen.getByText('2 notes')).toBeInTheDocument();

    const item = noteItem('Arrived with a dented lid');
    expect(within(item).getByText(formatDateTime(first.createdAt))).toBeInTheDocument();
    expect(item.querySelector('time')).toHaveAttribute('datetime', first.createdAt);
  });

  it('shows an empty state when the product has no notes', async () => {
    await openProduct([]);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /notes on/i })).not.toBeInTheDocument();
  });

  it('shows a "product does not exist" message for a 404', async () => {
    renderApp('/products/999');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/this product doesn.t exist/i);
    expect(alert).toHaveTextContent('The requested product does not exist');
    expect(within(alert).getByRole('link', { name: 'Go to all products' })).toHaveAttribute('href', '/');
  });

  it('shows a load error for other failures and can retry', async () => {
    backend.seed({ products: [moka] });
    server.use(
      http.get(
        apiUrl('/products/:productId'),
        () => HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
        { once: true },
      ),
    );
    const { user } = renderApp('/products/1');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/this product couldn.t be loaded/i);

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Moka pot' })).toBeInTheDocument();
  });
});

describe('Note form visibility (Requirement 17)', () => {
  const loginPrompt = () => screen.getByText(/to add notes to this product/i).closest('.login-prompt') as HTMLElement;

  it('shows the note form to logged-in users', async () => {
    await openProduct();

    expect(screen.getByLabelText('New note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.queryByText(/to add notes to this product/i)).not.toBeInTheDocument();
  });

  it('hides the note form from visitors and links them to the login page', async () => {
    await openProduct([first, second], { loggedIn: false });

    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(loginPrompt()).toHaveTextContent('Log in to add notes to this product.');
    expect(within(loginPrompt()).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(within(loginPrompt()).getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/register');
    expect(noteContents()).toEqual([second.content, first.content]);
  });

  it('does not point visitors to a note form they cannot see', async () => {
    await openProduct([], { loggedIn: false });
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
  });

  it('opens the login page from the prompt', async () => {
    const { user } = await openProduct([], { loggedIn: false });

    await user.click(within(loginPrompt()).getByRole('link', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
  });
});

describe('Adding a note (Requirement 4)', () => {
  it('shows the new note at the top of the list without reloading', async () => {
    const { user } = await openProduct();

    const textarea = screen.getByLabelText('New note');
    await user.type(textarea, 'Descaled today');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(noteContents()).toEqual(['Descaled today', second.content, first.content]));
    expect(backend.notesFor(1).map((n) => n.content)).toContain('Descaled today');
    expect(productRequests()).toHaveLength(1);
    expect(textarea).toHaveValue('');
  });

  it('replaces the empty state with the first note', async () => {
    const { user } = await openProduct([]);

    await user.type(screen.getByLabelText('New note'), 'First impressions');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(noteContents()).toEqual(['First impressions']));
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument();
  });

  it('submits with Ctrl+Enter', async () => {
    const { user } = await openProduct([]);

    await user.type(screen.getByLabelText('New note'), 'Quick note{Control>}{Enter}{/Control}');

    await waitFor(() => expect(backend.notesFor(1).map((n) => n.content)).toEqual(['Quick note']));
  });

  it('requires content before sending anything', async () => {
    const { user } = await openProduct();

    await user.type(screen.getByLabelText('New note'), '  \n ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Note content is required');
    expect(backend.requestsTo('POST', '/api/products/1/notes')).toHaveLength(0);
  });

  it('rejects content over 5000 characters before sending it', async () => {
    const { user } = await openProduct();

    await user.click(screen.getByLabelText('New note'));
    await user.paste('x'.repeat(5001));
    expect(screen.getByText('5,001 / 5,000 characters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Note content must not exceed 5000 characters');
    expect(backend.requestsTo('POST', '/api/products/1/notes')).toHaveLength(0);
  });

  it('shows errors returned by the backend and keeps the draft', async () => {
    server.use(
      http.post(apiUrl('/products/:productId/notes'), () =>
        HttpResponse.json({ error: 'Product not found' }, { status: 404 }),
      ),
    );
    const { user } = await openProduct();

    await user.type(screen.getByLabelText('New note'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found');
    expect(screen.getByLabelText('New note')).toHaveValue('Draft');
  });
});

describe('Deleting a note (Requirement 9)', () => {
  it('hides the Delete action from visitors who are not logged in', async () => {
    await openProduct([first, second], { loggedIn: false });

    const items = within(notesList()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(within(item).queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
    }
  });

  it('asks for confirmation before deleting', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete this note?');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(backend.requestsTo('DELETE', '/api/notes/10')).toHaveLength(0);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const { user } = await openProduct();
    const item = noteItem(first.content);

    await user.click(within(item).getByRole('button', { name: /^delete/i }));
    await user.click(within(item).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(noteContents()).toEqual([second.content, first.content]);
    expect(backend.requestsTo('DELETE', '/api/notes/10')).toHaveLength(0);
    expect(storedNote(10)).toBeDefined();
    expect(within(item).getByRole('button', { name: /^delete/i })).toHaveFocus();
  });

  it('cancels the confirmation with Escape', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(backend.requestsTo('DELETE', '/api/notes/10')).toHaveLength(0);
  });

  it('removes the note after confirming, without reloading', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    await waitFor(() => expect(noteContents()).toEqual([second.content]));
    expect(backend.requestsTo('DELETE', '/api/notes/10')).toHaveLength(1);
    expect(storedNote(10)).toBeUndefined();
    expect(productRequests()).toHaveLength(1);
  });

  it('shows the empty state after deleting the last note', async () => {
    const { user } = await openProduct([first]);

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('keeps the note and shows the error when deletion fails', async () => {
    server.use(
      http.delete(apiUrl('/notes/:noteId'), () =>
        HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
      ),
    );
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred');
    expect(noteContents()).toEqual([second.content, first.content]);
  });

  it('drops the note if the backend says it no longer exists', async () => {
    const { user } = await openProduct();
    backend.notes = backend.notes.filter((n) => n.id !== first.id); // deleted elsewhere meanwhile

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    await waitFor(() => expect(noteContents()).toEqual([second.content]));
  });
});

describe('Deleting a product (Requirement 19)', () => {
  type User = ReturnType<typeof renderApp>['user'];

  const mokaQuestion = 'Delete “Moka pot” and all of its notes? This can’t be undone.';
  const mokaNotice = '“Moka pot” was deleted.';
  const emptyList = 'No products yet. Add your first one above to start keeping notes on it.';
  const deleteRequests = () => backend.requestsTo('DELETE', '/api/products/1');

  /** Matches the whole (whitespace-normalised) text content, not just a part of it. */
  const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

  /** Clicks the page's Delete product button and returns the confirmation it opens. */
  async function openConfirmation(user: User) {
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    return screen.getByRole('alertdialog');
  }

  async function confirmDeletion(user: User) {
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete product' }));
  }

  it('T19.5a hides Delete product from visitors who are not logged in', async () => {
    await openProduct([first, second], { loggedIn: false });
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
  });

  it('T19.5b shows Delete product to logged-in users', async () => {
    await openProduct();
    expect(screen.getByRole('button', { name: 'Delete product' })).toBeInTheDocument();
  });

  it('sends the login token with the delete request', async () => {
    const { user } = await openProduct();

    await openConfirmation(user);
    await confirmDeletion(user);

    await screen.findByText(mokaNotice);
    expect(deleteRequests()).toHaveLength(1);
    expect(deleteRequests()[0]!.authorization).toMatch(/^Bearer /);
  });

  it('keeps the product and asks the user to log in again when the API rejects the session', async () => {
    server.use(
      http.delete(apiUrl('/products/:productId'), () => HttpResponse.json({ error: 'Token expired' }, { status: 401 }), {
        once: true,
      }),
    );
    const { user } = await openProduct();

    await openConfirmation(user);
    await confirmDeletion(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired. Log in again to continue.');
    expect(backend.products).toEqual([moka]);
  });

  it('T19.7b asks for confirmation, naming the product and its notes, before deleting', async () => {
    const { user } = await openProduct([first, second]);

    const dialog = await openConfirmation(user);

    expect(within(dialog).getByText(mokaQuestion)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(deleteRequests()).toHaveLength(0);
  });

  it('T19.7d shows the product name as plain text in the confirmation and the notice', async () => {
    const name = '<b>Kettle</b> & “Pro”';
    backend.seed({ products: [product({ id: 1, name })] });
    signIn('alice');
    const { user } = renderApp('/products/1');
    await screen.findByRole('heading', { level: 1, name });

    const dialog = await openConfirmation(user);
    expect(within(dialog).getByText(`Delete “${name}” and all of its notes? This can’t be undone.`)).toBeInTheDocument();
    expect(dialog.querySelector('b')).toBeNull();

    await confirmDeletion(user);

    await screen.findByText(emptyList);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(exactly(`“${name}” was deleted.`));
    expect(notice.querySelector('b')).toBeNull();
  });

  it('T19.8c keeps the product when the confirmation is cancelled', async () => {
    const { user } = await openProduct();

    const dialog = await openConfirmation(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Moka pot' })).toBeInTheDocument();
    expect(noteContents()).toEqual([second.content, first.content]);
    expect(deleteRequests()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Delete product' })).toHaveFocus();
  });

  it('T19.8d cancels the confirmation with Escape', async () => {
    const { user } = await openProduct();

    await openConfirmation(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deleteRequests()).toHaveLength(0);
  });

  it('T19.9a deletes the product and its notes, then shows the product list', async () => {
    backend.seed({ products: [product({ id: 2, name: 'French press', createdAt: '2026-10-21T09:30:00.000Z' })] });
    const { user } = await openProduct([first, second]);

    await openConfirmation(user);
    await confirmDeletion(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    const list = await screen.findByRole('list');
    expect(within(list).getByText('French press')).toBeInTheDocument();
    expect(within(list).queryByText('Moka pot')).not.toBeInTheDocument();
    expect(deleteRequests()).toHaveLength(1);
    expect(backend.products.map((p) => p.name)).toEqual(['French press']);
    expect(backend.notes.filter((n) => n.productId === 1)).toEqual([]);
  });

  it('T19.9b stays on the product until the server confirms the deletion', async () => {
    const release = deferred();
    server.use(
      http.delete(apiUrl('/products/:productId'), async () => {
        await release.promise;
        backend.products = backend.products.filter((p) => p.id !== moka.id);
        backend.notes = backend.notes.filter((n) => n.productId !== moka.id);
        return HttpResponse.json({ id: moka.id, deleted: true });
      }),
    );
    const { user } = await openProduct();

    await openConfirmation(user);
    await confirmDeletion(user);

    const deleting = await screen.findByRole('button', { name: 'Deleting…' });
    expect(deleting).toBeDisabled();
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Moka pot' })).toBeInTheDocument();
    await waitFor(() => expect(deleteRequests()).toHaveLength(1));

    await user.click(deleting);
    expect(deleteRequests()).toHaveLength(1);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    release.resolve();

    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(deleteRequests()).toHaveLength(1);
  });

  it('T19.11b shows a focused notice naming the deleted product on the product list', async () => {
    const { user } = await openProduct();

    await openConfirmation(user);
    await confirmDeletion(user);

    await screen.findByText(emptyList);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(exactly(mokaNotice));
    expect(notice).toHaveFocus();
  });

  it('T19.12b treats a 404 from the backend as a successful deletion', async () => {
    const { user } = await openProduct();
    // Deleted elsewhere meanwhile, so the fake backend answers 404 "Product not found".
    backend.products = backend.products.filter((p) => p.id !== moka.id);
    backend.notes = backend.notes.filter((n) => n.productId !== moka.id);

    await openConfirmation(user);
    await confirmDeletion(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    await screen.findByText(emptyList);
    expect(screen.getByRole('status')).toHaveTextContent(exactly(mokaNotice));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(deleteRequests()).toHaveLength(1);
  });

  it('T19.13b keeps the product and the confirmation open when the server fails', async () => {
    server.use(
      http.delete(apiUrl('/products/:productId'), () =>
        HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
      ),
    );
    const { user } = await openProduct();

    await openConfirmation(user);
    await confirmDeletion(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(exactly('An unexpected error occurred'));
    expect(screen.getByRole('heading', { level: 1, name: 'Moka pot' })).toBeInTheDocument();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Delete product' })).toBeEnabled();
  });
});

describe('Edit control gating (Requirement 5)', () => {
  const editButtonIn = (item: HTMLElement) => within(item).queryByRole('button', { name: /^edit/i });

  it('hides Edit on every note when nobody is logged in (Req 5.1)', async () => {
    await openProduct([first, second], { loggedIn: false });

    const items = within(notesList()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(editButtonIn(item)).not.toBeInTheDocument();
    }
  });

  it('shows Edit only on the logged-in user’s own notes (Req 5.2, 5.3)', async () => {
    // alice signs in with id 1, so a note authored by 1 is hers; 2 is another user's; null is authorless.
    const own = note({ id: 20, content: 'My own note', author: 1, createdAt: '2026-10-20T08:00:00.000Z' });
    const others = note({ id: 21, content: 'Someone else’s note', author: 2, createdAt: '2026-10-20T08:01:00.000Z' });
    const authorless = note({ id: 22, content: 'Legacy authorless note', author: null, createdAt: '2026-10-20T08:02:00.000Z' });

    await openProduct([own, others, authorless]); // logs in alice (id 1) by default

    expect(editButtonIn(noteItem(own.content))).toBeInTheDocument();
    expect(editButtonIn(noteItem(others.content))).not.toBeInTheDocument();
    expect(editButtonIn(noteItem(authorless.content))).not.toBeInTheDocument();
  });
});

describe('Editing a note (Requirement 10)', () => {
  it('shows the updated content after saving, without reloading', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^edit/i }));
    const editor = screen.getByRole('textbox', { name: /edit note/i });
    expect(editor).toHaveValue(first.content);
    expect(editor).toHaveFocus();

    await user.clear(editor);
    await user.type(editor, 'Lid replaced under warranty');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(noteContents()).toEqual([second.content, 'Lid replaced under warranty']));
    expect(storedNote(10)?.content).toBe('Lid replaced under warranty');
    expect(productRequests()).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: /edit note/i })).not.toBeInTheDocument();
  });

  it('requires content when editing', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^edit/i }));
    await user.clear(screen.getByRole('textbox', { name: /edit note/i }));
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Note content is required');
    expect(backend.requestsTo('PUT', '/api/notes/10')).toHaveLength(0);
  });

  it('rejects edits over 5000 characters', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^edit/i }));
    const editor = screen.getByRole('textbox', { name: /edit note/i });
    await user.clear(editor);
    await user.paste('y'.repeat(5001));
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Note content must not exceed 5000 characters');
    expect(backend.requestsTo('PUT', '/api/notes/10')).toHaveLength(0);
  });

  it('discards changes on Cancel or Escape', async () => {
    const { user } = await openProduct();
    const item = noteItem(first.content);

    await user.click(within(item).getByRole('button', { name: /^edit/i }));
    await user.type(screen.getByRole('textbox', { name: /edit note/i }), ' and more');
    await user.click(within(item).getByRole('button', { name: 'Cancel' }));
    expect(noteContents()).toEqual([second.content, first.content]);
    expect(within(item).getByRole('button', { name: /^edit/i })).toHaveFocus();

    await user.click(within(item).getByRole('button', { name: /^edit/i }));
    await user.type(screen.getByRole('textbox', { name: /edit note/i }), ' and more{Escape}');
    expect(noteContents()).toEqual([second.content, first.content]);
    expect(backend.requestsTo('PUT', '/api/notes/10')).toHaveLength(0);
  });

  it('does not call the backend when nothing changed', async () => {
    const { user } = await openProduct();

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^edit/i }));
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(screen.queryByRole('textbox', { name: /edit note/i })).not.toBeInTheDocument();
    expect(backend.requestsTo('PUT', '/api/notes/10')).toHaveLength(0);
  });

  it('keeps the editor open and shows the error when saving fails', async () => {
    const { user } = await openProduct();
    backend.notes = backend.notes.filter((n) => n.id !== first.id); // deleted elsewhere meanwhile

    await user.click(within(noteItem(first.content)).getByRole('button', { name: /^edit/i }));
    await user.type(screen.getByRole('textbox', { name: /edit note/i }), '!');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Note not found');
    expect(screen.getByRole('textbox', { name: /edit note/i })).toHaveValue(`${first.content}!`);
  });
});

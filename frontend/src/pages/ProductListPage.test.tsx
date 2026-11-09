import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { formatDate } from '../lib/format';
import { apiUrl, backend, server } from '../test/mockApi';
import { deferred, note, product, renderApp, signIn } from '../test/utils';

const older = product({ id: 1, name: 'Moka pot', createdAt: '2026-10-01T08:00:00.000Z' });
const newer = product({ id: 2, name: 'Noise-cancelling headphones', createdAt: '2026-10-15T08:00:00.000Z' });

const productNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.product-card__name')?.textContent);

const listRequests = () => backend.requestsTo('GET', '/api/products');
const createRequests = () => backend.requestsTo('POST', '/api/products');

describe('Product list (Requirement 2)', () => {
  it('shows a loading message while products are fetched', async () => {
    const release = deferred();
    server.use(
      http.get(apiUrl('/products'), async () => {
        await release.promise;
        return HttpResponse.json([]);
      }),
    );

    renderApp('/');

    expect(screen.getByRole('status')).toHaveTextContent('Loading products…');
    release.resolve();
    await screen.findByText(/no products yet/i);
  });

  it("displays each product's name, newest first as returned by the backend", async () => {
    backend.seed({ products: [older, newer] });

    renderApp('/');

    await screen.findByText('Noise-cancelling headphones');
    expect(productNames()).toEqual(['Noise-cancelling headphones', 'Moka pot']);
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByText(formatDate(older.createdAt)).closest('time')).toHaveAttribute('datetime', older.createdAt);
  });

  it('links each product to its detail view', async () => {
    backend.seed({ products: [older] });
    renderApp('/');
    expect(await screen.findByRole('link', { name: /moka pot/i })).toHaveAttribute('href', '/products/1');
  });

  it('shows an empty state when there are no products', async () => {
    renderApp('/');

    expect(await screen.findByText(/no products yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows an error message when products cannot be loaded, and can retry', async () => {
    backend.seed({ products: [older] });
    server.use(
      http.get(apiUrl('/products'), () => HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }), {
        once: true,
      }),
    );

    const { user } = renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/products couldn.t be loaded/i);
    expect(alert).toHaveTextContent('An unexpected error occurred');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Moka pot')).toBeInTheDocument();
    expect(listRequests()).toHaveLength(2);
  });

  it('tells the user when the backend cannot be reached', async () => {
    server.use(http.get(apiUrl('/products'), () => HttpResponse.error()));

    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the Product Vault API at http://localhost:3001. Make sure the backend is running.",
    );
  });
});

describe('Creating a product (Requirement 1)', () => {
  // Adding a product needs a login, so each test signs in before rendering.
  it('adds the new product to the top of the list without reloading the page', async () => {
    backend.seed({ products: [older] });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    const input = screen.getByLabelText('Product name');
    await user.type(input, 'Noise-cancelling headphones');
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    await waitFor(() => expect(productNames()).toEqual(['Noise-cancelling headphones', 'Moka pot']));
    expect(backend.products.map((p) => p.name)).toEqual(['Moka pot', 'Noise-cancelling headphones']);
    expect(listRequests()).toHaveLength(1); // no refetch, no reload
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('adds the first product, replacing the empty state', async () => {
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText(/no products yet/i);

    await user.type(screen.getByLabelText('Product name'), 'Moka pot{Enter}');

    expect(await screen.findByRole('link', { name: /moka pot/i })).toBeInTheDocument();
    expect(screen.queryByText(/no products yet/i)).not.toBeInTheDocument();
  });

  it('hides the add-product form from visitors who are not logged in', async () => {
    renderApp('/');
    await screen.findByText(/no products yet/i);

    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument();
    expect(screen.getByText(/log in to add the first one/i)).toBeInTheDocument();
  });

  it('requires a name before sending anything to the backend', async () => {
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText(/no products yet/i);

    await user.type(screen.getByLabelText('Product name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Product name is required');
    expect(screen.getByLabelText('Product name')).toHaveAttribute('aria-invalid', 'true');
    expect(createRequests()).toHaveLength(0);
  });

  it('rejects names over 200 characters before sending them', async () => {
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText(/no products yet/i);

    await user.click(screen.getByLabelText('Product name'));
    await user.paste('a'.repeat(201));
    expect(screen.getByText('201 / 200 characters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add product' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Product name must not exceed 200 characters');
    expect(createRequests()).toHaveLength(0);
  });

  it('shows validation errors returned by the backend and keeps the typed name', async () => {
    server.use(
      http.post(apiUrl('/products'), () =>
        HttpResponse.json({ error: 'Product name must not exceed 200 characters' }, { status: 400 }),
      ),
    );
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText(/no products yet/i);

    await user.type(screen.getByLabelText('Product name'), 'Kettle{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Product name must not exceed 200 characters');
    expect(screen.getByLabelText('Product name')).toHaveValue('Kettle');
  });

  it('disables the button while the product is being created', async () => {
    const release = deferred();
    server.use(
      http.post(apiUrl('/products'), async () => {
        await release.promise;
        return HttpResponse.json(older, { status: 201 });
      }),
    );
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText(/no products yet/i);

    await user.type(screen.getByLabelText('Product name'), 'Moka pot{Enter}');

    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled();
    release.resolve();
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeEnabled();
  });
});

describe('Navigating to a product (Requirement 3.1)', () => {
  it('opens the product detail view when a product is selected', async () => {
    backend.seed({ products: [older] });
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('link', { name: /moka pot/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Moka pot' })).toBeInTheDocument();
    expect(backend.requestsTo('GET', '/api/products/1')).toHaveLength(1);
  });
});

describe('Deleting a product (Requirement 19)', () => {
  type User = ReturnType<typeof renderApp>['user'];

  // Newest first, so the list shows Moka pot, French press, Kettle.
  const moka = product({ id: 1, name: 'Moka pot', createdAt: '2026-10-21T08:00:00.000Z' });
  const frenchPress = product({ id: 2, name: 'French press', createdAt: '2026-10-20T08:00:00.000Z' });
  const kettle = product({ id: 3, name: 'Kettle', createdAt: '2026-10-19T08:00:00.000Z' });

  const question = (name: string) => `Delete “${name}” and all of its notes? This can’t be undone.`;
  const notice = (name: string) => `“${name}” was deleted.`;
  const emptyList = 'No products yet. Add your first one above to start keeping notes on it.';
  const unreachable = "Can't reach the Product Vault API at http://localhost:3001. Make sure the backend is running.";

  /** Paths of every DELETE request the fake backend received, in order. */
  const deletePaths = () => backend.requests.filter((r) => r.method === 'DELETE').map((r) => r.path);

  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Matches the whole (whitespace-normalised) text content, not just a part of it. */
  const exactly = (text: string) => new RegExp(`^${escape(text)}$`);

  /** A product's card: the list item holding the link to the product. */
  const card = (name: string) => screen.getByRole('link', { name: new RegExp(`^${escape(name)}`) }).closest('li')!;
  const cardNames = () =>
    within(screen.getByRole('list'))
      .getAllByRole('link')
      .map((link) => link.textContent);
  const deleteButton = (name: string) => within(card(name)).getByRole('button', { name: `Delete ${name}` });

  /** Opens the product list (logged in unless `loggedIn` is false, since deleting needs it) and waits for the cards. */
  async function openList(products = [moka, frenchPress], { loggedIn = true } = {}) {
    backend.seed({ products });
    if (loggedIn) signIn('alice');
    const view = renderApp('/');
    await screen.findByRole('list');
    return view;
  }

  /** Clicks the card's Delete button and returns the confirmation it opens inside that card. */
  async function openConfirmation(user: User, name: string) {
    await user.click(deleteButton(name));
    return within(card(name)).getByRole('alertdialog');
  }

  async function confirmDeletion(user: User, name: string) {
    await user.click(within(within(card(name)).getByRole('alertdialog')).getByRole('button', { name: 'Delete product' }));
  }

  async function deleteFromCard(user: User, name: string) {
    await openConfirmation(user, name);
    await confirmDeletion(user, name);
  }

  it('T19.6a hides the Delete buttons from visitors who are not logged in', async () => {
    await openList([moka, frenchPress], { loggedIn: false });

    expect(within(screen.getByRole('list')).queryAllByRole('button')).toHaveLength(0);
    expect(within(card('Moka pot')).getByRole('link', { name: 'Moka pot' })).toHaveAttribute('href', '/products/1');
    expect(within(card('French press')).getByRole('link', { name: 'French press' })).toHaveAttribute('href', '/products/2');
  });

  it('T19.6b shows a Delete button on every card to logged-in users', async () => {
    await openList([moka, frenchPress], { loggedIn: true });

    expect(within(card('Moka pot')).getByRole('button', { name: 'Delete Moka pot' })).toBeInTheDocument();
    expect(within(card('French press')).getByRole('button', { name: 'Delete French press' })).toBeInTheDocument();
  });

  it('T19.7a asks for confirmation inside the card, naming the product and its notes, before deleting', async () => {
    const { user } = await openList();

    const dialog = await openConfirmation(user, 'Moka pot');

    expect(within(dialog).getByText(question('Moka pot'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(card('French press')).queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(backend.requestsTo('GET', '/api/products/1')).toHaveLength(0);
    expect(deletePaths()).toEqual([]);
  });

  it('T19.8a keeps the product when the card confirmation is cancelled', async () => {
    const { user } = await openList();

    const dialog = await openConfirmation(user, 'Moka pot');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cardNames()).toEqual(['Moka pot', 'French press']);
    expect(deletePaths()).toEqual([]);
    expect(deleteButton('Moka pot')).toHaveFocus();
    expect(backend.products.map((p) => p.name)).toEqual(['Moka pot', 'French press']);
  });

  it('T19.8b cancels the card confirmation with Escape', async () => {
    const { user } = await openList();

    await openConfirmation(user, 'Moka pot');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(deletePaths()).toEqual([]);
    expect(deleteButton('Moka pot')).toHaveFocus();
  });

  it('T19.10a removes the deleted card without reloading, keeping the others in order', async () => {
    // French press is the newest here, so Moka pot is the middle card: French press, Moka pot, Kettle.
    const { user } = await openList([moka, { ...frenchPress, createdAt: '2026-10-22T08:00:00.000Z' }, kettle]);

    await deleteFromCard(user, 'Moka pot');

    await waitFor(() => expect(cardNames()).toEqual(['French press', 'Kettle']));
    expect(deletePaths()).toEqual(['/api/products/1']);
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(listRequests()).toHaveLength(1);
  });

  it('T19.10b shows the empty state after deleting the last product', async () => {
    const { user } = await openList([moka]);

    await deleteFromCard(user, 'Moka pot');

    expect(await screen.findByText(emptyList)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ products?$/)).not.toBeInTheDocument();
  });

  it("T19.10c keeps another card's open confirmation with that card", async () => {
    const { user } = await openList([moka, frenchPress]);

    await openConfirmation(user, 'French press');
    await deleteFromCard(user, 'Moka pot');

    await waitFor(() => expect(cardNames()).toEqual(['French press']));
    const dialog = within(card('French press')).getByRole('alertdialog');
    expect(within(dialog).getByText(question('French press'))).toBeInTheDocument();

    await confirmDeletion(user, 'French press');

    expect(await screen.findByText(emptyList)).toBeInTheDocument();
    expect(deletePaths()).toEqual(['/api/products/1', '/api/products/2']);
  });

  it('T19.11a shows a focused notice above the grid naming the product deleted from its card', async () => {
    const { user } = await openList([moka, frenchPress]);

    await deleteFromCard(user, 'Moka pot');

    await waitFor(() => expect(cardNames()).toEqual(['French press']));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(exactly(notice('Moka pot')));
    expect(status).toHaveFocus();
    expect(status.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('T19.11d replaces the notice when a second product is deleted', async () => {
    const { user } = await openList([moka, frenchPress, kettle]);

    await deleteFromCard(user, 'Moka pot');
    await waitFor(() => expect(cardNames()).toEqual(['French press', 'Kettle']));
    await deleteFromCard(user, 'French press');
    await waitFor(() => expect(cardNames()).toEqual(['Kettle']));

    const notices = screen.getAllByRole('status');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(exactly(notice('French press')));
    expect(notices[0]).toHaveFocus();
  });

  it('T19.12a treats a 404 on a card deletion as a successful deletion', async () => {
    const { user } = await openList([moka, frenchPress]);
    // Deleted elsewhere meanwhile, so the fake backend answers 404 "Product not found".
    backend.products = backend.products.filter((p) => p.id !== moka.id);

    await deleteFromCard(user, 'Moka pot');

    await waitFor(() => expect(cardNames()).toEqual(['French press']));
    expect(screen.getByRole('status')).toHaveTextContent(exactly(notice('Moka pot')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(deletePaths()).toEqual(['/api/products/1']);
  });

  it('T19.13a keeps the card and its confirmation open when the server fails', async () => {
    server.use(
      http.delete(apiUrl('/products/:productId'), () =>
        HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
      ),
    );
    const { user } = await openList([moka, frenchPress]);

    await deleteFromCard(user, 'Moka pot');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(exactly('An unexpected error occurred'));
    expect(card('Moka pot')).toContainElement(alert);
    expect(cardNames()).toEqual(['Moka pot', 'French press']);
    const dialog = within(card('Moka pot')).getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Delete product' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('T19.13c tells the user when the backend cannot be reached and keeps the card', async () => {
    server.use(http.delete(apiUrl('/products/:productId'), () => HttpResponse.error()));
    const { user } = await openList([moka, frenchPress]);

    await deleteFromCard(user, 'Moka pot');

    expect(await screen.findByRole('alert')).toHaveTextContent(exactly(unreachable));
    expect(cardNames()).toEqual(['Moka pot', 'French press']);
  });

  it('T19.13d deletes the product when Delete product is clicked again after an error', async () => {
    server.use(
      http.delete(
        apiUrl('/products/:productId'),
        () => HttpResponse.json({ error: 'An unexpected error occurred' }, { status: 500 }),
        { once: true },
      ),
    );
    const { user } = await openList([moka, frenchPress]);

    await deleteFromCard(user, 'Moka pot');
    expect(await screen.findByRole('alert')).toHaveTextContent(exactly('An unexpected error occurred'));

    await confirmDeletion(user, 'Moka pot');

    await waitFor(() => expect(cardNames()).toEqual(['French press']));
    expect(deletePaths()).toEqual(['/api/products/1', '/api/products/1']);
    expect(screen.queryByText('An unexpected error occurred')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(exactly(notice('Moka pot')));
  });
});

describe('Searching products (public search)', () => {
  const moka = product({ id: 1, name: 'Moka pot', createdAt: '2026-10-01T08:00:00.000Z' });
  const headphones = product({ id: 2, name: 'Noise-cancelling headphones', createdAt: '2026-10-15T08:00:00.000Z' });
  const kettle = product({ id: 3, name: 'Electric kettle', createdAt: '2026-10-10T08:00:00.000Z' });

  const searchRequests = () => backend.requests.filter((r) => r.path === '/api/products/search');

  it('filters the list by name as the visitor types, newest first', async () => {
    backend.seed({ products: [moka, headphones, kettle] });
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.type(screen.getByRole('searchbox', { name: /search products/i }), 'o');

    // Both "Moka pot" and "Noise-cancelling headphones" contain an "o"; newest first.
    await waitFor(() => expect(productNames()).toEqual(['Noise-cancelling headphones', 'Moka pot']));
    expect(screen.getByText('2 matches for “o”')).toBeInTheDocument();
  });

  it('works for visitors who are not logged in', async () => {
    backend.seed({ products: [moka, kettle] });
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    // No add-product form, but the search box is still there.
    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: /search products/i }), 'kettle');

    await waitFor(() => expect(productNames()).toEqual(['Electric kettle']));
    expect(searchRequests().length).toBeGreaterThan(0);
  });

  it('shows a no-results empty state and recovers when the search is cleared', async () => {
    backend.seed({ products: [moka] });
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.type(screen.getByRole('searchbox', { name: /search products/i }), 'xyz');

    expect(await screen.findByText(/no products match .*xyz.* try different filters/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(productNames()).toEqual(['Moka pot']));
  });

  it('requires every term to match, in any order', async () => {
    const red = product({ id: 10, name: 'Red wool blanket', createdAt: '2026-10-02T08:00:00.000Z' });
    const blue = product({ id: 11, name: 'Blue cotton blanket', createdAt: '2026-10-03T08:00:00.000Z' });
    backend.seed({ products: [red, blue] });
    const { user } = renderApp('/');
    await screen.findByText('Red wool blanket');

    await user.type(screen.getByRole('searchbox', { name: /search products/i }), 'blanket red{Enter}');

    await waitFor(() => expect(productNames()).toEqual(['Red wool blanket']));
  });
});

describe('Advanced search (logged-in only)', () => {
  const alice = { id: 1, username: 'alice', password: 'correct horse battery' };
  const moka = product({ id: 1, name: 'Moka pot', createdAt: '2026-09-01T08:00:00.000Z' });
  const kettle = product({ id: 2, name: 'Electric kettle', createdAt: '2026-10-20T08:00:00.000Z' });
  const grinder = product({ id: 3, name: 'Coffee grinder', createdAt: '2026-11-05T08:00:00.000Z' });

  const toggleAdvanced = () => screen.getByRole('button', { name: /advanced filters/i });

  it('hides the advanced filters from visitors who are not logged in', async () => {
    backend.seed({ products: [moka] });
    renderApp('/');
    await screen.findByText('Moka pot');

    expect(screen.queryByRole('button', { name: /advanced filters/i })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search products/i })).toBeInTheDocument();
  });

  it('shows the advanced filters to logged-in users and can toggle them', async () => {
    backend.seed({ products: [moka], users: [alice] });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    expect(screen.queryByLabelText('Created from')).not.toBeInTheDocument();
    await user.click(toggleAdvanced());

    expect(screen.getByLabelText('Created from')).toBeInTheDocument();
    expect(screen.getByLabelText('Created to')).toBeInTheDocument();
    expect(screen.getByLabelText('Note contains')).toBeInTheDocument();
    expect(screen.getByLabelText('Note by user')).toBeInTheDocument();
  });

  it('filters products by a creation-date range', async () => {
    backend.seed({ products: [moka, kettle, grinder], users: [alice] });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.click(toggleAdvanced());
    await user.type(screen.getByLabelText('Created from'), '2026-10-01');
    await user.type(screen.getByLabelText('Created to'), '2026-10-31');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Only the kettle (2026-10-20) falls inside October.
    await waitFor(() => expect(productNames()).toEqual(['Electric kettle']));
    const searchRequest = backend.requests.find((r) => r.path === '/api/products/search');
    expect(searchRequest?.authorization).toMatch(/^Bearer /);
  });

  it('filters products that have a note containing given text', async () => {
    backend.seed({
      products: [moka, kettle],
      notes: [note({ id: 1, productId: 1, content: 'Makes strong espresso' })],
      users: [alice],
    });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.click(toggleAdvanced());
    await user.type(screen.getByLabelText('Note contains'), 'espresso');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(productNames()).toEqual(['Moka pot']));
  });

  it('filters products that have a note by a particular user', async () => {
    backend.seed({
      products: [moka, kettle],
      notes: [
        note({ id: 1, productId: 1, content: 'Aliceʼs note', author: alice.id }),
        note({ id: 2, productId: 2, content: 'Authorless note', author: null }),
      ],
      users: [alice],
    });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.click(toggleAdvanced());
    await user.type(screen.getByLabelText('Note by user'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(productNames()).toEqual(['Moka pot']));
  });

  it('combines name, note text and author filters', async () => {
    const otherMoka = product({ id: 4, name: 'Moka express', createdAt: '2026-09-02T08:00:00.000Z' });
    backend.seed({
      products: [moka, otherMoka, kettle],
      notes: [
        note({ id: 1, productId: moka.id, content: 'great espresso', author: alice.id }),
        note({ id: 2, productId: otherMoka.id, content: 'weak espresso', author: null }),
      ],
      users: [alice],
    });
    signIn('alice');
    const { user } = renderApp('/');
    await screen.findByText('Moka pot');

    await user.type(screen.getByRole('searchbox', { name: /search products/i }), 'moka');
    await user.click(toggleAdvanced());
    await user.type(screen.getByLabelText('Note contains'), 'espresso');
    await user.type(screen.getByLabelText('Note by user'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Both are named "Moka" with an "espresso" note, but only moka pot's note is by alice.
    await waitFor(() => expect(productNames()).toEqual(['Moka pot']));
  });
});

describe('Unknown routes', () => {
  it('shows a not-found message without calling the API', async () => {
    renderApp('/nope');
    expect(screen.getByRole('alert')).toHaveTextContent(/this page doesn.t exist/i);
    expect(backend.requests).toHaveLength(0);
  });
});

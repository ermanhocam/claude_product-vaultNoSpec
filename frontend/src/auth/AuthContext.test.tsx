import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiUrl, backend, server } from '../test/mockApi';
import { product, renderApp, signIn } from '../test/utils';
import { decodeSession, TOKEN_STORAGE_KEY } from './session';

const moka = product({ id: 1, name: 'Moka pot' });
const alice = { id: 1, username: 'alice', password: 'correct horse' };

const storedToken = () => localStorage.getItem(TOKEN_STORAGE_KEY);
const accountNav = () => screen.getByRole('navigation', { name: 'Account' });
const productHeading = () => screen.findByRole('heading', { level: 1, name: 'Moka pot' });

async function logInWithForm(user: ReturnType<typeof renderApp>['user']) {
  await user.type(screen.getByLabelText('Username'), alice.username);
  await user.type(screen.getByLabelText('Password'), alice.password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

function expectLoggedOut() {
  expect(within(accountNav()).getByRole('link', { name: 'Log in' })).toBeInTheDocument();
  expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
}

describe('Session state (Requirement 15)', () => {
  it('stores the token and shows the username after logging in', async () => {
    backend.seed({ users: [alice] });
    const { user } = renderApp('/login');

    await logInWithForm(user);

    await waitFor(() => expect(accountNav()).toHaveTextContent('Signed in as alice'));
    expect(decodeSession(storedToken()!)).toMatchObject({ username: 'alice' });
    await screen.findByText(/no products yet/i); // let the redirect's request finish inside this test
  });

  it('sends the token with every API request while logged in', async () => {
    const token = signIn('alice');
    backend.seed({ products: [moka] });
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('link', { name: /moka pot/i }));
    await productHeading();
    await user.type(screen.getByLabelText('New note'), 'Descaled');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => expect(backend.notes).toHaveLength(1));
    expect(backend.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/products',
      'GET /api/products/1',
      'POST /api/products/1/notes',
    ]);
    expect(backend.requests.map((r) => r.authorization)).toEqual(Array(3).fill(`Bearer ${token}`));
  });

  it('forgets the token on logout and stops sending it', async () => {
    signIn('alice');
    backend.seed({ products: [moka] });
    const { user } = renderApp('/products/1');
    await productHeading();

    await user.click(within(accountNav()).getByRole('button', { name: 'Log out' }));

    expect(storedToken()).toBeNull();
    expectLoggedOut();
    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /back to products/i }));
    await screen.findByRole('link', { name: /moka pot/i });
    expect(backend.requestsTo('GET', '/api/products')).toEqual([expect.objectContaining({ authorization: null })]);
  });

  it('restores a valid session from an earlier visit', async () => {
    const token = signIn('alice');
    renderApp('/');

    expect(accountNav()).toHaveTextContent('Signed in as alice');
    expect(storedToken()).toBe(token);
    await screen.findByText(/no products yet/i);
  });

  it.each([
    ['an expired token', () => signIn('alice', { expiresInSeconds: -60 })],
    ['a token it cannot read', () => localStorage.setItem(TOKEN_STORAGE_KEY, 'not-a-token')],
  ])('removes %s on load and starts logged out', async (_label, store) => {
    store();
    renderApp('/');

    expectLoggedOut();
    expect(storedToken()).toBeNull();
    await screen.findByText(/no products yet/i);
    expect(backend.requests[0]!.authorization).toBeNull();
  });

  it('logs out and asks the user to log in again when the API rejects the session, then returns', async () => {
    signIn('alice');
    backend.seed({ products: [moka], users: [alice] });
    server.use(
      http.post(apiUrl('/products/:productId/notes'), () => HttpResponse.json({ error: 'Token expired' }, { status: 401 }), {
        once: true,
      }),
    );
    const { user } = renderApp('/products/1');
    await productHeading();

    await user.type(screen.getByLabelText('New note'), 'Too late');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired. Log in again to continue.');
    expect(storedToken()).toBeNull();
    expectLoggedOut();

    await logInWithForm(user);

    expect(await productHeading()).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toBeInTheDocument();
  });
});

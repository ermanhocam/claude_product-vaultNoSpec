import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../auth/session';
import { backend } from '../test/mockApi';
import { product, renderApp } from '../test/utils';

const moka = product({ id: 1, name: 'Moka pot' });
const alice = { id: 1, username: 'alice', password: 'correct horse' };

type User = ReturnType<typeof renderApp>['user'];

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const form = (name: string) => screen.getByRole('form', { name });
const accountNav = () => screen.getByRole('navigation', { name: 'Account' });
const loginRequests = () => backend.requestsTo('POST', '/api/auth/login');
const registerRequests = () => backend.requestsTo('POST', '/api/auth/register');

async function fillLogin(user: User, username: string, password: string) {
  if (username) await user.type(screen.getByLabelText('Username'), username);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

async function fillRegistration(user: User, username: string, password: string, confirm = password) {
  if (username) await user.type(screen.getByLabelText('Username'), username);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  if (confirm) await user.type(screen.getByLabelText('Confirm password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('Login page (Requirement 16)', () => {
  it('shows a username field (3–50 characters), a password field (8+ characters) and a submit button', () => {
    renderApp('/login');

    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('minlength', '3');
    expect(username).toHaveAttribute('maxlength', '50');
    expect(username).toHaveAttribute('autocomplete', 'username');
    expect(username).toHaveFocus();

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('minlength', '8');
    expect(password).toHaveAttribute('autocomplete', 'current-password');

    expect(within(form('Log in')).getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the error returned by the server inside the form and keeps the input', async () => {
    backend.seed({ users: [alice] });
    const { user } = renderApp('/login');

    await fillLogin(user, 'alice', 'wrong password');

    expect(await within(form('Log in')).findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(screen.getByLabelText('Username')).toHaveValue('alice');
    expect(screen.getByLabelText('Password')).toHaveValue('wrong password');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['', 'correct horse', 'Username is required', 'Username'],
    ['al', 'correct horse', 'Username must be between 3 and 50 characters', 'Username'],
    ['alice', '', 'Password is required', 'Password'],
    ['alice', 'short', 'Password must be between 8 and 128 characters', 'Password'],
  ])('checks "%s" / "%s" before sending anything', async (username, password, message, field) => {
    const { user } = renderApp('/login');

    await fillLogin(user, username, password);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(field)).toHaveFocus();
    expect(loginRequests()).toHaveLength(0);
  });

  it('returns to the page the user came from after logging in', async () => {
    backend.seed({ products: [moka], users: [alice] });
    const { user } = renderApp('/products/1');
    await heading('Moka pot');

    await user.click(within(accountNav()).getByRole('link', { name: 'Log in' }));
    await heading('Log in');
    await fillLogin(user, 'alice', 'correct horse');

    expect(await heading('Moka pot')).toBeInTheDocument();
  });

  it('goes to the product list when there is no earlier page', async () => {
    backend.seed({ products: [moka], users: [alice] });
    const { user } = renderApp('/login');

    await fillLogin(user, 'alice', 'correct horse');

    expect(await heading('Products')).toBeInTheDocument();
    await screen.findByRole('link', { name: /moka pot/i });
  });

  it('links to the registration page', async () => {
    const { user } = renderApp('/login');

    await user.click(within(form('Log in')).getByRole('link', { name: 'Create an account' }));

    expect(await heading('Create an account')).toBeInTheDocument();
  });
});

describe('Registration page (Requirement 16)', () => {
  it('shows username, password and confirm-password fields and a submit button', () => {
    renderApp('/register');

    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('minlength', '3');
    expect(username).toHaveAttribute('maxlength', '50');
    expect(username).toHaveFocus();

    for (const label of ['Password', 'Confirm password']) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('minlength', '8');
      expect(field).toHaveAttribute('autocomplete', 'new-password');
    }

    expect(within(form('Create an account')).getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });

  it('reports mismatched passwords without contacting the server', async () => {
    const { user } = renderApp('/register');

    await fillRegistration(user, 'alice', 'correct horse', 'correct horsf');

    expect(await within(form('Create an account')).findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Confirm password')).toHaveFocus();
    expect(registerRequests()).toHaveLength(0);
  });

  it.each([
    ['ab', 'correct horse', 'Username must be between 3 and 50 characters'],
    ['bad name', 'correct horse', 'Username may only contain letters, numbers, hyphens and underscores'],
    ['alice', 'short', 'Password must be between 8 and 128 characters'],
  ])('checks "%s" / "%s" before sending anything', async (username, password, message) => {
    const { user } = renderApp('/register');

    await fillRegistration(user, username, password);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(registerRequests()).toHaveLength(0);
  });

  it('opens the login page with a success message once the account is created', async () => {
    backend.seed({ products: [moka] });
    const { user } = renderApp('/register');

    await fillRegistration(user, 'alice', 'correct horse');

    expect(await heading('Log in')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Account “alice” created. Log in to start adding notes.');
    expect(backend.users).toEqual([expect.objectContaining({ username: 'alice', password: 'correct horse' })]);
    expect(screen.getByLabelText('Username')).toHaveValue('alice');
    expect(screen.getByLabelText('Password')).toHaveFocus();

    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await heading('Products')).toBeInTheDocument();
    await screen.findByRole('link', { name: /moka pot/i });
  });

  it('shows the server error when the username is taken', async () => {
    backend.seed({ users: [alice] });
    const { user } = renderApp('/register');

    await fillRegistration(user, 'Alice', 'another password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Username is already taken');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('links to the login page', async () => {
    const { user } = renderApp('/register');

    await user.click(within(form('Create an account')).getByRole('link', { name: 'Log in' }));

    expect(await heading('Log in')).toBeInTheDocument();
  });

  it('returns to the original page after registering and logging in', async () => {
    backend.seed({ products: [moka] });
    const { user } = renderApp('/products/1');
    await heading('Moka pot');

    await user.click(screen.getByRole('link', { name: 'Create one' }));
    await heading('Create an account');
    await fillRegistration(user, 'alice', 'correct horse');
    await heading('Log in');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await heading('Moka pot')).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toBeInTheDocument();
  });
});

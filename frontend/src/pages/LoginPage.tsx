import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { type AuthLocationState, useAuth, useAuthLinkState } from '../auth/AuthContext';
import { TextField } from '../components/TextField';
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validatePassword,
  validateUsername,
} from '../lib/credentials';

type Field = 'username' | 'password';

interface FormError {
  message: string;
  field?: Field;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as AuthLocationState;
  const linkState = useAuthLinkState();

  const [username, setUsername] = useState(state.registered ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = { username: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  useEffect(() => {
    document.title = 'Log in | Product Vault';
  }, []);

  function validate(): FormError | null {
    const usernameProblem = validateUsername(username);
    if (usernameProblem) return { field: 'username', message: usernameProblem };
    const passwordProblem = validatePassword(password);
    if (passwordProblem) return { field: 'password', message: passwordProblem };
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      if (problem.field) fieldRefs[problem.field].current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate(state.from ?? '/', { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err) });
      setSubmitting(false);
    }
  }

  const notice = state.registered
    ? `Account “${state.registered}” created. Log in to start adding notes.`
    : state.sessionExpired
      ? 'Your session has expired. Log in again to continue.'
      : null;

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={handleSubmit} noValidate aria-labelledby="login-heading">
        <h1 id="login-heading" className="auth-card__title">
          Log in
        </h1>
        {notice && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}

        <TextField
          ref={fieldRefs.username}
          id="login-username"
          label="Username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            if (error) setError(null);
          }}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={USERNAME_MIN_LENGTH}
          maxLength={USERNAME_MAX_LENGTH}
          autoFocus={!state.registered}
          invalid={error?.field === 'username'}
          errorId="login-error"
        />
        <TextField
          ref={fieldRefs.password}
          id="login-password"
          label="Password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError(null);
          }}
          autoComplete="current-password"
          minLength={PASSWORD_MIN_LENGTH}
          autoFocus={Boolean(state.registered)}
          invalid={error?.field === 'password'}
          errorId="login-error"
        />

        {error && (
          <p id="login-error" className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <button className="button button--primary button--block" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>

        <p className="auth-card__switch">
          New to Product Vault?{' '}
          <Link to="/register" state={linkState}>
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}

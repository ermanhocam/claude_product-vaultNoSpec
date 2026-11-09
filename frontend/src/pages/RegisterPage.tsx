import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, ApiError, errorMessage } from '../api/client';
import { type AuthLocationState, useAuthLinkState } from '../auth/AuthContext';
import { TextField } from '../components/TextField';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  validatePassword,
  validateUsername,
} from '../lib/credentials';

type Field = 'username' | 'password' | 'confirm';

interface FormError {
  message: string;
  field?: Field;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as AuthLocationState;
  const linkState = useAuthLinkState();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    document.title = 'Create an account | Product Vault';
  }, []);

  function validate(): FormError | null {
    const usernameProblem = validateUsername(username);
    if (usernameProblem) return { field: 'username', message: usernameProblem };
    const passwordProblem = validatePassword(password);
    if (passwordProblem) return { field: 'password', message: passwordProblem };
    if (confirm !== password) return { field: 'confirm', message: 'Passwords do not match' };
    return null;
  }

  function showError(problem: FormError) {
    setError(problem);
    if (problem.field) fieldRefs[problem.field].current?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const problem = validate();
    if (problem) {
      showError(problem);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const user = await api.register(username, password);
      const next: AuthLocationState = { registered: user.username, from: state.from };
      navigate('/login', { replace: true, state: next });
    } catch (err) {
      const taken = err instanceof ApiError && err.status === 409;
      showError({ message: errorMessage(err), field: taken ? 'username' : undefined });
      setSubmitting(false);
    }
  }

  const changeHandler = (set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    if (error) setError(null);
  };

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={handleSubmit} noValidate aria-labelledby="register-heading">
        <h1 id="register-heading" className="auth-card__title">
          Create an account
        </h1>

        <TextField
          ref={fieldRefs.username}
          id="register-username"
          label="Username"
          hint={`${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters: letters, numbers, hyphens and underscores.`}
          value={username}
          onChange={changeHandler(setUsername)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={USERNAME_MIN_LENGTH}
          maxLength={USERNAME_MAX_LENGTH}
          autoFocus
          invalid={error?.field === 'username'}
          errorId="register-error"
        />
        <TextField
          ref={fieldRefs.password}
          id="register-password"
          label="Password"
          hint={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`}
          type="password"
          value={password}
          onChange={changeHandler(setPassword)}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          invalid={error?.field === 'password'}
          errorId="register-error"
        />
        <TextField
          ref={fieldRefs.confirm}
          id="register-confirm"
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={changeHandler(setConfirm)}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          invalid={error?.field === 'confirm'}
          errorId="register-error"
        />

        {error && (
          <p id="register-error" className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <button className="button button--primary button--block" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-card__switch">
          Already have an account?{' '}
          <Link to="/login" state={linkState}>
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}

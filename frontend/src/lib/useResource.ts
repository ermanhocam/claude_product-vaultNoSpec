import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: T };

/**
 * Loads data when `deps` change and exposes it as a small state machine.
 * `update` lets callers apply local changes (e.g. a newly created item)
 * without refetching; `reload` retries after an error.
 */
export function useResource<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load().then(
      (data) => active && setState({ status: 'success', data }),
      (error: unknown) =>
        active &&
        setState({
          status: 'error',
          error: error instanceof ApiError ? error : new ApiError(errorMessage(error), 0),
        }),
    );
    return () => {
      active = false;
    };
    // `load` is intentionally excluded: callers pass an inline closure keyed by `deps`.
  }, [...deps, attempt]);

  const update = useCallback((change: (data: T) => T) => {
    setState((current) => (current.status === 'success' ? { status: 'success', data: change(current.data) } : current));
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, update, reload };
}

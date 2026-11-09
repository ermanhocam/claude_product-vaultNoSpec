import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { backend, server } from './mockApi';

// Any request without a handler fails the test, so new API calls can't slip through untested.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));

afterEach(() => {
  cleanup(); // unmount first so in-flight requests don't land in the next test's data
  server.resetHandlers();
  backend.reset();
  localStorage.clear();
});

afterAll(() => server.close());

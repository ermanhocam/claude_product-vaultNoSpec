import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // node:sqlite prints an ExperimentalWarning on Node 22; keep test output clean.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    testTimeout: 20_000,
  },
});

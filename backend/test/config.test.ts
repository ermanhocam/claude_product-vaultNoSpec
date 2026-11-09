import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('leaves the JWT secret unset by default, so the server generates one', () => {
    expect(loadConfig({}).jwtSecret).toBeUndefined();
    expect(loadConfig({ JWT_SECRET: '  ' }).jwtSecret).toBeUndefined();
  });

  it('uses JWT_SECRET when it is long enough', () => {
    const secret = 's'.repeat(32);
    expect(loadConfig({ JWT_SECRET: secret }).jwtSecret).toBe(secret);
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => loadConfig({ JWT_SECRET: 'too-short' })).toThrow(
      'Invalid JWT_SECRET: expected at least 32 characters',
    );
  });
});

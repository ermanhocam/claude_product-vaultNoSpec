import { describe, expect, it } from 'vitest';
import { fakeToken } from '../test/mockApi';
import { decodeSession, restoreSession, TOKEN_STORAGE_KEY } from './session';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenWith = (payload: unknown) => `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;

describe('decodeSession', () => {
  it('reads the id, username and expiry (in milliseconds) from the token payload', () => {
    expect(decodeSession(tokenWith({ sub: '1', username: 'alice', exp: 1_800_000_000 }))).toEqual({
      id: 1,
      username: 'alice',
      expiresAt: 1_800_000_000_000,
    });
  });

  it('returns a numeric id decoded from the token sub', () => {
    expect(decodeSession(tokenWith({ sub: '42', username: 'alice', exp: 1 }))?.id).toBe(42);
  });

  it.each([
    ['a missing sub', tokenWith({ username: 'alice', exp: 1 })],
    ['a non-numeric sub', tokenWith({ sub: 'abc', username: 'alice', exp: 1 })],
    ['a numeric (non-string) sub', tokenWith({ sub: 1, username: 'alice', exp: 1 })],
  ])('returns null for %s', (_label, token) => {
    expect(decodeSession(token)).toBeNull();
  });

  it('decodes base64url payloads, including "-" and "_" characters and UTF-8 text', () => {
    const token = tokenWith({ sub: '1', username: '~~~ü?>', exp: 1 });
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(decodeSession(token)?.username).toBe('~~~ü?>');
  });

  it.each([
    ['an empty string', ''],
    ['a value without dots', 'not-a-token'],
    ['a payload that is not base64', 'a.!!!.c'],
    ['a payload that is not JSON', `a.${Buffer.from('nope').toString('base64url')}.c`],
    ['a null payload', tokenWith(null)],
    ['a payload without a username', tokenWith({ exp: 1 })],
    ['a payload without an expiry', tokenWith({ username: 'alice' })],
    ['a non-numeric expiry', tokenWith({ username: 'alice', exp: 'tomorrow' })],
  ])('returns null for %s', (_label, token) => {
    expect(decodeSession(token)).toBeNull();
  });
});

describe('restoreSession', () => {
  it('returns null when no token is stored', () => {
    expect(restoreSession()).toBeNull();
  });

  it('returns the stored session while the token is valid', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, fakeToken('alice', { expiresInSeconds: 60 }));
    expect(restoreSession()).toMatchObject({ username: 'alice' });
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).not.toBeNull();
  });

  it('removes an expired token', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, fakeToken('alice', { expiresInSeconds: -1 }));
    expect(restoreSession()).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('removes a token it cannot read', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'garbage');
    expect(restoreSession()).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

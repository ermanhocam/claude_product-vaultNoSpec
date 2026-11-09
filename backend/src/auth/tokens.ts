import { errors, jwtVerify, SignJWT } from 'jose';
import { parseId } from '../validation.js';

export const TOKEN_LIFETIME = '24h';
const ALGORITHM = 'HS256';

/** The identity carried by a login token. */
export interface AuthUser {
  id: number;
  username: string;
}

export class TokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(reason === 'expired' ? 'Token expired' : 'Invalid token');
    this.name = 'TokenError';
  }
}

export type TokenService = ReturnType<typeof createTokenService>;

/** Issues and verifies HS256-signed JWTs with the user id as `sub` and a `username` claim. */
export function createTokenService(secret: string) {
  const key = new TextEncoder().encode(secret);

  return {
    sign(user: AuthUser): Promise<string> {
      return new SignJWT({ username: user.username })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(String(user.id))
        .setIssuedAt()
        .setExpirationTime(TOKEN_LIFETIME)
        .sign(key);
    },

    /** Resolves to the token's user, or rejects with a `TokenError`. */
    async verify(token: string): Promise<AuthUser> {
      let payload;
      try {
        // Pinning the algorithm rejects `alg: none` and algorithm-confusion tokens.
        ({ payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM], requiredClaims: ['sub', 'exp'] }));
      } catch (error) {
        // jose checks the signature before the expiry, so only genuine tokens are reported as expired.
        throw new TokenError(error instanceof errors.JWTExpired ? 'expired' : 'invalid');
      }

      const id = parseId(payload.sub);
      if (id === undefined || typeof payload.username !== 'string') throw new TokenError('invalid');
      return { id, username: payload.username };
    },
  };
}

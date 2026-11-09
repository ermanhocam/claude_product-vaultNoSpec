import bcrypt from 'bcryptjs';

/** bcrypt cost factor: about 220 ms per hash with bcryptjs on a current laptop. */
export const DEFAULT_BCRYPT_ROUNDS = 12;

export type PasswordHasher = ReturnType<typeof createPasswordHasher>;

/**
 * Hashes and checks passwords with bcrypt. bcryptjs is a pure JavaScript
 * implementation, so there is no native add-on to compile.
 */
export function createPasswordHasher(rounds = DEFAULT_BCRYPT_ROUNDS) {
  let dummyHash: Promise<string> | undefined;

  return {
    hash(password: string): Promise<string> {
      return bcrypt.hash(password, rounds);
    },

    /**
     * Checks `password` against `hash`. Without a hash (unknown username) it still runs a
     * comparison against a throwaway hash, so response times don't reveal which usernames exist.
     */
    async verify(password: string, hash: string | undefined): Promise<boolean> {
      if (hash !== undefined) return bcrypt.compare(password, hash);
      dummyHash ??= bcrypt.hash('unknown-user', rounds);
      await bcrypt.compare(password, await dummyHash);
      return false;
    },
  };
}

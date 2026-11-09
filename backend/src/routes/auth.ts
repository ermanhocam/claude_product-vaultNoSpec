import { Router } from 'express';
import type { PasswordHasher } from '../auth/passwords.js';
import type { TokenService } from '../auth/tokens.js';
import { isUniqueConstraintError } from '../db/database.js';
import type { UserRepository } from '../db/repositories.js';
import { conflict, MESSAGES, unauthorized } from '../errors.js';
import { parseLogin, parseRegistration } from '../validation.js';

export function createAuthRouter(users: UserRepository, passwords: PasswordHasher, tokens: TokenService): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const { username, password } = parseRegistration(req.body);
    const passwordHash = await passwords.hash(password);

    let user;
    try {
      user = users.create(username, passwordHash);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw conflict(MESSAGES.usernameTaken);
      throw error;
    }
    res.status(201).json({ id: user.id, username: user.username });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = parseLogin(req.body);
    const user = users.findByUsername(username);

    // Same message for an unknown username and a wrong password, so neither reveals which usernames exist.
    const valid = await passwords.verify(password, user?.passwordHash);
    if (!user || !valid) throw unauthorized(MESSAGES.invalidCredentials);

    res.json({ token: await tokens.sign(user) });
  });

  return router;
}

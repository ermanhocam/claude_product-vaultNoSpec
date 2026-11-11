import { type Request, type RequestHandler, Router } from 'express';
import {
  type MessageRepository,
  toPublicUser,
  type User,
  type UserRepository,
} from '../db/repositories.js';
import { badRequest, notFound } from '../errors.js';
import { parseId, parseMessageBody } from '../validation.js';

/**
 * Direct messaging between logged-in users. Every route requires authentication, and a user
 * only ever sees conversations they are part of — `req.user!.id` is always one side of the
 * sender/recipient pair, so there is no way to read someone else's threads.
 */
export function createMessagesRouter(
  messages: MessageRepository,
  users: UserRepository,
  requireAuth: RequestHandler,
): Router {
  const router = Router();

  const requirePartner = (rawId: string | undefined, selfId: number): User => {
    const id = parseId(rawId);
    if (id === selfId) throw badRequest('You cannot message yourself');
    const partner = id === undefined ? undefined : users.findById(id);
    if (!partner) throw notFound('User not found');
    return partner;
  };

  // Everyone you can start a conversation with: all users except yourself.
  router.get('/users', requireAuth, (req, res) => {
    res.json(users.listOthers(req.user!.id).map(toPublicUser));
  });

  // Your existing conversations, most recently active first.
  router.get('/threads', requireAuth, (req, res) => {
    res.json(messages.findThreads(req.user!.id));
  });

  // The full transcript of your conversation with one other user, oldest message first.
  router.get('/conversations/:userId', requireAuth, (req: Request<{ userId: string }>, res) => {
    const partner = requirePartner(req.params.userId, req.user!.id);
    res.json({
      partner: toPublicUser(partner),
      messages: messages.findConversation(req.user!.id, partner.id),
    });
  });

  // Send a message to another user.
  router.post('/conversations/:userId', requireAuth, (req: Request<{ userId: string }>, res) => {
    const partner = requirePartner(req.params.userId, req.user!.id);
    const message = messages.create(req.user!.id, partner.id, parseMessageBody(req.body));
    res.status(201).location(`/api/messages/conversations/${partner.id}`).json(message);
  });

  return router;
}

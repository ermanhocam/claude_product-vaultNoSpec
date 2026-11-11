import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_BODY_MAX_LENGTH } from '../src/validation.js';
import { createTestContext, ISO_TIMESTAMP } from './helpers.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.db.close();
  vi.restoreAllMocks();
});

describe('GET /api/messages/users', () => {
  it('requires authentication', async () => {
    const res = await ctx.api.get('/api/messages/users');
    expect(res.status).toBe(401);
  });

  it('lists every other user, alphabetically, without the caller or any secrets', async () => {
    const alice = await ctx.createUser('alice');
    await ctx.createUser('carol');
    await ctx.createUser('bob');

    const res = await ctx.api.get('/api/messages/users').set(alice.auth).expect(200);

    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['bob', 'carol']);
    for (const user of res.body) {
      expect(user).toEqual({ id: expect.any(Number), username: expect.any(String) });
    }
  });
});

describe('POST /api/messages/conversations/:userId', () => {
  it('requires authentication', async () => {
    const bob = await ctx.createUser('bob');
    const res = await ctx.api.post(`/api/messages/conversations/${bob.id}`).send({ body: 'hi' });
    expect(res.status).toBe(401);
  });

  it('sends a message and returns it with sender, recipient, id and timestamp', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    const res = await ctx.api
      .post(`/api/messages/conversations/${bob.id}`)
      .set(alice.auth)
      .send({ body: 'Hey Bob!' })
      .expect(201);

    expect(res.headers.location).toBe(`/api/messages/conversations/${bob.id}`);
    expect(res.body).toEqual({
      id: expect.any(Number),
      senderId: alice.id,
      recipientId: bob.id,
      body: 'Hey Bob!',
      createdAt: expect.stringMatching(ISO_TIMESTAMP),
    });
  });

  it('trims the message body', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    const res = await ctx.api
      .post(`/api/messages/conversations/${bob.id}`)
      .set(alice.auth)
      .send({ body: '  spaced  ' })
      .expect(201);

    expect(res.body.body).toBe('spaced');
  });

  it('rejects an empty message', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    const res = await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a message over the length limit', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    const res = await ctx.api
      .post(`/api/messages/conversations/${bob.id}`)
      .set(alice.auth)
      .send({ body: 'x'.repeat(MESSAGE_BODY_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
  });

  it('refuses messaging yourself', async () => {
    const alice = await ctx.createUser('alice');

    const res = await ctx.api
      .post(`/api/messages/conversations/${alice.id}`)
      .set(alice.auth)
      .send({ body: 'note to self' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown recipient', async () => {
    const alice = await ctx.createUser('alice');

    const res = await ctx.api.post('/api/messages/conversations/9999').set(alice.auth).send({ body: 'hello?' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/messages/conversations/:userId', () => {
  it('requires authentication', async () => {
    const bob = await ctx.createUser('bob');
    const res = await ctx.api.get(`/api/messages/conversations/${bob.id}`);
    expect(res.status).toBe(401);
  });

  it('returns the full transcript between two users, oldest first, in either direction', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: 'first' }).expect(201);
    await ctx.api.post(`/api/messages/conversations/${alice.id}`).set(bob.auth).send({ body: 'second' }).expect(201);
    await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: 'third' }).expect(201);

    const res = await ctx.api.get(`/api/messages/conversations/${bob.id}`).set(alice.auth).expect(200);

    expect(res.body.partner).toEqual({ id: bob.id, username: 'bob' });
    expect(res.body.messages.map((m: { body: string }) => m.body)).toEqual(['first', 'second', 'third']);
  });

  it('both participants see the same conversation', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');

    await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: 'hi bob' }).expect(201);

    const asAlice = await ctx.api.get(`/api/messages/conversations/${bob.id}`).set(alice.auth).expect(200);
    const asBob = await ctx.api.get(`/api/messages/conversations/${alice.id}`).set(bob.auth).expect(200);

    expect(asAlice.body.messages.map((m: { body: string }) => m.body)).toEqual(['hi bob']);
    expect(asBob.body.messages.map((m: { body: string }) => m.body)).toEqual(['hi bob']);
  });

  it('does not leak messages from unrelated conversations', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');
    const carol = await ctx.createUser('carol');

    await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: 'for bob' }).expect(201);
    await ctx.api.post(`/api/messages/conversations/${carol.id}`).set(alice.auth).send({ body: 'for carol' }).expect(201);

    const res = await ctx.api.get(`/api/messages/conversations/${bob.id}`).set(alice.auth).expect(200);
    expect(res.body.messages.map((m: { body: string }) => m.body)).toEqual(['for bob']);
  });
});

describe('GET /api/messages/threads', () => {
  it('requires authentication', async () => {
    const res = await ctx.api.get('/api/messages/threads');
    expect(res.status).toBe(401);
  });

  it('is empty before any messages are exchanged', async () => {
    const alice = await ctx.createUser('alice');
    const res = await ctx.api.get('/api/messages/threads').set(alice.auth).expect(200);
    expect(res.body).toEqual([]);
  });

  it('summarises each conversation with the latest message, most recent first', async () => {
    const alice = await ctx.createUser('alice');
    const bob = await ctx.createUser('bob');
    const carol = await ctx.createUser('carol');

    await ctx.api.post(`/api/messages/conversations/${bob.id}`).set(alice.auth).send({ body: 'hi bob' }).expect(201);
    await ctx.api.post(`/api/messages/conversations/${carol.id}`).set(alice.auth).send({ body: 'hi carol' }).expect(201);
    await ctx.api.post(`/api/messages/conversations/${alice.id}`).set(bob.auth).send({ body: 'latest from bob' }).expect(201);

    const res = await ctx.api.get('/api/messages/threads').set(alice.auth).expect(200);

    expect(res.body).toEqual([
      {
        partnerId: bob.id,
        partnerUsername: 'bob',
        lastBody: 'latest from bob',
        lastCreatedAt: expect.stringMatching(ISO_TIMESTAMP),
      },
      {
        partnerId: carol.id,
        partnerUsername: 'carol',
        lastBody: 'hi carol',
        lastCreatedAt: expect.stringMatching(ISO_TIMESTAMP),
      },
    ]);
  });
});

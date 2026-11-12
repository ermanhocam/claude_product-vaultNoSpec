import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, ISO_TIMESTAMP } from './helpers.js';

let ctx: ReturnType<typeof createTestContext>;
let productId: number;

beforeEach(async () => {
  ctx = createTestContext();
  productId = (await ctx.createProduct('Running Shoes')).id;
});

afterEach(() => {
  ctx.db.close();
});

/** Note creation requires a login; these tests send a valid token. */
const postNote = async (id: number | string, body: object) => {
  const auth = await ctx.authHeader();
  return ctx.api.post(`/api/products/${id}/notes`).set(auth).send(body);
};

/** Note deletion requires a login too; these tests send a valid token. */
const deleteNote = async (path: string) => {
  const auth = await ctx.authHeader();
  return ctx.api.delete(path).set(auth);
};

/** Note editing requires a login too; sends a PUT with the default "tester" token. */
const putNote = async (path: string, body: object) => {
  const auth = await ctx.authHeader();
  return ctx.api.put(path).set(auth).send(body);
};

describe('POST /api/products/:id/notes (Requirement 4)', () => {
  it('creates a note and returns its id, content and creation timestamp', async () => {
    const res = await postNote(productId, { content: 'Very comfortable' });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers.location).toBe(`/api/notes/${res.body.id}`);
    expect(res.body).toEqual({
      id: expect.any(Number),
      productId,
      content: 'Very comfortable',
      author: expect.any(Number),
      createdAt: expect.stringMatching(ISO_TIMESTAMP),
    });
  });

  it('trims surrounding whitespace but keeps inner line breaks', async () => {
    const res = await postNote(productId, { content: '\n  Line one\n\nLine two  \n' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Line one\n\nLine two');
  });

  it.each([
    ['empty content', { content: '' }],
    ['whitespace-only content', { content: '   \n\t ' }],
    ['missing content', {}],
  ])('rejects %s with a "content is required" error', async (_label, body) => {
    const res = await postNote(productId, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content is required' });
  });

  it('accepts exactly 5000 characters after trimming', async () => {
    const content = 'x'.repeat(5000);
    const res = await postNote(productId, { content: `   ${content}   ` });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe(content);
  });

  it('rejects content longer than 5000 characters after trimming', async () => {
    const res = await postNote(productId, { content: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content must not exceed 5000 characters' });
  });

  it('returns 404 when the product does not exist', async () => {
    const res = await postNote(9999, { content: 'Orphan' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Product not found' });
  });
});

describe('GET /api/products/:id/notes (Requirement 5)', () => {
  it('returns an empty array when the product has no notes', async () => {
    const res = await ctx.api.get(`/api/products/${productId}/notes`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all notes for the product newest first', async () => {
    const n1 = await ctx.createNote(productId, 'First');
    const n2 = await ctx.createNote(productId, 'Second');
    const n3 = await ctx.createNote(productId, 'Third');

    const res = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);

    expect(res.body).toEqual([n3, n2, n1]);
    for (const note of res.body) {
      expect(note).toEqual({
        id: expect.any(Number),
        productId,
        content: expect.any(String),
        author: expect.any(Number),
        createdAt: expect.stringMatching(ISO_TIMESTAMP),
      });
    }
  });

  it('returns 404 when the product does not exist', async () => {
    const res = await ctx.api.get('/api/products/9999/notes');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Product not found' });
  });
});

describe('DELETE /api/notes/:id (Requirement 9)', () => {
  it('deletes the note and returns a success response', async () => {
    const keep = await ctx.createNote(productId, 'Keep me');
    const remove = await ctx.createNote(productId, 'Delete me');

    const res = await deleteNote(`/api/notes/${remove.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ id: remove.id, deleted: true });

    const notes = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(notes.body).toEqual([keep]);
  });

  it.each(['9999', 'abc'])('returns 404 "Note not found" for note id "%s"', async (id) => {
    const res = await deleteNote(`/api/notes/${id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Note not found' });
  });

  it('returns 404 when deleting the same note twice', async () => {
    const note = await ctx.createNote(productId, 'Once');
    expect((await deleteNote(`/api/notes/${note.id}`)).status).toBe(200);
    expect((await deleteNote(`/api/notes/${note.id}`)).status).toBe(404);
  });
});

describe('PUT /api/notes/:id (Requirement 10)', () => {
  it('updates the content and returns the note with its original creation timestamp', async () => {
    const note = await ctx.createNote(productId, 'Original');

    const res = await putNote(`/api/notes/${note.id}`, { content: '  Updated  ' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ ...note, content: 'Updated' });

    const stored = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(stored.body).toEqual([{ ...note, content: 'Updated' }]);
  });

  it.each([
    ['empty content', { content: '' }],
    ['whitespace-only content', { content: ' \n ' }],
    ['missing content', {}],
  ])('rejects %s with a "content is required" error', async (_label, body) => {
    const note = await ctx.createNote(productId, 'Original');
    const res = await putNote(`/api/notes/${note.id}`, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content is required' });
  });

  it('accepts exactly 5000 characters and rejects 5001', async () => {
    const note = await ctx.createNote(productId, 'Original');
    await putNote(`/api/notes/${note.id}`, { content: 'y'.repeat(5000) }).then((r) => expect(r.status).toBe(200));

    const res = await putNote(`/api/notes/${note.id}`, { content: 'y'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content must not exceed 5000 characters' });
  });

  it('leaves the note unchanged when validation fails', async () => {
    const note = await ctx.createNote(productId, 'Original');
    await putNote(`/api/notes/${note.id}`, { content: '' }).then((r) => expect(r.status).toBe(400));
    const stored = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(stored.body).toEqual([note]);
  });

  it.each(['9999', 'abc'])('returns 404 "Note not found" for note id "%s"', async (id) => {
    const res = await putNote(`/api/notes/${id}`, { content: 'Updated' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Note not found' });
  });
});

// Task 4.1 — auth + ownership examples/edges for PUT /api/notes/:noteId.
describe('PUT /api/notes/:id authentication and ownership (Requirements 1, 2)', () => {
  const EXPIRED_TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJ0ZXN0ZXIiLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTUxNjIzOTAyM30.' +
    'invalidsignature';

  it.each([
    ['a missing Authorization header', undefined],
    ['a malformed Authorization header', { Authorization: 'Token abc' }],
    ['an empty bearer token', { Authorization: 'Bearer ' }],
    ['an invalid/expired token', { Authorization: `Bearer ${EXPIRED_TOKEN}` }],
  ])('rejects an unauthenticated PUT with %s with 401 and leaves the content unchanged', async (_label, header) => {
    const note = await ctx.createNote(productId, 'Original');

    let req = ctx.api.put(`/api/notes/${note.id}`);
    if (header) req = req.set(header);
    const res = await req.send({ content: 'Hijacked' });

    expect(res.status).toBe(401);

    const stored = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(stored.body).toEqual([note]);
  });

  it('returns 401 for both an existing and a non-existent note id (no existence leak)', async () => {
    const note = await ctx.createNote(productId, 'Original');

    const existing = await ctx.api.put(`/api/notes/${note.id}`).send({ content: 'x' });
    const missing = await ctx.api.put('/api/notes/9999').send({ content: 'x' });

    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    // Identical responses: the lookup never runs, so nothing distinguishes the two.
    expect(existing.body).toEqual(missing.body);
  });

  it('returns 404 for an authenticated PUT to a non-existent note', async () => {
    const res = await putNote('/api/notes/9999', { content: 'Updated' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Note not found' });
  });

  it('returns 403 for an authenticated PUT to an authorless note and leaves it unchanged', async () => {
    const note = await ctx.createNote(productId, 'Legacy');
    // Simulate a pre-feature row with no recorded author.
    ctx.db.prepare('UPDATE notes SET author_id = NULL WHERE id = ?').run(note.id);

    const res = await putNote(`/api/notes/${note.id}`, { content: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You can only edit your own notes' });

    const stored = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(stored.body).toEqual([{ ...note, author: null }]);
  });
});

// Task 4.2 — Property 1: An author can update the content of their own note.
// Feature: notes-edit-auth, Property 1: An author can update the content of their own note
// Validates: Requirements 2.1
describe('PUT /api/notes/:id property: author self-edit (Requirement 2.1)', () => {
  it('lets an author update their own note to any valid content', async () => {
    // A valid replacement content is 1..5000 characters after trimming. Constrain the generator
    // to strings whose trimmed form is non-empty and within the limit so every input is accepted.
    const validContent = fc
      .string({ minLength: 1, maxLength: 5000 })
      .map((s) => s.trim())
      .filter((s) => s.length >= 1 && s.length <= 5000);

    await fc.assert(
      fc.asyncProperty(validContent, async (content) => {
        const auth = await ctx.authHeader();
        const created = await ctx.api
          .post(`/api/products/${productId}/notes`)
          .set(auth)
          .send({ content: 'seed' })
          .expect(201);
        const note = created.body as { id: number; author: number };

        const res = await ctx.api.put(`/api/notes/${note.id}`).set(auth).send({ content });

        expect(res.status).toBe(200);
        expect(res.body.content).toBe(content);
        expect(res.body.author).toBe(note.author);

        // Read the persisted row back to confirm the content was stored, not just echoed.
        const row = ctx.db.prepare('SELECT content, author_id FROM notes WHERE id = ?').get(note.id) as {
          content: string;
          author_id: number;
        };
        expect(row.content).toBe(content);
        expect(row.author_id).toBe(note.author);
      }),
      { numRuns: 100 },
    );
  });
});

// Task 4.3 — Property 2: A non-author cannot change a note.
// Feature: notes-edit-auth, Property 2: A non-author cannot change a note
// Validates: Requirements 2.2
describe('PUT /api/notes/:id property: non-author rejection (Requirement 2.2)', () => {
  it('rejects an edit from a different user and leaves the content unchanged', async () => {
    const validContent = fc
      .string({ minLength: 1, maxLength: 5000 })
      .map((s) => s.trim())
      .filter((s) => s.length >= 1 && s.length <= 5000);

    // Two distinct users: A authors the note, B attempts the edit.
    await ctx.register('author-a');
    const tokenA = await ctx.login('author-a');
    await ctx.register('intruder-b');
    const tokenB = await ctx.login('intruder-b');

    await fc.assert(
      fc.asyncProperty(validContent, async (content) => {
        const created = await ctx.api
          .post(`/api/products/${productId}/notes`)
          .set({ Authorization: `Bearer ${tokenA}` })
          .send({ content: 'original' })
          .expect(201);
        const note = created.body as { id: number };

        const res = await ctx.api
          .put(`/api/notes/${note.id}`)
          .set({ Authorization: `Bearer ${tokenB}` })
          .send({ content });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'You can only edit your own notes' });

        const row = ctx.db.prepare('SELECT content FROM notes WHERE id = ?').get(note.id) as { content: string };
        expect(row.content).toBe('original');
      }),
      { numRuns: 100 },
    );
  });
});

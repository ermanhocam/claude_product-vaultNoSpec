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

    const res = await ctx.api.put(`/api/notes/${note.id}`).send({ content: '  Updated  ' });

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
    const res = await ctx.api.put(`/api/notes/${note.id}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content is required' });
  });

  it('accepts exactly 5000 characters and rejects 5001', async () => {
    const note = await ctx.createNote(productId, 'Original');
    await ctx.api.put(`/api/notes/${note.id}`).send({ content: 'y'.repeat(5000) }).expect(200);

    const res = await ctx.api.put(`/api/notes/${note.id}`).send({ content: 'y'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Note content must not exceed 5000 characters' });
  });

  it('leaves the note unchanged when validation fails', async () => {
    const note = await ctx.createNote(productId, 'Original');
    await ctx.api.put(`/api/notes/${note.id}`).send({ content: '' }).expect(400);
    const stored = await ctx.api.get(`/api/products/${productId}/notes`).expect(200);
    expect(stored.body).toEqual([note]);
  });

  it.each(['9999', 'abc'])('returns 404 "Note not found" for note id "%s"', async (id) => {
    const res = await ctx.api.put(`/api/notes/${id}`).send({ content: 'Updated' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Note not found' });
  });
});

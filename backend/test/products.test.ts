import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, ISO_TIMESTAMP } from './helpers.js';

let ctx: ReturnType<typeof createTestContext>;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.db.close();
  vi.restoreAllMocks();
});

describe('POST /api/products (Requirement 1)', () => {
  /** Creating a product needs a login; sends a POST with a valid token. */
  const createAs = async (body: unknown) => {
    // Resolve the header first: supertest requests must not be left pending across an await.
    const auth = await ctx.authHeader();
    return ctx.api.post('/api/products').set(auth).send(body);
  };

  it('creates a product and returns it with a generated id', async () => {
    const res = await createAs({ name: 'Espresso Machine' });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers.location).toBe(`/api/products/${res.body.id}`);
    expect(res.body).toEqual({
      id: expect.any(Number),
      name: 'Espresso Machine',
      createdAt: expect.stringMatching(ISO_TIMESTAMP),
    });
  });

  it('rejects creation without a token with 401 and creates nothing', async () => {
    const res = await ctx.api.post('/api/products').send({ name: 'Espresso Machine' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    const list = await ctx.api.get('/api/products').expect(200);
    expect(list.body).toEqual([]);
  });

  it('persists the product so it can be retrieved', async () => {
    const created = await ctx.createProduct('Headphones');
    const res = await ctx.api.get(`/api/products/${created.id}`).expect(200);
    expect(res.body).toMatchObject({ id: created.id, name: 'Headphones' });
  });

  it('trims surrounding whitespace from the name', async () => {
    const res = await createAs({ name: '   Kettle  ' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Kettle');
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: ' \t\n  ' }],
    ['a missing name', {}],
    ['a null name', { name: null }],
  ])('rejects %s with a "name is required" error', async (_label, body) => {
    const res = await createAs(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Product name is required' });
  });

  it('rejects a non-string name', async () => {
    const res = await createAs({ name: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Product name must be a string' });
  });

  it('accepts a name of exactly 200 characters', async () => {
    const name = 'a'.repeat(200);
    const res = await createAs({ name });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
  });

  it('rejects a name longer than 200 characters with a maximum length error', async () => {
    const res = await createAs({ name: 'a'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Product name must not exceed 200 characters' });
  });

  it('counts characters, not UTF-16 code units, when checking length', async () => {
    const name = '📦'.repeat(200);
    expect((await createAs({ name })).status).toBe(201);
    expect((await createAs({ name: name + '📦' })).status).toBe(400);
  });

  it('does not create a product when validation fails', async () => {
    expect((await createAs({ name: '' })).status).toBe(400);
    const res = await ctx.api.get('/api/products').expect(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/products (Requirement 2)', () => {
  it('returns an empty array when no products exist', async () => {
    const res = await ctx.api.get('/api/products');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([]);
  });

  it('returns all products newest first with id, name and creation timestamp', async () => {
    const first = await ctx.createProduct('First');
    const second = await ctx.createProduct('Second');
    const third = await ctx.createProduct('Third');

    const res = await ctx.api.get('/api/products').expect(200);

    expect(res.body).toEqual([third, second, first]);
    for (const product of res.body) {
      expect(Object.keys(product).sort()).toEqual(['createdAt', 'id', 'name']);
    }
  });

  it('orders by creation timestamp even when ids disagree', async () => {
    const older = await ctx.createProduct('Older');
    const newer = await ctx.createProduct('Newer');
    ctx.db.prepare('UPDATE products SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', newer.id);
    ctx.db.prepare('UPDATE products SET created_at = ? WHERE id = ?').run('2021-01-01T00:00:00.000Z', older.id);

    const res = await ctx.api.get('/api/products').expect(200);
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Older', 'Newer']);
  });
});

describe('GET /api/products/:id (Requirement 3)', () => {
  it('returns the product with its notes newest first', async () => {
    const product = await ctx.createProduct('Camera');
    const n1 = await ctx.createNote(product.id, 'Great low-light performance');
    const n2 = await ctx.createNote(product.id, 'Battery life is short');

    const res = await ctx.api.get(`/api/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...product, notes: [n2, n1] });
  });

  it('returns an empty notes array for a product without notes', async () => {
    const product = await ctx.createProduct('Desk');
    const res = await ctx.api.get(`/api/products/${product.id}`).expect(200);
    expect(res.body.notes).toEqual([]);
  });

  it('only includes notes that belong to the product', async () => {
    const a = await ctx.createProduct('A');
    const b = await ctx.createProduct('B');
    await ctx.createNote(a.id, 'Note for A');
    const noteB = await ctx.createNote(b.id, 'Note for B');

    const res = await ctx.api.get(`/api/products/${b.id}`).expect(200);
    expect(res.body.notes).toEqual([noteB]);
  });

  it.each(['999', '0', '-1', 'abc', '1.5', '99999999999999999999'])(
    'returns 404 for product id "%s"',
    async (id) => {
      const res = await ctx.api.get(`/api/products/${id}`);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Product not found' });
    },
  );
});

describe('DELETE /api/products/:id (Requirement 19)', () => {
  const countProductRows = (productId: number) =>
    Number(ctx.db.prepare('SELECT COUNT(*) AS count FROM products WHERE id = ?').get(productId)?.count);

  const countNoteRows = (productId: number) =>
    Number(ctx.db.prepare('SELECT COUNT(*) AS count FROM notes WHERE product_id = ?').get(productId)?.count);

  const expectProductNotFound = async (productId: number) => {
    const res = await ctx.api.get(`/api/products/${productId}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Product not found' });
  };

  /** Deleting needs a login; sends a DELETE with a valid token. */
  const deleteAs = async (path: string) => {
    // Resolve the header first: supertest requests must not be left pending across an await.
    const auth = await ctx.authHeader();
    return ctx.api.delete(path).set(auth);
  };

  it('T19.1a deletes a product with its notes when a valid token is sent', async () => {
    const product = await ctx.createProduct('Moka pot');
    await ctx.createNote(product.id, 'Use medium grind');
    await ctx.createNote(product.id, 'Take it off the heat when it gurgles');

    const res = await deleteAs(`/api/products/${product.id}`);

    expect(res.status).toBe(200);
    await expectProductNotFound(product.id);
    expect(countNoteRows(product.id)).toBe(0);
    const list = await ctx.api.get('/api/products').expect(200);
    expect(list.body).toEqual([]);
  });

  it('T19.1b leaves other products and their notes untouched', async () => {
    const a = await ctx.createProduct('A');
    await ctx.createNote(a.id, 'First note for A');
    await ctx.createNote(a.id, 'Second note for A');
    const b = await ctx.createProduct('B');
    const noteB = await ctx.createNote(b.id, 'Note for B');
    const before = await ctx.api.get(`/api/products/${b.id}`).expect(200);
    expect(before.body).toEqual({ ...b, notes: [noteB] });

    const res = await deleteAs(`/api/products/${a.id}`);

    expect(res.status).toBe(200);
    const after = await ctx.api.get(`/api/products/${b.id}`);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);
    const list = await ctx.api.get('/api/products').expect(200);
    expect(list.body).toEqual([b]);
  });

  it('T19.1c deletes a product without notes when a valid token is sent', async () => {
    const product = await ctx.createProduct('Desk');

    const res = await deleteAs(`/api/products/${product.id}`);

    expect(res.status).toBe(200);
    await expectProductNotFound(product.id);
  });

  it('T19.1d removes the product row and its note rows from the database', async () => {
    const product = await ctx.createProduct('Kettle');
    await ctx.createNote(product.id, 'Boils fast');

    const res = await deleteAs(`/api/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(countProductRows(product.id)).toBe(0);
    expect(countNoteRows(product.id)).toBe(0);
  });

  it('T19.1e rejects a delete without a token with 401 and keeps the product and its notes', async () => {
    const product = await ctx.createProduct('Toaster');
    const note = await ctx.createNote(product.id, 'Uneven browning');

    const res = await ctx.api.delete(`/api/products/${product.id}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
    const kept = await ctx.api.get(`/api/products/${product.id}`).expect(200);
    expect(kept.body).toEqual({ ...product, notes: [note] });
  });

  it('T19.1g makes the former notes unreachable through the notes API', async () => {
    const product = await ctx.createProduct('Grinder');
    const first = await ctx.createNote(product.id, 'Loud');
    const second = await ctx.createNote(product.id, 'Consistent grind');

    const res = await deleteAs(`/api/products/${product.id}`);
    expect(res.status).toBe(200);

    for (const note of [first, second]) {
      // Editing now requires a login; send a valid token so the lookup runs and reports the note gone.
      const auth = await ctx.authHeader();
      const put = await ctx.api.put(`/api/notes/${note.id}`).set(auth).send({ content: 'Edited afterwards' });
      expect(put.status).toBe(404);
      expect(put.body).toEqual({ error: 'Note not found' });

      const del = await deleteAs(`/api/notes/${note.id}`);
      expect(del.status).toBe(404);
      expect(del.body).toEqual({ error: 'Note not found' });
    }

    const notesList = await ctx.api.get(`/api/products/${product.id}/notes`);
    expect(notesList.status).toBe(404);
    expect(notesList.body).toEqual({ error: 'Product not found' });
  });

  it('T19.1h does not reuse the id of a deleted product', async () => {
    await ctx.createProduct('A');
    const b = await ctx.createProduct('B');

    const res = await deleteAs(`/api/products/${b.id}`);
    expect(res.status).toBe(200);

    const c = await ctx.createProduct('C');
    expect(c.id).toBeGreaterThan(b.id);
    await expectProductNotFound(b.id);
  });

  it('T19.2a returns 200 with exactly the deleted product id and deleted: true', async () => {
    const product = await ctx.createProduct('Blender');

    const res = await deleteAs(`/api/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toStrictEqual({ id: product.id, deleted: true });
  });

  it('T19.3b deletes all or nothing: a failure part-way returns 500 and keeps the product and its notes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const product = await ctx.createProduct('Moka pot');
    const first = await ctx.createNote(product.id, 'First note');
    const second = await ctx.createNote(product.id, 'Second note');
    ctx.db.exec(`
      CREATE TEMP TRIGGER fail_product_delete BEFORE DELETE ON products
      BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
    `);

    const failed = await deleteAs(`/api/products/${product.id}`);

    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: 'An unexpected error occurred' });
    const kept = await ctx.api.get(`/api/products/${product.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body).toEqual({ ...product, notes: [second, first] });

    ctx.db.exec('DROP TRIGGER fail_product_delete');
    const retried = await deleteAs(`/api/products/${product.id}`);
    expect(retried.status).toBe(200);
  });

  it('T19.4a returns 404 "Product not found" for an unknown product id and changes nothing', async () => {
    const product = await ctx.createProduct('Lamp');
    const note = await ctx.createNote(product.id, 'Warm light');

    const res = await deleteAs('/api/products/9999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Product not found' });
    const list = await ctx.api.get('/api/products').expect(200);
    expect(list.body).toEqual([product]);
    const detail = await ctx.api.get(`/api/products/${product.id}`).expect(200);
    expect(detail.body).toEqual({ ...product, notes: [note] });
  });

  it.each(['abc', '0', '-1', '01', '1.5', '99999999999999999999'])(
    'T19.4b returns 404 "Product not found" for malformed product id "%s"',
    async (id) => {
      // The first product of a fresh database has id 1, so "01" or "1.5" must not reach it.
      const product = await ctx.createProduct('Existing');
      expect(product.id).toBe(1);

      const res = await deleteAs(`/api/products/${id}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Product not found' });
      const list = await ctx.api.get('/api/products').expect(200);
      expect(list.body).toEqual([product]);
    },
  );

  it('T19.4c returns 404 "Product not found" when the same product is deleted twice', async () => {
    const product = await ctx.createProduct('Chair');

    const first = await deleteAs(`/api/products/${product.id}`);
    const second = await deleteAs(`/api/products/${product.id}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ error: 'Product not found' });
  });
});

// Property tests run a minimum of 100 iterations each. Generators constrain inputs to the
// valid space: note content that is non-empty after trimming and within the 5000-char limit.
const PBT_RUNS = 100;

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** A note content string that survives `parseNoteContent`: 1..5000 chars after trimming. */
const randomNoteContent = (): string => {
  const length = randomInt(1, 120);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n\t 📦é';
  const chars = [...alphabet];
  let content = '';
  for (let i = 0; i < length; i += 1) content += chars[randomInt(0, chars.length - 1)];
  // Guarantee a non-whitespace character so the trimmed content is non-empty.
  return `x${content}`;
};

/** Registers a fresh user (unique username) and returns its id and a bearer auth header. */
const createAuthedUser = async (): Promise<{ id: number; auth: { Authorization: string } }> => {
  const username = `user_${randomInt(0, 1e9)}_${createAuthedUser.counter++}`;
  const user = await ctx.register(username);
  const token = await ctx.login(username);
  return { id: user.id, auth: { Authorization: `Bearer ${token}` } };
};
createAuthedUser.counter = 0;

describe('POST /api/products/:id/notes records the author (notes-edit-auth)', () => {
  // Feature: notes-edit-auth, Property 3: Note creation records the authenticated creator as author
  // Validates: Requirements 3.2, 3.3
  it('Property 3: note creation records the authenticated creator as author', async () => {
    for (let i = 0; i < PBT_RUNS; i += 1) {
      const product = await ctx.createProduct(`Product ${i}`);
      const { id: userId, auth } = await createAuthedUser();
      const content = randomNoteContent();

      const res = await ctx.api.post(`/api/products/${product.id}/notes`).set(auth).send({ content }).expect(201);

      // The created note's author is the authenticated creator (payload), ...
      expect(res.body.author).toBe(userId);
      // ... and it was persisted with that author id (storage).
      const storedAuthor = ctx.db.prepare('SELECT author_id FROM notes WHERE id = ?').get(res.body.id) as {
        author_id: number | null;
      };
      expect(storedAuthor.author_id).toBe(userId);
    }
  });

  // Example asserting the created note payload includes `author` (Req 4.1).
  it('includes the author on the created note payload (Req 4.1)', async () => {
    const product = await ctx.createProduct('Keyboard');
    const { id: userId, auth } = await createAuthedUser();

    const res = await ctx.api
      .post(`/api/products/${product.id}/notes`)
      .set(auth)
      .send({ content: 'Satisfying keypress' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(Number),
      productId: product.id,
      content: 'Satisfying keypress',
      author: userId,
      createdAt: expect.stringMatching(ISO_TIMESTAMP),
    });
  });
});

describe('Note author round-trips through persistence and payload (notes-edit-auth)', () => {
  // Feature: notes-edit-auth, Property 4: The author identifier round-trips through persistence and payload
  // Validates: Requirements 3.3, 4.1
  it('Property 4: the author identifier round-trips through persistence and payload', async () => {
    for (let i = 0; i < PBT_RUNS; i += 1) {
      const product = await ctx.createProduct(`Product ${i}`);
      const { id: userId, auth } = await createAuthedUser();
      const content = randomNoteContent();

      // Create a note authored by this user.
      const created = await ctx.api
        .post(`/api/products/${product.id}/notes`)
        .set(auth)
        .send({ content })
        .expect(201);

      // Read it back through the notes listing and assert the author identifier survived unchanged.
      const listed = await ctx.api.get(`/api/products/${product.id}/notes`).expect(200);
      const readBack = listed.body.find((note: { id: number }) => note.id === created.body.id);

      expect(readBack).toBeDefined();
      expect(readBack.author).toBe(userId);
      expect(readBack.author).toBe(created.body.author);
    }
  });
});

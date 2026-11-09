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

describe('GET /api/products/search (public product search)', () => {
  it('returns all products newest first when no query is given', async () => {
    const first = await ctx.createProduct('Moka pot');
    const second = await ctx.createProduct('Kettle');

    const res = await ctx.api.get('/api/products/search');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([second, first]);
  });

  it('returns all products for a blank or whitespace-only query', async () => {
    const product = await ctx.createProduct('Headphones');
    for (const q of ['', '   ']) {
      const res = await ctx.api.get('/api/products/search').query({ q }).expect(200);
      expect(res.body).toEqual([product]);
    }
  });

  it('matches by case-insensitive substring of the name', async () => {
    const moka = await ctx.createProduct('Moka Pot');
    await ctx.createProduct('Kettle');

    for (const q of ['moka', 'MOKA', 'ka po', 'Pot']) {
      const res = await ctx.api.get('/api/products/search').query({ q }).expect(200);
      expect(res.body).toEqual([moka]);
    }
  });

  it('requires every whitespace-separated term to match, in any order', async () => {
    const red = await ctx.createProduct('Red wool blanket');
    await ctx.createProduct('Blue cotton blanket');

    const match = await ctx.api.get('/api/products/search').query({ q: 'blanket red' }).expect(200);
    expect(match.body).toEqual([red]);

    const none = await ctx.api.get('/api/products/search').query({ q: 'red cotton' }).expect(200);
    expect(none.body).toEqual([]);
  });

  it('returns matches newest first', async () => {
    const older = await ctx.createProduct('Coffee grinder');
    const newer = await ctx.createProduct('Coffee maker');

    const res = await ctx.api.get('/api/products/search').query({ q: 'coffee' }).expect(200);
    expect(res.body).toEqual([newer, older]);
  });

  it('returns an empty array when nothing matches', async () => {
    await ctx.createProduct('Moka pot');
    const res = await ctx.api.get('/api/products/search').query({ q: 'nonexistent' }).expect(200);
    expect(res.body).toEqual([]);
  });

  it('treats LIKE wildcards as literal characters', async () => {
    const literal = await ctx.createProduct('50% off deal');
    await ctx.createProduct('Fifty off deal');

    // "%" would match everything if not escaped; here it must match the literal percent sign.
    const res = await ctx.api.get('/api/products/search').query({ q: '50%' }).expect(200);
    expect(res.body).toEqual([literal]);

    // "_" is the single-character wildcard in LIKE; escaped, it matches a literal underscore only.
    const underscore = await ctx.createProduct('a_b');
    const res2 = await ctx.api.get('/api/products/search').query({ q: 'a_b' }).expect(200);
    expect(res2.body).toEqual([underscore]);
  });

  it('is public: works without a token', async () => {
    const product = await ctx.createProduct('Public item');
    const res = await ctx.api.get('/api/products/search').query({ q: 'public' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([product]);
  });

  it('counts characters, not UTF-16 code units, for the length limit', async () => {
    const ok = await ctx.api.get('/api/products/search').query({ q: '📦'.repeat(200) });
    expect(ok.status).toBe(200);

    const tooLong = await ctx.api.get('/api/products/search').query({ q: '📦'.repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ error: 'Search query must not exceed 200 characters' });
  });

  it('rejects a repeated q param (array) with 400', async () => {
    const res = await ctx.api.get('/api/products/search?q=one&q=two');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Search query must be a single string' });
  });
});

describe('GET /api/products/search advanced filters (logged-in only)', () => {
  /** Sets a product's creation timestamp directly so date-range tests are deterministic. */
  const setCreatedAt = (productId: number, iso: string) =>
    ctx.db.prepare('UPDATE products SET created_at = ? WHERE id = ?').run(iso, productId);

  /** Creates a note on `productId` authored by the user behind `auth`. */
  const createNoteAs = async (productId: number, content: string, auth: { Authorization: string }) => {
    const res = await ctx.api.post(`/api/products/${productId}/notes`).set(auth).send({ content }).expect(201);
    return res.body as { id: number; author: number };
  };

  describe('access control', () => {
    it.each([
      ['from', { from: '2026-01-01' }],
      ['to', { to: '2026-12-31' }],
      ['noteText', { noteText: 'anything' }],
      ['author', { author: 'someone' }],
    ])('rejects the %s filter without a token with 401', async (_label, query) => {
      await ctx.createProduct('Moka pot');
      const res = await ctx.api.get('/api/products/search').query(query);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Log in to search by date, note text or author' });
    });

    it('still allows the public name filter without a token', async () => {
      const product = await ctx.createProduct('Moka pot');
      const res = await ctx.api.get('/api/products/search').query({ q: 'moka' }).expect(200);
      expect(res.body).toEqual([product]);
    });

    it('rejects an invalid token on an advanced filter with 401', async () => {
      await ctx.createProduct('Moka pot');
      const res = await ctx.api
        .get('/api/products/search')
        .query({ noteText: 'x' })
        .set({ Authorization: 'Bearer not-a-real-token' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid token' });
    });

    it('allows the advanced filters with a valid token', async () => {
      const auth = await ctx.authHeader();
      const product = await ctx.createProduct('Moka pot');
      setCreatedAt(product.id, '2026-06-15T12:00:00.000Z');

      const res = await ctx.api.get('/api/products/search').query({ from: '2026-01-01' }).set(auth).expect(200);
      expect(res.body).toEqual([{ ...product, createdAt: '2026-06-15T12:00:00.000Z' }]);
    });
  });

  describe('creation-date range', () => {
    it('includes products on the boundary dates (inclusive from and to)', async () => {
      const auth = await ctx.authHeader();
      const early = await ctx.createProduct('Early');
      const onFrom = await ctx.createProduct('On from');
      const onTo = await ctx.createProduct('On to');
      const late = await ctx.createProduct('Late');
      setCreatedAt(early.id, '2026-09-30T23:59:59.999Z');
      setCreatedAt(onFrom.id, '2026-10-01T00:00:00.000Z');
      setCreatedAt(onTo.id, '2026-10-31T23:59:59.999Z');
      setCreatedAt(late.id, '2026-11-01T00:00:00.000Z');

      const res = await ctx.api
        .get('/api/products/search')
        .query({ from: '2026-10-01', to: '2026-10-31' })
        .set(auth)
        .expect(200);

      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['On to', 'On from']);
    });

    it('filters with only a from date (open-ended upper bound)', async () => {
      const auth = await ctx.authHeader();
      const old = await ctx.createProduct('Old');
      const recent = await ctx.createProduct('Recent');
      setCreatedAt(old.id, '2025-01-01T00:00:00.000Z');
      setCreatedAt(recent.id, '2026-10-20T00:00:00.000Z');

      const res = await ctx.api.get('/api/products/search').query({ from: '2026-01-01' }).set(auth).expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Recent']);
    });

    it('rejects a malformed date with 400', async () => {
      const auth = await ctx.authHeader();
      const res = await ctx.api.get('/api/products/search').query({ from: '20-10-2026' }).set(auth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'From date must be a date in YYYY-MM-DD format' });
    });

    it('rejects an impossible calendar date with 400', async () => {
      const auth = await ctx.authHeader();
      const res = await ctx.api.get('/api/products/search').query({ to: '2026-02-30' }).set(auth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'To date is not a valid date' });
    });

    it('rejects a from date later than the to date with 400', async () => {
      const auth = await ctx.authHeader();
      const res = await ctx.api
        .get('/api/products/search')
        .query({ from: '2026-10-31', to: '2026-10-01' })
        .set(auth);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'From date must not be after the to date' });
    });
  });

  describe('note text', () => {
    it('returns products that have a note containing the text (case-insensitive)', async () => {
      const auth = await ctx.authHeader();
      const withNote = await ctx.createProduct('Camera');
      const other = await ctx.createProduct('Desk');
      await createNoteAs(withNote.id, 'Great LOW-light performance', auth);

      const res = await ctx.api.get('/api/products/search').query({ noteText: 'low-light' }).set(auth).expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Camera']);
      expect(res.body.some((p: { name: string }) => p.name === other.name)).toBe(false);
    });

    it('returns each matching product once even with several matching notes', async () => {
      const auth = await ctx.authHeader();
      const product = await ctx.createProduct('Headphones');
      await createNoteAs(product.id, 'Comfortable fit', auth);
      await createNoteAs(product.id, 'Comfortable earcups', auth);

      const res = await ctx.api.get('/api/products/search').query({ noteText: 'comfortable' }).set(auth).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Headphones');
    });

    it('returns nothing when no note contains the text', async () => {
      const auth = await ctx.authHeader();
      const product = await ctx.createProduct('Kettle');
      await createNoteAs(product.id, 'Boils fast', auth);

      const res = await ctx.api.get('/api/products/search').query({ noteText: 'slow' }).set(auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('note author', () => {
    it('returns products that have a note by the named user', async () => {
      const auth = await ctx.authHeader();
      // A second user with their own note on a different product.
      await ctx.register('bob');
      const bobToken = await ctx.login('bob');
      const bobAuth = { Authorization: `Bearer ${bobToken}` };

      const aliceProduct = await ctx.createProduct('Alice product');
      const bobProduct = await ctx.createProduct('Bob product');
      await createNoteAs(aliceProduct.id, 'tester note', auth); // default user is "tester"
      await createNoteAs(bobProduct.id, 'bob note', bobAuth);

      const res = await ctx.api.get('/api/products/search').query({ author: 'tester' }).set(auth).expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Alice product']);
    });

    it('matches the author username case-insensitively', async () => {
      const auth = await ctx.authHeader();
      const product = await ctx.createProduct('Widget');
      await createNoteAs(product.id, 'a note', auth);

      const res = await ctx.api.get('/api/products/search').query({ author: 'TESTER' }).set(auth).expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Widget']);
    });

    it('returns nothing for a user who has written no notes', async () => {
      const auth = await ctx.authHeader();
      const product = await ctx.createProduct('Widget');
      await createNoteAs(product.id, 'a note', auth);

      const res = await ctx.api.get('/api/products/search').query({ author: 'nobody' }).set(auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('combined filters', () => {
    it('applies name, note text and author together (all must match)', async () => {
      const auth = await ctx.authHeader();
      await ctx.register('bob');
      const bobAuth = { Authorization: `Bearer ${await ctx.login('bob')}` };

      const match = await ctx.createProduct('Moka pot');
      const wrongAuthor = await ctx.createProduct('Moka express');
      const wrongName = await ctx.createProduct('Kettle');
      await createNoteAs(match.id, 'great espresso', auth);
      await createNoteAs(wrongAuthor.id, 'great espresso', bobAuth);
      await createNoteAs(wrongName.id, 'great espresso', auth);

      const res = await ctx.api
        .get('/api/products/search')
        .query({ q: 'moka', noteText: 'espresso', author: 'tester' })
        .set(auth)
        .expect(200);

      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Moka pot']);
    });

    it('combines a date range with a note-text filter', async () => {
      const auth = await ctx.authHeader();
      const inRange = await ctx.createProduct('In range');
      const outOfRange = await ctx.createProduct('Out of range');
      setCreatedAt(inRange.id, '2026-10-15T00:00:00.000Z');
      setCreatedAt(outOfRange.id, '2026-12-15T00:00:00.000Z');
      await createNoteAs(inRange.id, 'durable build', auth);
      await createNoteAs(outOfRange.id, 'durable build', auth);

      const res = await ctx.api
        .get('/api/products/search')
        .query({ from: '2026-10-01', to: '2026-10-31', noteText: 'durable' })
        .set(auth)
        .expect(200);

      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['In range']);
    });
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

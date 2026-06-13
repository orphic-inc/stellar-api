import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// The default authed user is id 7 (see apiTestHarness). authorId 5 ≠ 7 → a
// cross-user (non-self) adoption.
const mockSheet = {
  id: 1,
  authorId: 5,
  name: 'Midnight',
  source: 'body { background: #000; }',
  createdAt: new Date('2026-06-13T00:00:00Z'),
  updatedAt: new Date('2026-06-13T00:00:00Z')
};

// ─── POST /api/stylesheet/author ──────────────────────────────────────────────

describe('POST /api/stylesheet/author', () => {
  it('authors a new stylesheet (201) — many per author, not an upsert', async () => {
    prismaMock.authorStylesheet.create.mockResolvedValue(mockSheet as never);

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Midnight', source: 'body { background: #000; }' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Midnight');
    expect(prismaMock.authorStylesheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: 7, name: 'Midnight' })
      })
    );
  });

  it('rejects an empty name (400)', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: '', source: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing source (400)', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Midnight' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/stylesheet/author/:userId ───────────────────────────────────────

describe('GET /api/stylesheet/author/:userId', () => {
  it("lists an author's stylesheets", async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      mockSheet
    ] as never);

    const res = await request(app).get('/api/stylesheet/author/5');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(prismaMock.authorStylesheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: 5 } })
    );
  });

  it('returns an empty list for an author with no stylesheets', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([] as never);
    const res = await request(app).get('/api/stylesheet/author/999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a non-numeric userId (400)', async () => {
    const res = await request(app).get('/api/stylesheet/author/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/stylesheet/author-stylesheet/:id ────────────────────────────────

describe('GET /api/stylesheet/author-stylesheet/:id', () => {
  it('reads one authored stylesheet', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );
    const res = await request(app).get('/api/stylesheet/author-stylesheet/1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('body { background: #000; }');
  });

  it('404s when the stylesheet does not exist', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/stylesheet/author-stylesheet/999');
    expect(res.status).toBe(404);
  });

  it('does not collide with GET /:id (author segment routed first)', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );
    await request(app).get('/api/stylesheet/author-stylesheet/1');
    // The site-stylesheet /:id handler must not have run.
    expect(prismaMock.stylesheet.findUnique).not.toHaveBeenCalled();
  });
});

// ─── POST /api/stylesheet/author-stylesheet/:id/adopt ─────────────────────────

describe('POST /api/stylesheet/author-stylesheet/:id/adopt', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.economyTransaction.findFirst.mockResolvedValue(null);
    prismaMock.economyTransaction.create.mockResolvedValue({} as never);
  });

  it('adopts a cross-user sheet: points the Site slot + credits the author', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );

    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/1/adopt'
    );

    expect(res.status).toBe(200);
    expect(res.body.scored).toBe(true);
    // Site Stylesheet slot points at the adopted sheet.
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: {
          userSettings: { update: { activeAuthorStylesheetId: 1 } }
        }
      })
    );
    // Ledger row credits the author (5), actor is the adopter (7).
    expect(prismaMock.economyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 5,
          actorUserId: 7,
          reason: 'CRS_STYLESHEET_ADOPTION'
        })
      })
    );
  });

  it('is idempotent: re-adopting the same author writes no second ledger row', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );
    prismaMock.economyTransaction.findFirst.mockResolvedValue({
      id: 99
    } as never);

    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/1/adopt'
    );

    expect(res.status).toBe(200);
    expect(res.body.scored).toBe(false);
    expect(prismaMock.user.update).toHaveBeenCalled(); // slot still updated
    expect(prismaMock.economyTransaction.create).not.toHaveBeenCalled();
  });

  it('self-adoption renders but credits nothing (anti-farm)', async () => {
    // authorId 7 === the adopter → scoreStylesheetSelection returns author: null.
    prismaMock.authorStylesheet.findUnique.mockResolvedValue({
      ...mockSheet,
      authorId: 7
    } as never);

    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/1/adopt'
    );

    expect(res.status).toBe(200);
    expect(res.body.scored).toBe(false);
    expect(prismaMock.user.update).toHaveBeenCalled(); // own sheet still rendered
    expect(prismaMock.economyTransaction.create).not.toHaveBeenCalled();
    expect(prismaMock.economyTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('404s when adopting a non-existent stylesheet', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/999/adopt'
    );
    expect(res.status).toBe(404);
  });
});

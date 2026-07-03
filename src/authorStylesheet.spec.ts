import { Prisma } from '@prisma/client';
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// The default authed user is id 7 (see apiTestHarness), on userRankId 1.
// authorId 5 ≠ 7 → a cross-user (non-self) adoption.
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

  it('allows creation when authorStylesheetLimit is 0 (unlimited, default)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank() as never); // authorStylesheetLimit: 0
    prismaMock.authorStylesheet.create.mockResolvedValue(mockSheet as never);

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Midnight', source: 'body { background: #000; }' });

    expect(res.status).toBe(201);
    expect(prismaMock.authorStylesheet.count).not.toHaveBeenCalled();
  });

  it('rejects creation at the rank-configured limit (400) — registry spaces (#146)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      ...makeUserRank(),
      authorStylesheetLimit: 1
    } as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Second Sheet', source: 'body { color: red; }' });

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/Author stylesheet limit reached/);
    expect(prismaMock.authorStylesheet.create).not.toHaveBeenCalled();
  });

  it('allows creation below the rank-configured limit', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      ...makeUserRank(),
      authorStylesheetLimit: 2
    } as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(1);
    prismaMock.authorStylesheet.create.mockResolvedValue(mockSheet as never);

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'Second Sheet', source: 'body { color: red; }' });

    expect(res.status).toBe(201);
  });
});

// ─── GET /api/stylesheet/author/:userId ───────────────────────────────────────

describe('GET /api/stylesheet/author/:userId', () => {
  it("lists an author's stylesheets, paginated (#146)", async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      mockSheet
    ] as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(1);

    const res = await request(app).get('/api/stylesheet/author/5');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(prismaMock.authorStylesheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: 5 } })
    );
    expect(prismaMock.authorStylesheet.count).toHaveBeenCalledWith({
      where: { authorId: 5 }
    });
  });

  it('lists metadata only — source never rides a list payload (ADR-0024 §1)', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([] as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(0);
    await request(app).get('/api/stylesheet/author/5');
    const call = prismaMock.authorStylesheet.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(call.select).toEqual({
      id: true,
      authorId: true,
      name: true,
      createdAt: true,
      updatedAt: true
    });
    expect(call.select.source).toBeUndefined();
  });

  it('respects page/limit query params (skip/take passed to findMany)', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([] as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(45);

    const res = await request(app).get(
      '/api/stylesheet/author/5?page=2&limit=10'
    );

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({
      total: 45,
      page: 2,
      limit: 10,
      totalPages: 5
    });
    expect(prismaMock.authorStylesheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it('returns an empty list for an author with no stylesheets', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([] as never);
    prismaMock.authorStylesheet.count.mockResolvedValue(0);
    const res = await request(app).get('/api/stylesheet/author/999');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
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

// ─── GET /api/stylesheet/author-stylesheet/:id/css ────────────────────────────

describe('GET /api/stylesheet/author-stylesheet/:id/css', () => {
  it('delivers the stored source as text/css with revalidate + nosniff', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue({
      source: 'body { background: #000; }'
    } as never);

    const res = await request(app).get(
      '/api/stylesheet/author-stylesheet/1/css'
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).toBe('body { background: #000; }');
  });

  it('selects only source — the delivery read never over-fetches', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue({
      source: 'a{}'
    } as never);
    await request(app).get('/api/stylesheet/author-stylesheet/1/css');
    expect(prismaMock.authorStylesheet.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: { source: true } })
    );
  });

  it('404s when the stylesheet does not exist', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).get(
      '/api/stylesheet/author-stylesheet/999/css'
    );
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/stylesheet/author-stylesheet/:id/adopt ─────────────────────────

describe('POST /api/stylesheet/author-stylesheet/:id/adopt', () => {
  beforeEach(() => {
    // The Site-slot pointer update and the ledger write are no longer wrapped
    // in one transaction — each runs directly against the client (the partial
    // unique index, not an app-level findFirst, enforces dedup).
    prismaMock.user.update.mockResolvedValue({} as never);
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

  it('is idempotent: a duplicate (adopter, author) pair (P2002) is not a second credit', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      mockSheet as never
    );
    // The partial unique index rejects the second insert; the module swallows
    // P2002 and reports scored: false rather than double-crediting the author.
    prismaMock.economyTransaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0'
      })
    );

    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/1/adopt'
    );

    expect(res.status).toBe(200);
    expect(res.body.scored).toBe(false);
    expect(prismaMock.user.update).toHaveBeenCalled(); // slot still updated
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
  });

  it('404s when adopting a non-existent stylesheet', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).post(
      '/api/stylesheet/author-stylesheet/999/adopt'
    );
    expect(res.status).toBe(404);
  });
});

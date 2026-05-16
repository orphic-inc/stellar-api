import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  setCurrentUserRankLevel
} from './test/apiTestHarness';

const makeAuthor = () => ({ id: 7, username: 'testuser' });

const makePage = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  title: 'Test Page',
  slug: 'test-page',
  revision: 1,
  minReadLevel: 0,
  minEditLevel: 0,
  authorId: 7,
  author: makeAuthor(),
  body: '<p>Hello</p>',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  deletedAt: null,
  aliases: [
    { alias: 'test-page', userId: 7, createdAt: new Date('2026-01-01') }
  ],
  ...overrides
});

const makeRevision = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  pageId: 2,
  revision: 1,
  title: 'Old Title',
  body: '<p>Old body</p>',
  authorId: 7,
  author: makeAuthor(),
  createdAt: new Date('2026-01-01'),
  ...overrides
});

const makeUserRankWithPerms = (perms: Record<string, boolean> = {}) => ({
  id: 1,
  name: 'User',
  level: 100,
  permissions: perms,
  color: null,
  badge: null,
  isDefault: true,
  isDonor: false,
  uploadMultiplier: 1,
  downloadDivider: 1,
  minRatio: 0,
  createdAt: new Date()
});

beforeEach(() => resetApiTestState());

// ─── GET /api/wiki ─────────────────────────────────────────────────────────────

describe('GET /api/wiki', () => {
  it('returns paginated list filtered by user rank level', async () => {
    setCurrentUserRankLevel(0);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );
    prismaMock.wikiPage.findMany.mockResolvedValue([makePage()] as never);
    prismaMock.wikiPage.count.mockResolvedValue(1);

    const res = await request(app).get('/api/wiki');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 200 with empty data when no pages match', async () => {
    prismaMock.wikiPage.findMany.mockResolvedValue([]);
    prismaMock.wikiPage.count.mockResolvedValue(0);

    const res = await request(app).get('/api/wiki');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ─── GET /api/wiki/:id ─────────────────────────────────────────────────────────

describe('GET /api/wiki/:id', () => {
  it('returns a page when found', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);

    const res = await request(app).get('/api/wiki/2');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test Page');
  });

  it('returns 404 when page does not exist', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/wiki/99');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user rank is below minReadLevel', async () => {
    setCurrentUserRankLevel(5);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ minReadLevel: 100 }) as never
    );

    const res = await request(app).get('/api/wiki/2');

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/wiki/:id/revisions ──────────────────────────────────────────────

describe('GET /api/wiki/:id/revisions', () => {
  it('returns revision list for users with edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ minReadLevel: 0, minEditLevel: 0 }) as never
    );
    prismaMock.wikiRevision.findMany.mockResolvedValue([
      makeRevision()
    ] as never);

    const res = await request(app).get('/api/wiki/2/revisions');

    expect(res.status).toBe(200);
    expect(res.body.revisions).toHaveLength(1);
    expect(res.body.currentRevision).toBe(1);
  });

  it('returns 403 when user lacks edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ minReadLevel: 0, minEditLevel: 0 }) as never
    );

    const res = await request(app).get('/api/wiki/2/revisions');

    expect(res.status).toBe(403);
  });

  it('returns 404 when page does not exist', async () => {
    prismaMock.wikiPage.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/wiki/99/revisions');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/wiki/:id/compare ────────────────────────────────────────────────

describe('GET /api/wiki/:id/compare', () => {
  it('returns bodies for two revisions', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ revision: 3 }) as never
    );
    prismaMock.wikiRevision.findUnique.mockResolvedValueOnce(
      makeRevision({ revision: 1, body: '<p>Rev 1</p>' }) as never
    );
    prismaMock.wikiRevision.findUnique.mockResolvedValueOnce(
      makeRevision({ revision: 2, body: '<p>Rev 2</p>' }) as never
    );

    const res = await request(app).get('/api/wiki/2/compare?old=1&new=2');

    expect(res.status).toBe(200);
    expect(res.body.old.revision).toBe(1);
    expect(res.body.new.revision).toBe(2);
    expect(res.body.old.body).toBe('<p>Rev 1</p>');
    expect(res.body.new.body).toBe('<p>Rev 2</p>');
  });

  it('returns 400 when old >= new', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);

    const res = await request(app).get('/api/wiki/2/compare?old=2&new=1');

    expect(res.status).toBe(400);
  });

  it('returns 403 when user lacks edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);

    const res = await request(app).get('/api/wiki/2/compare?old=1&new=2');

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/wiki/:id ─────────────────────────────────────────────────────

describe('DELETE /api/wiki/:id', () => {
  it('soft-deletes the page', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_manage: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);
    prismaMock.wikiPage.update.mockResolvedValue(makePage() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(prismaMock);
    });

    const res = await request(app).delete('/api/wiki/2');

    expect(res.status).toBe(204);
  });

  it('refuses to delete the index article (id=1)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_manage: true }) as never
    );

    const res = await request(app).delete('/api/wiki/1');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/main wiki article/i);
  });

  it('returns 403 without wiki_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );

    const res = await request(app).delete('/api/wiki/2');

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/wiki ───────────────────────────────────────────────────────────

describe('POST /api/wiki', () => {
  it('creates a new page with wiki_edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(prismaMock);
    });
    prismaMock.wikiPage.create.mockResolvedValue(makePage() as never);
    prismaMock.wikiAlias.create.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/wiki').send({
      title: 'New Page',
      body: '<p>Content</p>'
    });

    expect(res.status).toBe(201);
  });

  it('returns 403 without any wiki permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );

    const res = await request(app).post('/api/wiki').send({
      title: 'New Page',
      body: '<p>Content</p>'
    });

    expect(res.status).toBe(403);
  });

  it('returns 409 when slug already exists', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findUnique.mockResolvedValue(makePage() as never);

    const res = await request(app).post('/api/wiki').send({
      title: 'Test Page',
      body: '<p>Content</p>'
    });

    expect(res.status).toBe(409);
  });
});

// ─── GET /api/wiki/by-alias/:alias ───────────────────────────────────────────

describe('GET /api/wiki/by-alias/:alias', () => {
  it('returns the page when alias exists', async () => {
    prismaMock.wikiAlias.findUnique.mockResolvedValue({
      alias: 'test-page',
      pageId: 2,
      userId: 7,
      createdAt: new Date(),
      page: makePage() as never
    } as never);

    const res = await request(app).get('/api/wiki/by-alias/test-page');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test Page');
  });

  it('returns 404 when alias does not exist', async () => {
    prismaMock.wikiAlias.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/wiki/by-alias/missing');

    expect(res.status).toBe(404);
  });
});

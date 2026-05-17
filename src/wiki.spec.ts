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

  it('returns 404 when the user cannot read the restricted page', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ minReadLevel: 100, minEditLevel: 100 }) as never
    );

    const res = await request(app).get('/api/wiki/2/revisions');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/wiki/:id/revisions/:rev ────────────────────────────────────────

describe('GET /api/wiki/:id/revisions/:rev', () => {
  it('returns the current page body when requesting the current revision', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({
        revision: 4,
        title: 'Current Title',
        body: '<p>Current body</p>',
        updatedAt: new Date('2026-01-03')
      }) as never
    );

    const res = await request(app).get('/api/wiki/2/revisions/4');

    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(4);
    expect(res.body.title).toBe('Current Title');
    expect(res.body.body).toBe('<p>Current body</p>');
    expect(prismaMock.wikiRevision.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the historical revision does not exist', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);
    prismaMock.wikiRevision.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/wiki/2/revisions/7');

    expect(res.status).toBe(404);
    expect(res.body.msg).toMatch(/revision not found/i);
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

  it('returns 404 when a requested revision is missing', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ revision: 3, body: '<p>Current</p>' }) as never
    );
    prismaMock.wikiRevision.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/wiki/2/compare?old=1&new=3');

    expect(res.status).toBe(404);
    expect(res.body.msg).toMatch(/revision 1 not found/i);
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

  it('returns 403 when alias resolves to a page above the user rank', async () => {
    setCurrentUserRankLevel(5);
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({}) as never
    );
    prismaMock.wikiAlias.findUnique.mockResolvedValue({
      alias: 'test-page',
      pageId: 2,
      userId: 7,
      createdAt: new Date(),
      page: makePage({ minReadLevel: 100, deletedAt: null }) as never
    } as never);

    const res = await request(app).get('/api/wiki/by-alias/test-page');

    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/wiki/:id ───────────────────────────────────────────────────────

describe('PUT /api/wiki/:id', () => {
  it('updates a page, stores a revision, and clamps minEditLevel to minReadLevel', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_manage: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({
        revision: 3,
        title: 'Old Title',
        body: '<p>Old body</p>',
        minReadLevel: 50,
        minEditLevel: 75
      }) as never
    );
    prismaMock.wikiRevision.create.mockResolvedValue({} as never);
    prismaMock.wikiPage.update.mockResolvedValue(
      makePage({
        revision: 4,
        title: 'Updated Title',
        body: '<p>Updated</p>',
        minReadLevel: 250,
        minEditLevel: 250
      }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(prismaMock);
    });

    const res = await request(app).put('/api/wiki/2').send({
      title: 'Updated Title',
      body: '<p>Updated</p>',
      minReadLevel: 250,
      minEditLevel: 100
    });

    expect(res.status).toBe(200);
    expect(prismaMock.wikiRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: 2,
          revision: 3,
          title: 'Old Title'
        })
      })
    );
    expect(prismaMock.wikiPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Updated Title',
          body: '<p>Updated</p>',
          revision: 4,
          minReadLevel: 250,
          minEditLevel: 250
        })
      })
    );
  });
});

// ─── POST /api/wiki/:id/aliases ──────────────────────────────────────────────

describe('POST /api/wiki/:id/aliases', () => {
  it('creates an alias for an editable page', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ minEditLevel: 0 }) as never
    );
    prismaMock.wikiAlias.findUnique.mockResolvedValue(null);
    prismaMock.wikiAlias.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/wiki/2/aliases').send({
      alias: 'new-alias'
    });

    expect(res.status).toBe(201);
    expect(res.body.alias).toBe('new-alias');
    expect(prismaMock.wikiAlias.create).toHaveBeenCalledWith({
      data: { alias: 'new-alias', pageId: 2, userId: 7 }
    });
  });

  it('returns 409 when the alias already exists', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(makePage() as never);
    prismaMock.wikiAlias.findUnique.mockResolvedValue({
      alias: 'old-page',
      pageId: 9
    } as never);

    const res = await request(app).post('/api/wiki/2/aliases').send({
      alias: 'old-page'
    });

    expect(res.status).toBe(409);
  });
});

// ─── DELETE /api/wiki/:id/aliases/:alias ─────────────────────────────────────

describe('DELETE /api/wiki/:id/aliases/:alias', () => {
  it('rejects removing the primary slug alias', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({ slug: 'test-page', minEditLevel: 0 }) as never
    );

    const res = await request(app).delete('/api/wiki/2/aliases/test-page');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/primary slug alias/i);
  });
});

// ─── POST /api/wiki/:id/rollback/:rev ────────────────────────────────────────

describe('POST /api/wiki/:id/rollback/:rev', () => {
  it('rolls back to a historical revision and records audit state', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRankWithPerms({ wiki_edit: true }) as never
    );
    prismaMock.wikiPage.findFirst.mockResolvedValue(
      makePage({
        revision: 5,
        title: 'Current Title',
        body: '<p>Current body</p>',
        minEditLevel: 0
      }) as never
    );
    prismaMock.wikiRevision.findUnique.mockResolvedValue(
      makeRevision({
        revision: 2,
        title: 'Rollback Title',
        body: '<p>Rollback body</p>'
      }) as never
    );
    prismaMock.wikiRevision.create.mockResolvedValue({} as never);
    prismaMock.wikiPage.update.mockResolvedValue(
      makePage({
        revision: 6,
        title: 'Rollback Title',
        body: '<p>Rollback body</p>'
      }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(prismaMock);
    });

    const res = await request(app).post('/api/wiki/2/rollback/2');

    expect(res.status).toBe(200);
    expect(prismaMock.wikiPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2 },
        data: expect.objectContaining({
          title: 'Rollback Title',
          body: '<p>Rollback body</p>',
          revision: 6
        })
      })
    );
  });
});

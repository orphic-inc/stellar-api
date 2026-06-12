import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

const makePage = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  slug: 'golden-rules',
  title: 'Golden Rules',
  body: '<p>Be excellent.</p>',
  isMain: false,
  sortOrder: 0,
  authorId: 7,
  author: { id: 7, username: 'testuser' },
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
  ...overrides
});

const makeMain = (overrides: Record<string, unknown> = {}) =>
  makePage({ id: 2, slug: 'main', title: 'Rules', isMain: true, ...overrides });

beforeEach(() => resetApiTestState());

describe('GET /api/rules', () => {
  it('returns main null and empty pages when none exist', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(null);
    prismaMock.rulesPage.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/rules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ main: null, pages: [] });
  });

  it('returns main page and sub-pages', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(makeMain() as never);
    prismaMock.rulesPage.findMany.mockResolvedValue([makePage()] as never);

    const res = await request(app).get('/api/rules');

    expect(res.status).toBe(200);
    expect(res.body.main.slug).toBe('main');
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0].slug).toBe('golden-rules');
  });
});

describe('GET /api/rules/:slug', () => {
  it('returns page by slug', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(makePage() as never);

    const res = await request(app).get('/api/rules/golden-rules');

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('golden-rules');
  });

  it('returns 404 for unknown slug', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/rules/no-such-page');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/rules', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ rules_manage: true })
    );
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)
    );
  });

  it('creates a sub-page and returns 201', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(null);
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);
    prismaMock.rulesPage.create.mockResolvedValue(makePage() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Golden Rules', body: '<p>Be excellent.</p>' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('golden-rules');
  });

  it('auto-derives slug from title', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(null);
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);
    prismaMock.rulesPage.create.mockResolvedValue(
      makePage({ slug: 'forum-rules', title: 'Forum Rules' }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Forum Rules', body: 'Rules for the forum.' });

    expect(res.status).toBe(201);
    expect(prismaMock.rulesPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'forum-rules' })
      })
    );
  });

  it('creates the main page when isMain true and none exists', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(null);
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);
    prismaMock.rulesPage.create.mockResolvedValue(makeMain() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Rules', body: '<p>Site rules.</p>', isMain: true });

    expect(res.status).toBe(201);
    expect(res.body.isMain).toBe(true);
  });

  it('returns 409 when a main page already exists', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(makeMain() as never);

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Another Main', body: 'Body.', isMain: true });

    expect(res.status).toBe(409);
    expect(prismaMock.rulesPage.create).not.toHaveBeenCalled();
  });

  it('returns 409 when slug already exists', async () => {
    prismaMock.rulesPage.findFirst.mockResolvedValue(null);
    prismaMock.rulesPage.findUnique.mockResolvedValue(makePage() as never);

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Golden Rules', body: 'Duplicate.' });

    expect(res.status).toBe(409);
  });

  it('returns 403 without rules_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when body is missing', async () => {
    const res = await request(app)
      .post('/api/rules')
      .send({ title: 'Title only' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/rules/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ rules_manage: true })
    );
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)
    );
  });

  it('updates a page and returns it', async () => {
    const updated = makePage({ title: 'Updated Title' });
    prismaMock.rulesPage.findUnique.mockResolvedValue(makePage() as never);
    prismaMock.rulesPage.update.mockResolvedValue(updated as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/rules/1')
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });

  it('returns 404 when page does not exist', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);

    const res = await request(app).put('/api/rules/999').send({ title: 'T' });

    expect(res.status).toBe(404);
  });

  it('returns 400 on non-numeric id', async () => {
    const res = await request(app)
      .put('/api/rules/notanumber')
      .send({ title: 'T' });

    expect(res.status).toBe(400);
  });

  it('returns 403 without rules_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).put('/api/rules/1').send({ title: 'T' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/rules/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ rules_manage: true })
    );
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)
    );
  });

  it('deletes a sub-page and returns 204', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(makePage() as never);
    prismaMock.rulesPage.delete.mockResolvedValue(makePage() as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/rules/1');

    expect(res.status).toBe(204);
    expect(prismaMock.rulesPage.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 400 when trying to delete the main page', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(makeMain() as never);

    const res = await request(app).delete('/api/rules/2');

    expect(res.status).toBe(400);
    expect(prismaMock.rulesPage.delete).not.toHaveBeenCalled();
  });

  it('returns 404 when page does not exist', async () => {
    prismaMock.rulesPage.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/rules/999');

    expect(res.status).toBe(404);
  });

  it('returns 403 without rules_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).delete('/api/rules/1');

    expect(res.status).toBe(403);
  });
});

// ─── Rule/SubRule tree (PRD-05 #1) ────────────────────────────────────────────

const makeRule = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  code: 'golden.accounts',
  title: 'Accounts',
  description: 'One account per person per lifetime.',
  complianceWeight: 1,
  violationWeight: 5,
  sortOrder: 0,
  createdAt: new Date('2026-06-12'),
  updatedAt: new Date('2026-06-12'),
  subRules: [],
  ...overrides
});

describe('GET /api/rules/tree', () => {
  it('returns the rule tree with nested sub-rules, ordered', async () => {
    prismaMock.rule.findMany.mockResolvedValue([
      makeRule({
        subRules: [
          {
            id: 10,
            ruleId: 1,
            code: 'no-sharing',
            title: 'No sharing',
            description: '',
            complianceWeight: 0,
            violationWeight: 3,
            sortOrder: 0,
            createdAt: new Date('2026-06-12'),
            updatedAt: new Date('2026-06-12')
          }
        ]
      }),
      makeRule({
        id: 2,
        code: 'golden.invites',
        title: 'Invites',
        sortOrder: 1
      })
    ] as never);

    const res = await request(app).get('/api/rules/tree');

    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(2);
    expect(res.body.rules[0].code).toBe('golden.accounts');
    expect(res.body.rules[0].subRules[0].code).toBe('no-sharing');
    expect(res.body.rules[0].violationWeight).toBe(5);
    // tree is read ordered by sortOrder then id, sub-rules nested + ordered
    expect(prismaMock.rule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          subRules: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }
        }
      })
    );
  });

  it('returns an empty rules array when no rules are defined', async () => {
    prismaMock.rule.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/rules/tree');
    expect(res.status).toBe(200);
    expect(res.body.rules).toEqual([]);
  });

  it('is not shadowed by GET /:slug (static segment wins)', async () => {
    prismaMock.rule.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/rules/tree');
    // a 200 with { rules } proves /tree resolved here, not the rules-page handler
    expect(res.body).toHaveProperty('rules');
    expect(prismaMock.rulesPage.findUnique).not.toHaveBeenCalled();
  });
});

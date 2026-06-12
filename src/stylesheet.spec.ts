import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const makeStylesheet = (overrides = {}) => ({
  id: 1,
  name: 'sublime',
  description: 'Default Stellar theme',
  cssUrl: '/stylesheets/sublime/style.css',
  isDefault: true,
  createdAt: new Date('2026-01-01'),
  ...overrides
});

// ─── GET /api/stylesheet ──────────────────────────────────────────────────────

describe('GET /api/stylesheet', () => {
  it('returns the list of stylesheets', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([
      makeStylesheet(),
      makeStylesheet({ id: 2, name: 'kuro', isDefault: false })
    ] as never);

    const res = await request(app).get('/api/stylesheet');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('sublime');
    expect(res.body[0].isDefault).toBe(true);
    expect(res.body[0].description).toBe('Default Stellar theme');
  });

  it('returns an empty array when no stylesheets exist', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/stylesheet');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─── GET /api/stylesheet/admin/stats ─────────────────────────────────────────

describe('GET /api/stylesheet/admin/stats', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('returns stylesheet user counts for admin', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([
      makeStylesheet({ id: 1, name: 'sublime' }),
      makeStylesheet({ id: 2, name: 'kuro', isDefault: false })
    ] as never);
    (prismaMock.userSettings.groupBy as jest.Mock).mockResolvedValue([
      { siteAppearance: 'sublime', _count: { siteAppearance: 42 } },
      { siteAppearance: 'kuro', _count: { siteAppearance: 5 } }
    ]);

    const res = await request(app).get('/api/stylesheet/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(
      res.body.find((s: { name: string }) => s.name === 'sublime').userCount
    ).toBe(42);
    expect(
      res.body.find((s: { name: string }) => s.name === 'kuro').userCount
    ).toBe(5);
  });

  it('returns 0 for stylesheets with no users', async () => {
    prismaMock.stylesheet.findMany.mockResolvedValue([
      makeStylesheet({ id: 1, name: 'sublime' })
    ] as never);
    (prismaMock.userSettings.groupBy as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get('/api/stylesheet/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body[0].userCount).toBe(0);
  });

  it('returns 403 for non-admin', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).get('/api/stylesheet/admin/stats');
    expect(res.status).toBe(403);
  });

  it('returns 403 for staff (strict admin only)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    const res = await request(app).get('/api/stylesheet/admin/stats');
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/stylesheet/:id ──────────────────────────────────────────────────

describe('GET /api/stylesheet/:id', () => {
  it('returns a stylesheet by id', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );
    const res = await request(app).get('/api/stylesheet/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('sublime');
    expect(res.body.isDefault).toBe(true);
  });

  it('returns 404 when the stylesheet does not exist', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/stylesheet/99');
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Stylesheet not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/stylesheet/not-a-number');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/stylesheet ─────────────────────────────────────────────────────

describe('POST /api/stylesheet', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('creates a stylesheet and returns 201', async () => {
    prismaMock.stylesheet.create.mockResolvedValue(
      makeStylesheet({ id: 3, name: 'custom', isDefault: false }) as never
    );

    const res = await request(app).post('/api/stylesheet').send({
      name: 'custom',
      cssUrl: '/stylesheets/custom/style.css',
      description: 'Custom'
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('custom');
    expect(prismaMock.stylesheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'custom',
          cssUrl: '/stylesheets/custom/style.css',
          description: 'Custom',
          isDefault: false
        })
      })
    );
  });

  it('clears existing default when creating with isDefault: true', async () => {
    const newSheet = makeStylesheet({ id: 3, name: 'custom', isDefault: true });
    prismaMock.stylesheet.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.stylesheet.create.mockResolvedValue(newSheet as never);

    const res = await request(app).post('/api/stylesheet').send({
      name: 'custom',
      cssUrl: '/stylesheets/custom/style.css',
      isDefault: true
    });

    expect(res.status).toBe(201);
    expect(prismaMock.stylesheet.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false }
    });
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom' });
    expect(res.status).toBe(400);
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: '/stylesheets/custom/style.css' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for staff (strict admin only)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: '/stylesheets/custom/style.css' });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/stylesheet/:id ──────────────────────────────────────────────────

describe('PUT /api/stylesheet/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('updates a stylesheet and returns 200', async () => {
    const updated = makeStylesheet({ description: 'Updated description' });
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );
    prismaMock.stylesheet.update.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
  });

  it('clears existing default when setting isDefault: true', async () => {
    const updated = makeStylesheet({ id: 2, name: 'kuro', isDefault: true });
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet({ id: 2, name: 'kuro', isDefault: false }) as never
    );
    prismaMock.stylesheet.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.stylesheet.update.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/stylesheet/2')
      .send({ isDefault: true });

    expect(res.status).toBe(200);
    expect(prismaMock.stylesheet.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false }
    });
  });

  it('returns 404 when the stylesheet does not exist', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/stylesheet/99')
      .send({ description: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app)
      .put('/api/stylesheet/abc')
      .send({ description: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).put('/api/stylesheet/1').send({});
    expect(res.status).toBe(400);
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ description: 'x' });
    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/stylesheet/:id ───────────────────────────────────────────────

describe('DELETE /api/stylesheet/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
  });

  it('deletes a non-default stylesheet and returns 204', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet({ isDefault: false }) as never
    );
    prismaMock.stylesheet.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/stylesheet/1');

    expect(res.status).toBe(204);
    expect(prismaMock.stylesheet.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 400 when trying to delete the default stylesheet', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet({ isDefault: true }) as never
    );

    const res = await request(app).delete('/api/stylesheet/1');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Cannot delete the default stylesheet');
  });

  it('returns 404 when the stylesheet does not exist', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/stylesheet/99');
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Stylesheet not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).delete('/api/stylesheet/abc');
    expect(res.status).toBe(400);
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).delete('/api/stylesheet/1');
    expect(res.status).toBe(403);
  });

  it('returns 403 for staff (strict admin only)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    const res = await request(app).delete('/api/stylesheet/1');
    expect(res.status).toBe(403);
  });
});

// ─── AuthorStylesheet (PRD-03 #4a) ────────────────────────────────────────────

const makeAuthorStylesheet = (overrides = {}) => ({
  id: 1,
  authorId: 7,
  name: 'my-theme',
  description: 'A theme I made',
  source: 'body { background: #111; }',
  createdAt: new Date('2026-06-12'),
  updatedAt: new Date('2026-06-12'),
  ...overrides
});

describe('POST /api/stylesheet/author', () => {
  it('saves the authed user’s stylesheet and returns 201', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);
    prismaMock.authorStylesheet.create.mockResolvedValue(
      makeAuthorStylesheet() as never
    );

    const res = await request(app).post('/api/stylesheet/author').send({
      name: 'my-theme',
      description: 'A theme I made',
      source: 'body { background: #111; }'
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('my-theme');
    expect(res.body.authorId).toBe(7);
    expect(prismaMock.authorStylesheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorId: 7,
          name: 'my-theme',
          source: 'body { background: #111; }'
        })
      })
    );
  });

  it('returns 409 when the author already has a sheet with that name', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(
      makeAuthorStylesheet() as never
    );

    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'my-theme', source: 'body {}' });

    expect(res.status).toBe(409);
    expect(prismaMock.authorStylesheet.create).not.toHaveBeenCalled();
  });

  it('returns 400 when source is missing', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: 'my-theme' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty', async () => {
    const res = await request(app)
      .post('/api/stylesheet/author')
      .send({ name: '', source: 'body {}' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/stylesheet/author/:authorId', () => {
  it('reads an author’s saved stylesheets back', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([
      makeAuthorStylesheet(),
      makeAuthorStylesheet({ id: 2, name: 'second' })
    ] as never);

    const res = await request(app).get('/api/stylesheet/author/7');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('my-theme');
    expect(prismaMock.authorStylesheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authorId: 7 } })
    );
  });

  it('returns an empty array when the author has none', async () => {
    prismaMock.authorStylesheet.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/stylesheet/author/99');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 400 for a non-numeric authorId', async () => {
    const res = await request(app).get('/api/stylesheet/author/not-a-number');
    expect(res.status).toBe(400);
  });
});

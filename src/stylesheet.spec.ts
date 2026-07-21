import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// A well-formed delivery target — the only non-null shape the registry accepts
// (ADR-0024 §4, enforced on the write path by #375).
const DELIVERY_URL = '/api/stylesheet/author-stylesheet/7/css';

// Sublime carries `cssUrl: null`: the bundled Tailwind already is Sublime, so
// there is no target to deliver. That is the partition's other legal arm, not a
// missing value.
const makeStylesheet = (overrides = {}) => ({
  id: 1,
  name: 'sublime',
  description: 'Default Stellar theme',
  cssUrl: null,
  isDefault: true,
  createdAt: new Date('2026-01-01'),
  ...overrides
});

/** The `AuthorStylesheet` a delivery target names, present by default. */
const mockDeliveryTargetExists = (id = 7) =>
  prismaMock.authorStylesheet.findUnique.mockResolvedValue({ id } as never);

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
    mockDeliveryTargetExists();
  });

  it('creates a stylesheet and returns 201', async () => {
    prismaMock.stylesheet.create.mockResolvedValue(
      makeStylesheet({
        id: 3,
        name: 'custom',
        cssUrl: DELIVERY_URL,
        isDefault: false
      }) as never
    );

    const res = await request(app).post('/api/stylesheet').send({
      name: 'custom',
      cssUrl: DELIVERY_URL,
      description: 'Custom'
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('custom');
    expect(prismaMock.stylesheet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'custom',
          cssUrl: DELIVERY_URL,
          description: 'Custom',
          isDefault: false
        })
      })
    );
  });

  it('creates a no-delivery row when cssUrl is null', async () => {
    prismaMock.stylesheet.create.mockResolvedValue(
      makeStylesheet({ id: 3, name: 'custom', isDefault: false }) as never
    );

    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: null });

    expect(res.status).toBe(201);
    // The null arm must not be mistaken for a target and looked up.
    expect(prismaMock.authorStylesheet.findUnique).not.toHaveBeenCalled();
  });

  it('clears existing default when creating with isDefault: true', async () => {
    const newSheet = makeStylesheet({ id: 3, name: 'custom', isDefault: true });
    prismaMock.stylesheet.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.stylesheet.create.mockResolvedValue(newSheet as never);

    const res = await request(app).post('/api/stylesheet').send({
      name: 'custom',
      cssUrl: DELIVERY_URL,
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

  // ─── the #375 write-path partition guard ───────────────────────────────────

  it('rejects a cssUrl pointing into the retired ui static tree', async () => {
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: '/stylesheets/custom/style.css' });

    expect(res.status).toBe(400);
    expect(res.body.errors.cssUrl).toBeDefined();
    expect(prismaMock.stylesheet.create).not.toHaveBeenCalled();
  });

  it('rejects a cssUrl that merely contains the delivery route', async () => {
    const res = await request(app).post('/api/stylesheet').send({
      name: 'custom',
      cssUrl: 'https://evil.example/api/stylesheet/author-stylesheet/7/css'
    });

    expect(res.status).toBe(400);
    expect(prismaMock.stylesheet.create).not.toHaveBeenCalled();
  });

  // Shape is not resolution: a well-formed target naming a sheet that does not
  // exist is the same dead picker entry, so the module checks the DB too.
  it('rejects a well-formed target whose authored stylesheet does not exist', async () => {
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: DELIVERY_URL });

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/does not exist/);
    expect(prismaMock.stylesheet.create).not.toHaveBeenCalled();
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: DELIVERY_URL });
    expect(res.status).toBe(403);
  });

  it('returns 403 for staff (strict admin only)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
    const res = await request(app)
      .post('/api/stylesheet')
      .send({ name: 'custom', cssUrl: DELIVERY_URL });
    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/stylesheet/:id ──────────────────────────────────────────────────

describe('PUT /api/stylesheet/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    mockDeliveryTargetExists();
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

  // ─── the #375 write-path partition guard ───────────────────────────────────

  it('rejects an update moving a row outside the partition', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );

    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ cssUrl: '/stylesheets/custom/style.css' });

    expect(res.status).toBe(400);
    expect(res.body.errors.cssUrl).toBeDefined();
    expect(prismaMock.stylesheet.update).not.toHaveBeenCalled();
  });

  it('rejects an update to a target that does not resolve', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet() as never
    );
    prismaMock.authorStylesheet.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ cssUrl: DELIVERY_URL });

    expect(res.status).toBe(400);
    expect(prismaMock.stylesheet.update).not.toHaveBeenCalled();
  });

  // Explicit null clears a target; omitting the key leaves it unchanged. The
  // schema has to keep those distinguishable, hence nullable AND optional.
  it('accepts an explicit null cssUrl, clearing the delivery target', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet({ cssUrl: DELIVERY_URL }) as never
    );
    prismaMock.stylesheet.update.mockResolvedValue(
      makeStylesheet({ cssUrl: null }) as never
    );

    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ cssUrl: null });

    expect(res.status).toBe(200);
    expect(prismaMock.stylesheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cssUrl: null })
      })
    );
  });

  it('leaves an existing target alone when cssUrl is omitted', async () => {
    prismaMock.stylesheet.findUnique.mockResolvedValue(
      makeStylesheet({ cssUrl: DELIVERY_URL }) as never
    );
    prismaMock.stylesheet.update.mockResolvedValue(
      makeStylesheet({ cssUrl: DELIVERY_URL }) as never
    );

    const res = await request(app)
      .put('/api/stylesheet/1')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
    // "Leave unchanged" is not a target to validate.
    expect(prismaMock.authorStylesheet.findUnique).not.toHaveBeenCalled();
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

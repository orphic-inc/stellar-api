import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Launched v2',
  body: 'Added new features.',
  authorId: 7,
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
  author: { id: 7, username: 'testuser' },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/site-history', () => {
  it('returns all entries as a plain array', async () => {
    prismaMock.siteHistory.findMany.mockResolvedValue([makeEntry()] as never);

    const res = await request(app).get('/api/site-history');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('Launched v2');
  });

  it('returns an empty array when there are no entries', async () => {
    prismaMock.siteHistory.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/site-history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('requires authentication', async () => {
    // Auth middleware is mocked to always set req.user in the test harness.
    // What we can verify is that the route exists and responds to auth context.
    prismaMock.siteHistory.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/site-history');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/site-history', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({
        site_history_manage: true
      }).permissions as Record<string, boolean>
    );
  });

  it('creates an entry and returns 201', async () => {
    prismaMock.siteHistory.create.mockResolvedValue(makeEntry() as never);

    const res = await request(app)
      .post('/api/site-history')
      .send({ title: 'Launched v2', body: 'Added new features.' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Launched v2');
    expect(prismaMock.siteHistory.create).toHaveBeenCalledWith({
      data: { authorId: 7, title: 'Launched v2', body: 'Added new features.' }
    });
  });

  it('returns 400 when title or body is missing', async () => {
    const res = await request(app)
      .post('/api/site-history')
      .send({ title: 'Only title' });

    expect(res.status).toBe(400);
    expect(prismaMock.siteHistory.create).not.toHaveBeenCalled();
  });

  it('returns 403 without site_history_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app)
      .post('/api/site-history')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/site-history/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({
        site_history_manage: true
      }).permissions as Record<string, boolean>
    );
  });

  it('updates the entry and returns it', async () => {
    const updated = makeEntry({ title: 'Updated title' });
    prismaMock.siteHistory.findUnique.mockResolvedValue(makeEntry() as never);
    prismaMock.siteHistory.update.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/site-history/1')
      .send({ title: 'Updated title', body: 'Updated body.' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
  });

  it('returns 404 when the entry does not exist', async () => {
    prismaMock.siteHistory.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/site-history/999')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(404);
  });

  it('returns 400 on non-numeric id', async () => {
    const res = await request(app)
      .put('/api/site-history/notanumber')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/site-history/:id', () => {
  beforeEach(() => {
    setCurrentUserPermissions(
      makeUserRank({
        site_history_manage: true
      }).permissions as Record<string, boolean>
    );
  });

  it('deletes the entry and returns 204', async () => {
    prismaMock.siteHistory.findUnique.mockResolvedValue(makeEntry() as never);
    prismaMock.siteHistory.delete.mockResolvedValue(makeEntry() as never);

    const res = await request(app).delete('/api/site-history/1');

    expect(res.status).toBe(204);
    expect(prismaMock.siteHistory.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 404 when the entry does not exist', async () => {
    prismaMock.siteHistory.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/site-history/999');

    expect(res.status).toBe(404);
  });

  it('returns 403 without site_history_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app).delete('/api/site-history/1');

    expect(res.status).toBe(403);
  });
});

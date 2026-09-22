/**
 * Route coverage for contribution notification filters (#263, ADR-0049): the
 * rank allowance, filter validation, ownership, and the hit writes' scoping.
 * Matching itself runs against a real database in
 * `integration/notificationFilters.integration.ts`.
 */
import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  setCurrentUserPermissions
} from './test/apiTestHarness';

const allowance = (limit: number | null) =>
  prismaMock.userRank.findUnique.mockResolvedValue({
    notificationFilterLimit: limit
  } as never);

const body = (over: Record<string, unknown> = {}) => ({
  label: 'Shoegaze',
  tags: ['shoegaze'],
  ...over
});

beforeEach(() => {
  resetApiTestState();
  setCurrentUserPermissions({});
  prismaMock.tagAlias.findMany.mockResolvedValue([]);
});

describe('the rank allowance is the only gate', () => {
  // Every route answers 403 when the rank's limit is 0 — not only create.
  it.each([
    ['get', '/api/notification-filters'],
    ['post', '/api/notification-filters'],
    ['put', '/api/notification-filters/1'],
    ['delete', '/api/notification-filters/1'],
    ['get', '/api/notification-filters/hits'],
    ['get', '/api/notification-filters/hits/unread-count'],
    ['post', '/api/notification-filters/hits/read'],
    ['post', '/api/notification-filters/hits/catchup'],
    ['delete', '/api/notification-filters/hits'],
    ['delete', '/api/notification-filters/hits/5']
  ] as const)('%s %s is 403 at a limit of 0', async (method, path) => {
    allowance(0);
    const req = request(app)[method](path);
    const res = await (method === 'post' || method === 'put'
      ? req.send({ ...body(), contributionId: 5 })
      : req);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      msg: 'Your rank cannot use notification filters'
    });
  });

  it('fails closed when the rank row is missing', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/notification-filters');
    expect(res.status).toBe(403);
  });

  it('reports an unlimited rank as null, not 0', async () => {
    allowance(null);
    prismaMock.notificationFilter.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/notification-filters');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ filters: [], limit: null });
  });
});

describe('POST /api/notification-filters', () => {
  beforeEach(() => {
    prismaMock.notificationFilter.create.mockImplementation((async (args: {
      data: object;
    }) => ({ id: 1, ...args.data })) as never);
  });

  it('refuses at the cap', async () => {
    allowance(2);
    prismaMock.notificationFilter.count.mockResolvedValue(2);
    const res = await request(app)
      .post('/api/notification-filters')
      .send(body());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      msg: 'Notification filter limit reached (2).'
    });
    expect(prismaMock.notificationFilter.create).not.toHaveBeenCalled();
  });

  it('does not count against an unlimited rank', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send(body());
    expect(res.status).toBe(201);
    expect(prismaMock.notificationFilter.count).not.toHaveBeenCalled();
  });

  it('stores tags normalized and alias-resolved (#689)', async () => {
    allowance(null);
    prismaMock.tagAlias.findMany.mockResolvedValue([
      { badTag: 'shoe.gaze', goodTag: { name: 'shoegaze' } }
    ] as never);
    await request(app)
      .post('/api/notification-filters')
      .send(body({ tags: ['Shoe Gaze', 'Dream Pop'], notTags: ['Nu-Gaze'] }));
    expect(prismaMock.notificationFilter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          tags: ['shoegaze', 'dream.pop'],
          notTags: ['nu.gaze']
        })
      })
    );
  });

  it('refuses a filter that sets nothing', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send({ label: 'Everything' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'A filter needs at least one criterion' });
  });

  it('refuses a filter whose only tags normalize away', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send({ label: 'Junk', tags: ['&&&'] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'A filter needs at least one criterion' });
  });

  it('accepts a flag alone: "every new release" is deliberate', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send({ label: 'All new', newReleasesOnly: true });
    expect(res.status).toBe(201);
  });

  it('refuses an artist that does not exist or is withdrawn', async () => {
    allowance(null);
    prismaMock.artist.count.mockResolvedValue(1);
    const res = await request(app)
      .post('/api/notification-filters')
      .send(body({ artistIds: [4, 5] }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      msg: 'An artist in this filter does not exist'
    });
    expect(prismaMock.artist.count).toHaveBeenCalledWith({
      where: { id: { in: [4, 5] }, deletedAt: null }
    });
  });

  it('refuses fromYear after toYear at the validator', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send(body({ fromYear: 2000, toYear: 1990 }));
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('fromYear');
  });

  it('caps each list at 100 entries', async () => {
    allowance(null);
    const res = await request(app)
      .post('/api/notification-filters')
      .send(
        body({ communityIds: Array.from({ length: 101 }, (_, i) => i + 1) })
      );
    expect(res.status).toBe(400);
  });
});

describe('a filter belongs to its owner', () => {
  beforeEach(() => allowance(null));

  it('PUT answers 404 for a stranger’s filter', async () => {
    prismaMock.notificationFilter.count.mockResolvedValue(0);
    const res = await request(app)
      .put('/api/notification-filters/9')
      .send(body());
    expect(res.status).toBe(404);
    expect(prismaMock.notificationFilter.count).toHaveBeenCalledWith({
      where: { id: 9, userId: 7 }
    });
    expect(prismaMock.notificationFilter.updateMany).not.toHaveBeenCalled();
  });

  it('DELETE is keyed on the owner, so a stranger’s id is a 404', async () => {
    prismaMock.notificationFilter.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete('/api/notification-filters/9');
    expect(res.status).toBe(404);
    expect(prismaMock.notificationFilter.deleteMany).toHaveBeenCalledWith({
      where: { id: 9, userId: 7 }
    });
  });

  it('a hits read scoped to a stranger’s filter is a 404', async () => {
    prismaMock.notificationFilter.count.mockResolvedValue(0);
    const res = await request(app).get(
      '/api/notification-filters/hits?filterId=9'
    );
    expect(res.status).toBe(404);
  });
});

describe('hit writes', () => {
  beforeEach(() => allowance(null));

  it('marks every filter’s hit on a contribution read', async () => {
    prismaMock.notificationFilterHit.count.mockResolvedValue(3);
    const res = await request(app)
      .post('/api/notification-filters/hits/read')
      .send({ contributionId: 5 });
    expect(res.status).toBe(204);
    expect(prismaMock.notificationFilterHit.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, contributionId: 5, readAt: null },
      data: { readAt: expect.any(Date) }
    });
  });

  it('narrows a read to one filter', async () => {
    prismaMock.notificationFilterHit.count.mockResolvedValue(1);
    await request(app)
      .post('/api/notification-filters/hits/read')
      .send({ contributionId: 5, filterId: 2 });
    expect(prismaMock.notificationFilterHit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, filterId: 2, contributionId: 5, readAt: null }
      })
    );
  });

  it('answers 404 when the member has no hit on it', async () => {
    prismaMock.notificationFilterHit.count.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/notification-filters/hits/read')
      .send({ contributionId: 5 });
    expect(res.status).toBe(404);
  });

  it('the bulk clear removes READ hits only', async () => {
    const res = await request(app).delete('/api/notification-filters/hits');
    expect(res.status).toBe(204);
    expect(prismaMock.notificationFilterHit.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, readAt: { not: null } }
    });
  });

  it('the single delete removes a contribution’s hits whatever their state', async () => {
    prismaMock.notificationFilterHit.deleteMany.mockResolvedValue({
      count: 2
    });
    const res = await request(app).delete('/api/notification-filters/hits/5');
    expect(res.status).toBe(204);
    expect(prismaMock.notificationFilterHit.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, contributionId: 5 }
    });
  });

  it('a per-filter catch-up marks only that filter’s rows', async () => {
    prismaMock.notificationFilter.count.mockResolvedValue(1);
    await request(app)
      .post('/api/notification-filters/hits/catchup')
      .send({ filterId: 2 });
    expect(prismaMock.notificationFilterHit.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, filterId: 2, readAt: null },
      data: { readAt: expect.any(Date) }
    });
  });
});

describe('GET /api/users/:id/notification-filters', () => {
  it('lets users_edit read a member’s filters', async () => {
    setCurrentUserPermissions({ users_edit: true });
    prismaMock.notificationFilter.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/users/12/notification-filters');
    expect(res.status).toBe(200);
    expect(prismaMock.notificationFilter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 12 } })
    );
  });

  it('refuses anyone without users_edit', async () => {
    setCurrentUserPermissions({ users_edit: false });
    const res = await request(app).get('/api/users/12/notification-filters');
    expect(res.status).toBe(403);
  });
});

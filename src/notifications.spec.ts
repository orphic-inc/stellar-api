import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

const makeNotif = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  type: 'forum_sub',
  actorId: 10,
  page: 'forums',
  pageId: 5,
  postId: 3,
  readAt: null,
  createdAt: new Date('2026-01-01'),
  actor: { id: 10, username: 'alice', avatar: null },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/notifications/unread-count', () => {
  it('returns unread notification count', async () => {
    prismaMock.notification.count.mockResolvedValue(4);

    const res = await request(app).get('/api/notifications/unread-count');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('marks all unread notifications as read and returns 204', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(app).post('/api/notifications/read-all');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, readAt: null }
      })
    );
  });
});

describe('GET /api/notifications', () => {
  it('returns enriched notifications list', async () => {
    prismaMock.notification.findMany.mockResolvedValue([makeNotif()] as never);
    prismaMock.forumTopic.findMany.mockResolvedValue([
      { id: 5, forumId: 1, title: 'Jazz Talk' }
    ] as never);

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].source.title).toBe('Jazz Talk');
  });

  it('enriches artist, collage, request, and community notifications and deduplicates lookups', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      makeNotif({ id: 1, page: 'artist', pageId: 9 }),
      makeNotif({ id: 2, page: 'collages', pageId: 11 }),
      makeNotif({ id: 3, page: 'requests', pageId: 13 }),
      makeNotif({ id: 4, page: 'communities', pageId: 15 }),
      makeNotif({ id: 5, page: 'artist', pageId: 9 })
    ] as never);
    prismaMock.artist.findMany.mockResolvedValue([
      { id: 9, name: 'Herbie Hancock' }
    ] as never);
    prismaMock.collage.findMany.mockResolvedValue([
      { id: 11, name: 'Fusion Essentials' }
    ] as never);
    prismaMock.request.findMany.mockResolvedValue([
      { id: 13, title: 'Head Hunters vinyl rip' }
    ] as never);
    prismaMock.community.findMany.mockResolvedValue([
      { id: 15, name: 'Jazz Vault' }
    ] as never);

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(prismaMock.artist.findMany).toHaveBeenCalledWith({
      where: { id: { in: [9] } },
      select: { id: true, name: true }
    });
    expect(prismaMock.collage.findMany).toHaveBeenCalledWith({
      where: { id: { in: [11] } },
      select: { id: true, name: true }
    });
    expect(prismaMock.request.findMany).toHaveBeenCalledWith({
      where: { id: { in: [13] } },
      select: { id: true, title: true }
    });
    expect(prismaMock.community.findMany).toHaveBeenCalledWith({
      where: { id: { in: [15] } },
      select: { id: true, name: true }
    });
    expect(
      res.body.map(
        (item: { source: { title: string } | null }) => item.source?.title
      )
    ).toEqual([
      'Herbie Hancock',
      'Fusion Essentials',
      'Head Hunters vinyl rip',
      'Jazz Vault',
      'Herbie Hancock'
    ]);
  });

  it('returns null source when related entities can no longer be found', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      makeNotif({ page: 'requests', pageId: 77 })
    ] as never);
    prismaMock.request.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body[0].source).toBeNull();
  });

  it('returns empty array when no notifications', async () => {
    prismaMock.notification.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('marks notification as read and returns 204', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(makeNotif() as never);
    prismaMock.notification.update.mockResolvedValue(
      makeNotif({ readAt: new Date() }) as never
    );

    const res = await request(app).post('/api/notifications/1/read');

    expect(res.status).toBe(204);
  });

  it('returns 404 when notification does not exist', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/notifications/999/read');

    expect(res.status).toBe(404);
  });

  it('returns 403 when notification belongs to another user', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotif({ userId: 99 }) as never
    );

    const res = await request(app).post('/api/notifications/1/read');

    expect(res.status).toBe(403);
  });

  it('skips update when notification is already read', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotif({ readAt: new Date() }) as never
    );

    const res = await request(app).post('/api/notifications/1/read');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid notification id', async () => {
    const res = await request(app).post('/api/notifications/nope/read');

    expect(res.status).toBe(400);
    expect(prismaMock.notification.findUnique).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/notifications/:id', () => {
  it('deletes notification and returns 204', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(makeNotif() as never);
    prismaMock.notification.delete.mockResolvedValue(makeNotif() as never);

    const res = await request(app).delete('/api/notifications/1');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 404 when notification does not exist', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/notifications/999');

    expect(res.status).toBe(404);
  });

  it('returns 403 when notification belongs to another user', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotif({ userId: 99 }) as never
    );

    const res = await request(app).delete('/api/notifications/1');

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid notification id', async () => {
    const res = await request(app).delete('/api/notifications/not-a-number');

    expect(res.status).toBe(400);
    expect(prismaMock.notification.findUnique).not.toHaveBeenCalled();
  });
});

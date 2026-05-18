import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

const makeNotif = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  quoterId: 10,
  page: 'forums',
  pageId: 5,
  postId: 3,
  readAt: null,
  createdAt: new Date('2026-01-01'),
  quoter: { id: 10, username: 'alice', avatar: null },
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

  it('returns empty array when no notifications', async () => {
    prismaMock.notification.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('marks notification as read and returns 204', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotif() as never
    );
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
});

describe('DELETE /api/notifications/:id', () => {
  it('deletes notification and returns 204', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotif() as never
    );
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
});

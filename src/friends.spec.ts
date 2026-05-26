import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { Prisma } from '@prisma/client';

beforeEach(() => resetApiTestState());

// ─── GET /api/friends ─────────────────────────────────────────────────────────

describe('GET /api/friends', () => {
  it('returns paginated empty list when user has no friends', async () => {
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);

    const res = await request(app).get('/api/friends');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('returns paginated friend list ordered by username', async () => {
    const mockFriend = {
      id: 1,
      userId: 7,
      friendId: 42,
      comment: 'Good person',
      friend: { id: 42, username: 'alice', avatar: null }
    };
    prismaMock.friend.findMany.mockResolvedValue([mockFriend] as never);
    prismaMock.friend.count.mockResolvedValue(1);

    const res = await request(app).get('/api/friends');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].friend.username).toBe('alice');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta).toHaveProperty('totalPages');
  });
});

// ─── GET /api/friends/status/:userId ─────────────────────────────────────────

describe('GET /api/friends/status/:userId', () => {
  it('returns isFriend: false when not friends', async () => {
    prismaMock.friend.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/friends/status/42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFriend: false });
  });

  it('returns isFriend: true when friendship exists', async () => {
    prismaMock.friend.findUnique.mockResolvedValue({
      id: 1,
      userId: 7,
      friendId: 42,
      comment: ''
    } as never);

    const res = await request(app).get('/api/friends/status/42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFriend: true });
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app).get('/api/friends/status/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/friends/:userId ────────────────────────────────────────────────

describe('POST /api/friends/:userId', () => {
  it('adds a friend and returns 201', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42,
      disabled: false
    } as never);
    prismaMock.friend.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/friends/42');

    expect(res.status).toBe(201);
    expect(prismaMock.friend.create).toHaveBeenCalledWith({
      data: { userId: 7, friendId: 42 }
    });
  });

  it('returns 400 when adding self (actor id = 7)', async () => {
    const res = await request(app).post('/api/friends/7');
    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/yourself/i);
  });

  it('returns 404 when target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/friends/999');

    expect(res.status).toBe(404);
  });

  it('returns 404 when target user is disabled', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 999,
      disabled: true
    } as never);

    const res = await request(app).post('/api/friends/999');

    expect(res.status).toBe(404);
  });

  it('returns 409 on duplicate friendship (P2002)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42,
      disabled: false
    } as never);
    prismaMock.friend.create.mockRejectedValue(
      Object.assign(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0'
        }),
        {}
      )
    );

    const res = await request(app).post('/api/friends/42');

    expect(res.status).toBe(409);
  });

  it('returns 404 on FK violation (P2003 — user deleted between check and create)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42,
      disabled: false
    } as never);
    prismaMock.friend.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        {
          code: 'P2003',
          clientVersion: '5.0.0'
        }
      )
    );

    const res = await request(app).post('/api/friends/42');

    expect(res.status).toBe(404);
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app).post('/api/friends/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/friends/:userId ──────────────────────────────────────────────

describe('DELETE /api/friends/:userId', () => {
  it('removes friendship and returns 204', async () => {
    prismaMock.friend.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/friends/42');

    expect(res.status).toBe(204);
    expect(prismaMock.friend.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, friendId: 42 }
    });
  });

  it('returns 204 even when friendship does not exist (graceful)', async () => {
    prismaMock.friend.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app).delete('/api/friends/999');

    expect(res.status).toBe(204);
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app).delete('/api/friends/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── PUT /api/friends/:userId/comment ────────────────────────────────────────

describe('PUT /api/friends/:userId/comment', () => {
  it('updates the comment and returns 200', async () => {
    prismaMock.friend.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .put('/api/friends/42/comment')
      .send({ comment: 'Great contributor' });

    expect(res.status).toBe(200);
    expect(prismaMock.friend.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, friendId: 42 },
      data: { comment: 'Great contributor' }
    });
  });

  it('returns 404 when friendship does not exist', async () => {
    prismaMock.friend.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .put('/api/friends/999/comment')
      .send({ comment: 'Hello' });

    expect(res.status).toBe(404);
  });

  it('rejects comment longer than 500 chars with 400', async () => {
    const res = await request(app)
      .put('/api/friends/42/comment')
      .send({ comment: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('accepts empty string as comment', async () => {
    prismaMock.friend.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .put('/api/friends/42/comment')
      .send({ comment: '' });

    expect(res.status).toBe(200);
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app)
      .put('/api/friends/notanumber/comment')
      .send({ comment: 'Hi' });
    expect(res.status).toBe(400);
  });
});

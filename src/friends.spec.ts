import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { Prisma } from '@prisma/client';

beforeEach(() => resetApiTestState());

// Actor is user id 7 (set by the test harness auth stub).
const ME = 7;
const OTHER = 42;
const summary = { id: OTHER, username: 'alice', avatar: null };

// ─── GET /api/friends — accepted friends ──────────────────────────────────────

describe('GET /api/friends', () => {
  it('returns paginated empty list when user has no friends', async () => {
    prismaMock.friendRelationship.findMany.mockResolvedValue([]);
    prismaMock.friendRelationship.count.mockResolvedValue(0);

    const res = await request(app).get('/api/friends');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('maps the friend to the other party when the actor is the requester', async () => {
    prismaMock.friendRelationship.findMany.mockResolvedValue([
      {
        id: 1,
        requesterId: ME,
        recipientId: OTHER,
        status: 'accepted',
        comment: 'Good person',
        createdAt: new Date(),
        requester: { id: ME, username: 'me', avatar: null },
        recipient: summary
      }
    ] as never);
    prismaMock.friendRelationship.count.mockResolvedValue(1);

    const res = await request(app).get('/api/friends');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].friendId).toBe(OTHER);
    expect(res.body.data[0].friend.username).toBe('alice');
    expect(res.body.data[0].status).toBe('accepted');
    expect(res.body.meta).toHaveProperty('totalPages');
  });

  it('maps the friend to the other party when the actor is the recipient', async () => {
    prismaMock.friendRelationship.findMany.mockResolvedValue([
      {
        id: 2,
        requesterId: OTHER,
        recipientId: ME,
        status: 'accepted',
        comment: '',
        createdAt: new Date(),
        requester: summary,
        recipient: { id: ME, username: 'me', avatar: null }
      }
    ] as never);
    prismaMock.friendRelationship.count.mockResolvedValue(1);

    const res = await request(app).get('/api/friends');

    expect(res.status).toBe(200);
    expect(res.body.data[0].friendId).toBe(OTHER);
    expect(res.body.data[0].friend.username).toBe('alice');
  });
});

// ─── GET /api/friends/requests — incoming pending ─────────────────────────────

describe('GET /api/friends/requests', () => {
  it('returns incoming pending requests', async () => {
    prismaMock.friendRelationship.findMany.mockResolvedValue([
      {
        id: 9,
        requesterId: OTHER,
        recipientId: ME,
        createdAt: new Date(),
        requester: summary
      }
    ] as never);
    prismaMock.friendRelationship.count.mockResolvedValue(1);

    const res = await request(app).get('/api/friends/requests');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].requesterId).toBe(OTHER);
    expect(res.body.data[0].requester.username).toBe('alice');
  });
});

// ─── GET /api/friends/status/:userId ─────────────────────────────────────────

describe('GET /api/friends/status/:userId', () => {
  it('returns none when there is no relationship', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`/api/friends/status/${OTHER}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'none', isFriend: false });
  });

  it('returns pending_sent when the actor sent the request', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 1,
      requesterId: ME,
      recipientId: OTHER,
      status: 'pending'
    } as never);

    const res = await request(app).get(`/api/friends/status/${OTHER}`);

    expect(res.body).toEqual({ status: 'pending_sent', isFriend: false });
  });

  it('returns pending_received when the other user sent the request', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 1,
      requesterId: OTHER,
      recipientId: ME,
      status: 'pending'
    } as never);

    const res = await request(app).get(`/api/friends/status/${OTHER}`);

    expect(res.body).toEqual({ status: 'pending_received', isFriend: false });
  });

  it('returns accepted/isFriend true when friends', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 1,
      requesterId: ME,
      recipientId: OTHER,
      status: 'accepted'
    } as never);

    const res = await request(app).get(`/api/friends/status/${OTHER}`);

    expect(res.body).toEqual({ status: 'accepted', isFriend: true });
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app).get('/api/friends/status/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/friends/:userId — send request ─────────────────────────────────

describe('POST /api/friends/:userId', () => {
  it('sends a pending request and returns 201', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OTHER,
      disabled: false
    } as never);
    prismaMock.friendRelationship.findFirst.mockResolvedValue(null);
    prismaMock.friendRelationship.create.mockResolvedValue({
      id: 5,
      requesterId: ME,
      recipientId: OTHER,
      status: 'pending',
      createdAt: new Date(),
      recipient: summary
    } as never);

    const res = await request(app).post(`/api/friends/${OTHER}`);

    expect(res.status).toBe(201);
    expect(prismaMock.friendRelationship.create).toHaveBeenCalledWith({
      data: { requesterId: ME, recipientId: OTHER },
      include: {
        recipient: { select: { id: true, username: true, avatar: true } }
      }
    });
    expect(res.body).toMatchObject({
      id: 5,
      status: 'pending',
      recipient: { username: 'alice' }
    });
  });

  it('accepts a reciprocal pending request instead of duplicating (200)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OTHER,
      disabled: false
    } as never);
    // a pending request from OTHER → ME already exists
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 8,
      requesterId: OTHER,
      recipientId: ME,
      status: 'pending'
    } as never);
    prismaMock.friendRelationship.update.mockResolvedValue({
      id: 8,
      requesterId: OTHER,
      recipientId: ME,
      status: 'accepted',
      comment: '',
      requester: summary,
      recipient: { id: ME, username: 'me', avatar: null }
    } as never);

    const res = await request(app).post(`/api/friends/${OTHER}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', friendId: OTHER });
    expect(prismaMock.friendRelationship.create).not.toHaveBeenCalled();
  });

  it('returns 400 when adding self (actor id = 7)', async () => {
    const res = await request(app).post(`/api/friends/${ME}`);
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

  it('returns 409 when already friends', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OTHER,
      disabled: false
    } as never);
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 1,
      requesterId: ME,
      recipientId: OTHER,
      status: 'accepted'
    } as never);

    const res = await request(app).post(`/api/friends/${OTHER}`);

    expect(res.status).toBe(409);
  });

  it('returns 409 when a request is already pending from the actor', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OTHER,
      disabled: false
    } as never);
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 1,
      requesterId: ME,
      recipientId: OTHER,
      status: 'pending'
    } as never);

    const res = await request(app).post(`/api/friends/${OTHER}`);

    expect(res.status).toBe(409);
  });

  it('returns 409 on a duplicate-create race (P2002)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: OTHER,
      disabled: false
    } as never);
    prismaMock.friendRelationship.findFirst.mockResolvedValue(null);
    prismaMock.friendRelationship.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0'
      })
    );

    const res = await request(app).post(`/api/friends/${OTHER}`);

    expect(res.status).toBe(409);
  });

  it('rejects non-numeric userId with 400', async () => {
    const res = await request(app).post('/api/friends/notanumber');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/friends/:userId/accept ─────────────────────────────────────────

describe('POST /api/friends/:userId/accept', () => {
  it('accepts a pending request and returns the friendship', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue({
      id: 8,
      requesterId: OTHER,
      recipientId: ME,
      status: 'pending'
    } as never);
    prismaMock.friendRelationship.update.mockResolvedValue({
      id: 8,
      requesterId: OTHER,
      recipientId: ME,
      status: 'accepted',
      comment: '',
      requester: summary
    } as never);

    const res = await request(app).post(`/api/friends/${OTHER}/accept`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'accepted',
      friendId: OTHER,
      friend: { username: 'alice' }
    });
  });

  it('returns 404 when there is no pending request from the user', async () => {
    prismaMock.friendRelationship.findFirst.mockResolvedValue(null);

    const res = await request(app).post(`/api/friends/${OTHER}/accept`);

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/friends/:userId/reject ─────────────────────────────────────────

describe('POST /api/friends/:userId/reject', () => {
  it('rejects a pending request and returns a message', async () => {
    prismaMock.friendRelationship.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post(`/api/friends/${OTHER}/reject`);

    expect(res.status).toBe(200);
    expect(res.body.msg).toMatch(/rejected/i);
  });

  it('returns 404 when there is no pending request', async () => {
    prismaMock.friendRelationship.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post(`/api/friends/${OTHER}/reject`);

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/friends/:userId ──────────────────────────────────────────────

describe('DELETE /api/friends/:userId', () => {
  it('removes the relationship in either direction and returns 204', async () => {
    prismaMock.friendRelationship.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete(`/api/friends/${OTHER}`);

    expect(res.status).toBe(204);
    expect(prismaMock.friendRelationship.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { requesterId: ME, recipientId: OTHER },
          { requesterId: OTHER, recipientId: ME }
        ]
      }
    });
  });

  it('returns 204 even when nothing exists (graceful)', async () => {
    prismaMock.friendRelationship.deleteMany.mockResolvedValue({ count: 0 });

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
  it('updates the comment on an accepted friendship and returns 200', async () => {
    prismaMock.friendRelationship.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .put(`/api/friends/${OTHER}/comment`)
      .send({ comment: 'Great contributor' });

    expect(res.status).toBe(200);
    expect(res.body.msg).toMatch(/updated/i);
    expect(prismaMock.friendRelationship.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: ME, recipientId: OTHER },
          { requesterId: OTHER, recipientId: ME }
        ]
      },
      data: { comment: 'Great contributor' }
    });
  });

  it('returns 404 when no accepted friendship exists', async () => {
    prismaMock.friendRelationship.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .put('/api/friends/999/comment')
      .send({ comment: 'Hello' });

    expect(res.status).toBe(404);
  });

  it('rejects comment longer than 500 chars with 400', async () => {
    const res = await request(app)
      .put(`/api/friends/${OTHER}/comment`)
      .send({ comment: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('accepts empty string as comment', async () => {
    prismaMock.friendRelationship.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .put(`/api/friends/${OTHER}/comment`)
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

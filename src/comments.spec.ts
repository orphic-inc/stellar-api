import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import { makeComment, makeCommentWithAuthor } from './test/factories';

jest.mock('./modules/comment', () => ({
  deleteComment: jest.fn()
}));

import * as commentModule from './modules/comment';
const deleteCommentMock = (commentModule as jest.Mocked<typeof commentModule>)
  .deleteComment;

beforeEach(() => resetApiTestState());

// ─── GET /api/comments ────────────────────────────────────────────────────────

describe('GET /api/comments', () => {
  it('returns a paginated list of comments with no filters', async () => {
    prismaMock.comment.findMany.mockResolvedValue([
      makeCommentWithAuthor({ id: 12 })
    ] as never);
    prismaMock.comment.count.mockResolvedValue(1);

    const res = await request(app).get('/api/comments');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('filters by communities page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?page=communities&pageId=5');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'communities', communityId: 5 });
  });

  it('filters by artist page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?page=artist&pageId=3');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'artist', artistId: 3 });
  });

  it('filters by collages page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?page=collages&pageId=2');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'collages', collageId: 2 });
  });

  it('filters by requests page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?page=requests&pageId=1');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'requests', contributionId: 1 });
  });

  it('filters by release page and pageId', async () => {
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.comment.count.mockResolvedValue(0);

    await request(app).get('/api/comments?page=release&pageId=7');

    const call = prismaMock.comment.findMany.mock.calls[0][0];
    expect(call?.where).toMatchObject({ page: 'release', releaseId: 7 });
  });
});

// ─── GET /api/comments/:id ────────────────────────────────────────────────────

describe('GET /api/comments/:id', () => {
  it('returns the comment when found', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeCommentWithAuthor({ id: 12 }) as never
    );

    const res = await request(app).get('/api/comments/12');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(12);
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/comments/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });
});

// ─── POST /api/comments ───────────────────────────────────────────────────────

describe('POST /api/comments', () => {
  it('creates a comment and returns 201', async () => {
    prismaMock.comment.create.mockResolvedValue(
      makeCommentWithAuthor({ id: 20, communityId: 5 }) as never
    );

    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'Great community!',
      communityId: 5
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          page: 'communities',
          authorId: 7,
          communityId: 5
        })
      })
    );
  });
});

// ─── PUT /api/comments/:id ────────────────────────────────────────────────────

describe('PUT /api/comments/:id', () => {
  it('updates a comment authored by the current user', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    prismaMock.comment.update.mockResolvedValue(
      makeComment({ id: 12, body: 'Updated body' }) as never
    );

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Updated body' });

    expect(res.status).toBe(200);
    expect(prismaMock.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({ body: 'Updated body', editedUserId: 7 })
      })
    );
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/comments/99')
      .send({ body: 'Update' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });

  it('returns 403 when the user does not own the comment', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );

    const res = await request(app)
      .put('/api/comments/12')
      .send({ body: 'Tamper' });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });
});

// ─── DELETE /api/comments/:id ─────────────────────────────────────────────────

describe('DELETE /api/comments/:id', () => {
  it('deletes a comment owned by the current user', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 }) as never
    );
    deleteCommentMock.mockResolvedValue([] as never);

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(deleteCommentMock).toHaveBeenCalledWith(12, 7, false);
  });

  it("allows a moderator to delete another user's comment", async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_moderate: true })
    );
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );
    deleteCommentMock.mockResolvedValue([] as never);

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(deleteCommentMock).toHaveBeenCalledWith(12, 7, true);
  });

  it('returns 403 for non-owner without moderator permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 }) as never
    );

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });

  it('returns 404 when the comment does not exist', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/comments/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Comment not found');
  });
});

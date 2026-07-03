import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { makeAuthorRefRow } from './test/factories';

const makePost = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  title: 'Jazz History',
  text: 'A deep dive into jazz origins.',
  category: 'Music',
  tags: ['jazz', 'history'],
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  user: makeAuthorRefRow(),
  comments: [],
  ...overrides
});

const makePostComment = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  postId: 1,
  userId: 7,
  text: 'Great post!',
  createdAt: new Date('2026-01-01'),
  user: makeAuthorRefRow(),
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/posts', () => {
  it('returns list of blog posts', async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost()] as never);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('Jazz History');
  });

  it('returns empty array when no posts', async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // #231 — post and comment authors carry the donor sign + warning sign.
  it('returns post and comment authors as AuthorRef with the signs', async () => {
    prismaMock.post.findMany.mockResolvedValue([
      makePost({
        user: makeAuthorRefRow({
          isDonor: true,
          donorRank: {
            expiresAt: null,
            donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' }
          }
        }),
        comments: [
          makePostComment({
            user: makeAuthorRefRow({
              id: 9,
              username: 'warneduser',
              warned: new Date('2026-06-01T00:00:00.000Z')
            })
          })
        ]
      })
    ] as never);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(200);
    expect(res.body[0].user).toEqual(
      expect.objectContaining({
        isDonor: true,
        donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' },
        warned: null
      })
    );
    expect(res.body[0].comments[0].user).toEqual(
      expect.objectContaining({
        id: 9,
        isDonor: false,
        donorRank: null,
        warned: '2026-06-01T00:00:00.000Z'
      })
    );
  });
});

describe('GET /api/posts/:id', () => {
  it('returns a single post with comments', async () => {
    prismaMock.post.findUnique.mockResolvedValue(makePost() as never);

    const res = await request(app).get('/api/posts/1');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Jazz History');
  });

  it('returns 404 when post does not exist', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/posts/999');

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app).get('/api/posts/abc');

    expect(res.status).toBe(400);
  });
});

describe('POST /api/posts', () => {
  it('creates a post and returns 201', async () => {
    prismaMock.post.create.mockResolvedValue(makePost() as never);

    const res = await request(app)
      .post('/api/posts')
      .send({ title: 'Jazz History', text: 'A deep dive.', category: 'Music' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Jazz History');
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 7 })
      })
    );
  });

  it('defaults tags to an empty array when omitted', async () => {
    prismaMock.post.create.mockResolvedValue(makePost({ tags: [] }) as never);

    const res = await request(app)
      .post('/api/posts')
      .send({ title: 'Jazz History', text: 'A deep dive.', category: 'Music' });

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tags: [] })
      })
    );
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/posts')
      .send({ text: 'No title here', category: 'Music' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/posts/:id', () => {
  it('deletes post and returns 204 when owner', async () => {
    prismaMock.post.findUnique.mockResolvedValue(makePost() as never);
    prismaMock.post.delete.mockResolvedValue(makePost() as never);

    const res = await request(app).delete('/api/posts/1');

    expect(res.status).toBe(204);
  });

  it('returns 403 when post belongs to another user', async () => {
    prismaMock.post.findUnique.mockResolvedValue(
      makePost({ userId: 99 }) as never
    );

    const res = await request(app).delete('/api/posts/1');

    expect(res.status).toBe(403);
  });

  it('returns 404 when post does not exist', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/posts/999');

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app).delete('/api/posts/nope');

    expect(res.status).toBe(400);
    expect(prismaMock.post.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/posts/:id/comments', () => {
  it('adds a comment to a post and returns 201', async () => {
    prismaMock.post.findUnique.mockResolvedValue(makePost() as never);
    prismaMock.postComment.create.mockResolvedValue(makePostComment() as never);

    const res = await request(app)
      .post('/api/posts/1/comments')
      .send({ text: 'Great post!' });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe('Great post!');
    expect(prismaMock.postComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { postId: 1, userId: 7, text: 'Great post!' }
      })
    );
  });

  it('returns 404 when post does not exist', async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/posts/999/comments')
      .send({ text: 'Comment' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric post id', async () => {
    const res = await request(app)
      .post('/api/posts/nope/comments')
      .send({ text: 'Comment' });

    expect(res.status).toBe(400);
    expect(prismaMock.post.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when comment text is missing', async () => {
    const res = await request(app).post('/api/posts/1/comments').send({});

    expect(res.status).toBe(400);
    expect(prismaMock.postComment.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/posts/:id/comments/:commentId', () => {
  it('deletes comment and returns 204 when owner', async () => {
    prismaMock.postComment.findFirst.mockResolvedValue(
      makePostComment() as never
    );
    prismaMock.postComment.delete.mockResolvedValue(makePostComment() as never);

    const res = await request(app).delete('/api/posts/1/comments/1');

    expect(res.status).toBe(204);
  });

  it('returns 403 when comment belongs to another user', async () => {
    prismaMock.postComment.findFirst.mockResolvedValue(
      makePostComment({ userId: 99 }) as never
    );

    const res = await request(app).delete('/api/posts/1/comments/1');

    expect(res.status).toBe(403);
  });

  it('returns 404 when comment does not exist', async () => {
    prismaMock.postComment.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/posts/1/comments/999');

    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric ids', async () => {
    const res = await request(app).delete('/api/posts/nope/comments/abc');

    expect(res.status).toBe(400);
    expect(prismaMock.postComment.findFirst).not.toHaveBeenCalled();
  });
});

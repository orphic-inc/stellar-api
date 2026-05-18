import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

const makeNews = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Site update',
  body: 'We launched new features.',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides
});

const makeBlog = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Dev blog',
  body: 'Here is our progress.',
  userId: 7,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  user: { username: 'testuser', avatar: null },
  ...overrides
});

beforeEach(() => resetApiTestState());

describe('GET /api/announcements', () => {
  it('returns news and blog posts', async () => {
    prismaMock.news.findMany.mockResolvedValue([makeNews()] as never);
    prismaMock.blog.findMany.mockResolvedValue([makeBlog()] as never);

    const res = await request(app).get('/api/announcements');

    expect(res.status).toBe(200);
    expect(res.body.announcements[0].title).toBe('Site update');
    expect(res.body.blogPosts[0].title).toBe('Dev blog');
  });

  it('returns empty arrays when no content exists', async () => {
    prismaMock.news.findMany.mockResolvedValue([]);
    prismaMock.blog.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/announcements');

    expect(res.status).toBe(200);
    expect(res.body.announcements).toEqual([]);
    expect(res.body.blogPosts).toEqual([]);
  });
});

describe('POST /api/announcements', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('creates a news item and returns 201', async () => {
    prismaMock.news.create.mockResolvedValue(makeNews() as never);

    const res = await request(app)
      .post('/api/announcements')
      .send({ title: 'Site update', body: 'We launched new features.' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Site update');
  });

  it('returns 403 without news_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .post('/api/announcements')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/announcements')
      .send({ body: 'No title here' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/announcements/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('updates news item and returns it', async () => {
    const updated = makeNews({ title: 'Updated title' });
    prismaMock.news.update.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/announcements/1')
      .send({ title: 'Updated title', body: 'Updated body.' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app)
      .put('/api/announcements/abc')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/announcements/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('deletes news item and returns 204', async () => {
    prismaMock.news.delete.mockResolvedValue(makeNews() as never);

    const res = await request(app).delete('/api/announcements/1');

    expect(res.status).toBe(204);
    expect(prismaMock.news.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe('POST /api/announcements/blog', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('creates a blog post and returns 201', async () => {
    prismaMock.blog.create.mockResolvedValue(makeBlog() as never);

    const res = await request(app)
      .post('/api/announcements/blog')
      .send({ title: 'Dev blog', body: 'Here is our progress.' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Dev blog');
  });
});

describe('DELETE /api/announcements/blog/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('deletes blog post and returns 204', async () => {
    prismaMock.blog.delete.mockResolvedValue(makeBlog() as never);

    const res = await request(app).delete('/api/announcements/blog/1');

    expect(res.status).toBe(204);
    expect(prismaMock.blog.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

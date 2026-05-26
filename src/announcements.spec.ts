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

describe('POST /api/announcements — site_news notification', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('emits site_news notifications to all active users on creation', async () => {
    prismaMock.news.create.mockResolvedValue(makeNews({ id: 5 }) as never);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 10 },
      { id: 11 }
    ] as never);

    const res = await request(app)
      .post('/api/announcements')
      .send({ title: 'Big news', body: 'Details here.' });

    expect(res.status).toBe(201);
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 10,
            type: 'site_news',
            page: 'news',
            pageId: 5
          }),
          expect.objectContaining({
            userId: 11,
            type: 'site_news',
            page: 'news',
            pageId: 5
          })
        ])
      })
    );
  });
});

const makeGlobalNotice = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  message: 'Scheduled maintenance tonight at midnight.',
  url: null,
  expiresAt: null,
  createdById: 7,
  createdAt: new Date('2026-01-01'),
  ...overrides
});

describe('POST /api/announcements/global-notice', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('creates a global notice and emits notifications to all active users', async () => {
    prismaMock.globalNotice.create.mockResolvedValue(
      makeGlobalNotice({ id: 3 }) as never
    );
    prismaMock.user.findMany.mockResolvedValue([
      { id: 10 },
      { id: 11 }
    ] as never);

    const res = await request(app)
      .post('/api/announcements/global-notice')
      .send({ message: 'Maintenance tonight at midnight.' });

    expect(res.status).toBe(201);
    expect(prismaMock.globalNotice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: 'Maintenance tonight at midnight.'
        })
      })
    );
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: 10,
            type: 'global_notice',
            page: 'global_notices',
            pageId: 3
          })
        ])
      })
    );
  });

  it('returns 400 when message exceeds 500 characters', async () => {
    const res = await request(app)
      .post('/api/announcements/global-notice')
      .send({ message: 'x'.repeat(501) });

    expect(res.status).toBe(400);
    expect(prismaMock.globalNotice.create).not.toHaveBeenCalled();
  });

  it('returns 400 when url is not a valid URL', async () => {
    const res = await request(app)
      .post('/api/announcements/global-notice')
      .send({ message: 'Notice', url: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('returns 403 without news_manage permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .post('/api/announcements/global-notice')
      .send({ message: 'Notice' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/announcements/global-notices', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('returns active (non-expired) global notices', async () => {
    prismaMock.globalNotice.findMany.mockResolvedValue([
      { ...makeGlobalNotice(), createdBy: { id: 7, username: 'admin' } }
    ] as never);

    const res = await request(app).get('/api/announcements/global-notices');

    expect(res.status).toBe(200);
    expect(res.body[0].message).toBe(
      'Scheduled maintenance tonight at midnight.'
    );
  });
});

describe('DELETE /api/announcements/global-notice/:id', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ news_manage: true })
    );
  });

  it('deletes a global notice and returns 204', async () => {
    prismaMock.globalNotice.delete.mockResolvedValue(
      makeGlobalNotice() as never
    );

    const res = await request(app).delete('/api/announcements/global-notice/1');

    expect(res.status).toBe(204);
    expect(prismaMock.globalNotice.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app).delete(
      '/api/announcements/global-notice/abc'
    );

    expect(res.status).toBe(400);
  });
});

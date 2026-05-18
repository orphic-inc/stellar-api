import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

describe('POST /api/subscriptions/subscribe', () => {
  it('subscribes user to topic and returns 204', async () => {
    prismaMock.subscription.upsert.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .send({ topicId: 5, action: 'subscribe' });

    expect(res.status).toBe(204);
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_topicId: { userId: 7, topicId: 5 } }
      })
    );
  });

  it('unsubscribes user from topic and returns 204', async () => {
    prismaMock.subscription.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .send({ topicId: 5, action: 'unsubscribe' });

    expect(res.status).toBe(204);
    expect(prismaMock.subscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, topicId: 5 }
    });
  });

  it('returns 400 when action is invalid', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .send({ topicId: 5, action: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when topicId is missing', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .send({ action: 'subscribe' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when topicId is invalid', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .send({ topicId: 'nope', action: 'unsubscribe' });

    expect(res.status).toBe(400);
    expect(prismaMock.subscription.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/subscriptions', () => {
  it('returns subscriptions for current user', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 1, userId: 7, topicId: 5 }
    ] as never);

    const res = await request(app).get('/api/subscriptions');

    expect(res.status).toBe(200);
    expect(res.body[0].topicId).toBe(5);
    expect(prismaMock.subscription.findMany).toHaveBeenCalledWith({
      where: { userId: 7 },
      take: 100
    });
  });

  it('returns empty array when no subscriptions', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/subscriptions');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/subscriptions/subscribe-comments', () => {
  it('subscribes to comments on a page and returns 204', async () => {
    prismaMock.commentSubscription.upsert.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({ page: 'artist', pageId: 10, action: 'subscribe' });

    expect(res.status).toBe(204);
    expect(prismaMock.commentSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_page_pageId: { userId: 7, page: 'artist', pageId: 10 } }
      })
    );
  });

  it('unsubscribes from comments on a page and returns 204', async () => {
    prismaMock.commentSubscription.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({ page: 'artist', pageId: 10, action: 'unsubscribe' });

    expect(res.status).toBe(204);
    expect(prismaMock.commentSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, page: 'artist', pageId: 10 }
    });
  });

  it('returns 400 when page value is invalid', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({ page: 'invalid_page', pageId: 10, action: 'subscribe' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when action is invalid', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({ page: 'artist', pageId: 10, action: 'bad-action' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when pageId is invalid', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({ page: 'artist', pageId: 'nope', action: 'subscribe' });

    expect(res.status).toBe(400);
    expect(prismaMock.commentSubscription.upsert).not.toHaveBeenCalled();
  });
});

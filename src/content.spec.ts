import {
  request,
  app,
  prismaMock,
  createContributionSubmissionMock,
  resetApiTestState
} from './test/apiTestHarness';

describe('API content and shared flows', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  it('scopes post comment deletion to the post id from the route', async () => {
    prismaMock.postComment.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/posts/99/comments/5');

    expect(res.status).toBe(404);
    expect(prismaMock.postComment.findFirst).toHaveBeenCalledWith({
      where: { id: 5, postId: 99 }
    });
    expect(prismaMock.postComment.delete).not.toHaveBeenCalled();
  });

  it('creates a post for the authenticated user', async () => {
    prismaMock.post.create.mockResolvedValue({
      id: 14,
      userId: 7,
      title: 'Launch post',
      text: 'Some text',
      category: 'news',
      tags: ['launch'],
      user: { id: 7, username: 'kai', avatar: null },
      comments: []
    });

    const res = await request(app)
      .post('/api/posts')
      .send({
        title: 'Launch post',
        text: 'Some text',
        category: 'news',
        tags: ['launch']
      });

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        title: 'Launch post',
        text: 'Some text',
        category: 'news',
        tags: ['launch']
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, username: true, avatar: true } }
          }
        }
      }
    });
    expect(res.body.title).toBe('Launch post');
  });

  it('creates a post comment for an existing post', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 14, userId: 7 });
    prismaMock.postComment.create.mockResolvedValue({
      id: 5,
      postId: 14,
      userId: 7,
      text: 'Nice post',
      user: { id: 7, username: 'kai', avatar: null }
    });

    const res = await request(app).post('/api/posts/14/comments').send({
      text: 'Nice post'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.postComment.create).toHaveBeenCalledWith({
      data: { postId: 14, userId: 7, text: 'Nice post' },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    expect(res.body.text).toBe('Nice post');
  });

  it('subscribes to a topic with a 204 response', async () => {
    const res = await request(app).post('/api/subscriptions/subscribe').send({
      topicId: 44,
      action: 'subscribe'
    });

    expect(res.status).toBe(204);
    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith({
      where: { userId_topicId: { userId: 7, topicId: 44 } },
      create: { userId: 7, topicId: 44 },
      update: {}
    });
  });

  it('unsubscribes from comment notifications with a 204 response', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe-comments')
      .send({
        page: 'communities',
        pageId: 3,
        action: 'unsubscribe'
      });

    expect(res.status).toBe(204);
    expect(prismaMock.commentSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, page: 'communities', pageId: 3 }
    });
  });

  it('rejects notification deletion for non-owners', async () => {
    prismaMock.notification.findUnique.mockResolvedValue({
      id: 8,
      userId: 99
    });

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.notification.delete).not.toHaveBeenCalled();
  });

  it('deletes a notification for the owner', async () => {
    prismaMock.notification.findUnique.mockResolvedValue({
      id: 8,
      userId: 7
    });

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.delete).toHaveBeenCalledWith({
      where: { id: 8 }
    });
  });

  it('rejects post deletion for non-owners', async () => {
    prismaMock.post.findUnique.mockResolvedValue({
      id: 14,
      userId: 99
    });

    const res = await request(app).delete('/api/posts/14');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.post.delete).not.toHaveBeenCalled();
  });

  it('deletes a post for the owner', async () => {
    prismaMock.post.findUnique.mockResolvedValue({
      id: 14,
      userId: 7
    });

    const res = await request(app).delete('/api/posts/14');

    expect(res.status).toBe(204);
    expect(prismaMock.post.delete).toHaveBeenCalledWith({
      where: { id: 14 }
    });
  });

  it('returns ValidationError for malformed comment targets', async () => {
    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'hello'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        msg: 'Validation failed',
        errors: expect.any(Object)
      })
    );
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('creates a comment for a valid comment target', async () => {
    prismaMock.comment.create.mockResolvedValue({
      id: 12,
      page: 'communities',
      body: 'hello',
      communityId: 3,
      authorId: 7,
      author: { id: 7, username: 'kai', avatar: null }
    });

    const res = await request(app).post('/api/comments').send({
      page: 'communities',
      body: 'hello',
      communityId: 3
    });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith({
      data: {
        page: 'communities',
        body: 'hello',
        authorId: 7,
        communityId: 3
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } }
      }
    });
    expect(res.body.communityId).toBe(3);
  });

  it('updates a comment for the owner', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 7,
      body: 'old body'
    });
    prismaMock.comment.update.mockResolvedValue({
      id: 12,
      authorId: 7,
      body: 'new body',
      editedUserId: 7
    });

    const res = await request(app).put('/api/comments/12').send({
      body: 'new body'
    });

    expect(res.status).toBe(200);
    expect(prismaMock.comment.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({
        body: 'new body',
        editedUserId: 7
      })
    });
    expect(res.body.body).toBe('new body');
  });

  it('rejects comment deletion for non-owners without moderator permissions', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 99
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
  });

  it('allows owners to delete their own comments', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 7
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('allows moderators to delete comments they do not own', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 12,
      authorId: 99
    });
    prismaMock.userRank.findUnique.mockResolvedValue({
      permissions: { forums_moderate: true }
    });

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('maps missing contribution community to a msg response', async () => {
    createContributionSubmissionMock.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 99,
        type: 'Music',
        title: 'Test Release',
        year: 2024,
        fileType: 'wav',
        sizeInBytes: 12345,
        collaborators: [{ artist: 'Test Artist', importance: 'primary' }]
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ msg: 'Community not found' });
  });

  it('returns the created contribution payload on successful submission', async () => {
    createContributionSubmissionMock.mockResolvedValue({
      id: 12,
      user: { id: 7, username: 'kai' },
      release: { id: 55, title: 'Test Release', communityId: 3 },
      collaborators: [{ id: 21, name: 'Test Artist' }],
      releaseDescription: 'A real contribution'
    } as Awaited<ReturnType<typeof createContributionSubmissionMock>>);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 3,
        type: 'Music',
        title: 'Test Release',
        year: 2024,
        fileType: 'wav',
        sizeInBytes: 12345,
        releaseDescription: 'A real contribution',
        collaborators: [{ artist: 'Test Artist', importance: 'primary' }]
      });

    expect(res.status).toBe(201);
    expect(createContributionSubmissionMock).toHaveBeenCalledWith({
      userId: 7,
      input: expect.objectContaining({
        communityId: 3,
        title: 'Test Release',
        type: 'Music'
      })
    });
    expect(res.body.release.title).toBe('Test Release');
  });
});

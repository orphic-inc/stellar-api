import {
  request,
  app,
  prismaMock,
  makeUserRank,
  createContributionSubmissionMock,
  fileReportMock,
  recordContributionReportMock,
  resetApiTestState
} from './test/apiTestHarness';
import { authorRefSelect } from './modules/authorRef';
import {
  makeAuthorRefRow,
  makePost,
  makePostWithIncludes,
  makePostComment,
  makePostCommentWithUser,
  makeComment,
  makeCommentWithAuthor,
  makeNotification
} from './test/factories';

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
    prismaMock.post.create.mockResolvedValue(
      makePostWithIncludes({
        id: 14,
        title: 'Launch post',
        text: 'Some text',
        category: 'news',
        tags: ['launch'],
        user: makeAuthorRefRow({ username: 'kai' })
      }) as unknown as ReturnType<typeof makePost>
    );

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
        user: { select: authorRefSelect },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: authorRefSelect }
          }
        }
      }
    });
    expect(res.body.title).toBe('Launch post');
  });

  it('creates a post comment for an existing post', async () => {
    prismaMock.post.findUnique.mockResolvedValue(
      makePost({ id: 14, userId: 7 })
    );
    prismaMock.postComment.create.mockResolvedValue(
      makePostCommentWithUser({
        id: 5,
        postId: 14,
        userId: 7,
        text: 'Nice post',
        user: makeAuthorRefRow({ username: 'kai' })
      }) as unknown as ReturnType<typeof makePostComment>
    );

    const res = await request(app).post('/api/posts/14/comments').send({
      text: 'Nice post'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.postComment.create).toHaveBeenCalledWith({
      data: { postId: 14, userId: 7, text: 'Nice post' },
      include: { user: { select: authorRefSelect } }
    });
    expect(res.body.text).toBe('Nice post');
  });

  it('returns paginated contributions', async () => {
    prismaMock.contribution.findMany.mockResolvedValue([
      {
        id: 5,
        userId: 7,
        releaseId: 3,
        contributorId: null,
        releaseDescription: 'Seeded',
        sizeInBytes: 1234,
        approvedAccountingBytes: 1234,
        linkStatus: 'PASS',
        linkCheckedAt: null,
        type: 'flac',
        releaseFile: {
          bitrate: null,
          hasLog: false,
          hasCue: false,
          isScene: false
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 7, username: 'kai' },
        release: { id: 3, title: 'Kind of Blue' },
        collaborators: []
      } as never
    ]);
    prismaMock.contribution.count.mockResolvedValue(1);

    const res = await request(app).get('/api/contributions?page=2');

    expect(res.status).toBe(200);
    expect(prismaMock.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 })
    );
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 404 for a missing contribution detail', async () => {
    prismaMock.contribution.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/contributions/999');

    expect(res.status).toBe(404);
  });

  it('returns contribution detail when present', async () => {
    prismaMock.contribution.findUnique.mockResolvedValue({
      id: 5,
      userId: 7,
      releaseId: 3,
      contributorId: null,
      releaseDescription: 'Seeded',
      sizeInBytes: 1234,
      approvedAccountingBytes: 1234,
      linkStatus: 'PASS',
      linkCheckedAt: null,
      type: 'flac',
      releaseFile: {
        bitrate: null,
        hasLog: false,
        hasCue: false,
        isScene: false
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 7, username: 'kai' },
      release: { id: 3, title: 'Kind of Blue' },
      collaborators: [],
      comments: []
    } as never);

    const res = await request(app).get('/api/contributions/5');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });

  it('rejects contribution creation for invalid download URLs when domains are enforced', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: ['approved.example'],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    });

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 1,
        type: 'Music',
        title: 'Kind of Blue',
        year: 1959,
        fileType: 'flac',
        sizeInBytes: 1234,
        releaseDescription: 'Seeded',
        downloadUrl: 'not-a-url',
        collaborators: [{ artist: 'Miles Davis', importance: 'Main' }]
      });

    expect(res.status).toBe(400);
  });

  it('rejects contribution creation for unapproved domains', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: ['approved.example'],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    });

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 1,
        type: 'Music',
        title: 'Kind of Blue',
        year: 1959,
        fileType: 'flac',
        sizeInBytes: 1234,
        releaseDescription: 'Seeded',
        downloadUrl: 'https://evil.example/file.zip',
        collaborators: [{ artist: 'Miles Davis', importance: 'Main' }]
      });

    expect(res.status).toBe(400);
  });

  it('returns 404 when contribution submission cannot find a community', async () => {
    createContributionSubmissionMock.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 1,
        type: 'Music',
        title: 'Kind of Blue',
        year: 1959,
        fileType: 'flac',
        sizeInBytes: 1234,
        releaseDescription: 'Seeded',
        downloadUrl: 'https://approved.example/file.zip',
        collaborators: [{ artist: 'Miles Davis', importance: 'Main' }]
      });

    expect(res.status).toBe(404);
  });

  it('creates a contribution submission for valid input', async () => {
    createContributionSubmissionMock.mockResolvedValue({
      id: 5,
      releaseId: 3,
      userId: 7,
      collaborators: []
    } as never);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 1,
        type: 'Music',
        title: 'Kind of Blue',
        year: 1959,
        fileType: 'flac',
        sizeInBytes: 1234,
        releaseDescription: 'Seeded',
        downloadUrl: 'https://approved.example/file.zip',
        collaborators: [{ artist: 'Miles Davis', importance: 'Main' }]
      });

    expect(res.status).toBe(201);
    expect(createContributionSubmissionMock).toHaveBeenCalledWith({
      userId: 7,
      input: expect.objectContaining({
        fileType: 'flac',
        communityId: 1,
        title: 'Kind of Blue'
      })
    });
  });

  it('reports a contribution and records both moderation side effects', async () => {
    prismaMock.contribution.findUnique.mockResolvedValue({ id: 5 } as never);
    fileReportMock.mockResolvedValue({
      ok: true,
      report: {} as never
    });
    recordContributionReportMock.mockResolvedValue(undefined);

    const res = await request(app).post('/api/contributions/5/report').send({
      reason: 'Dead link'
    });

    expect(res.status).toBe(201);
    expect(fileReportMock).toHaveBeenCalledWith(7, {
      targetType: 'Contribution',
      targetId: 5,
      category: 'dead_link',
      reason: 'Dead link'
    });
    expect(recordContributionReportMock).toHaveBeenCalledWith(
      5,
      7,
      'Dead link'
    );
  });

  it('returns 404 when reporting a missing contribution', async () => {
    prismaMock.contribution.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/contributions/999/report').send({
      reason: 'Dead link'
    });

    expect(res.status).toBe(404);
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
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotification({ id: 8, userId: 99 })
    );

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.notification.delete).not.toHaveBeenCalled();
  });

  it('deletes a notification for the owner', async () => {
    prismaMock.notification.findUnique.mockResolvedValue(
      makeNotification({ id: 8, userId: 7 })
    );

    const res = await request(app).delete('/api/notifications/8');

    expect(res.status).toBe(204);
    expect(prismaMock.notification.delete).toHaveBeenCalledWith({
      where: { id: 8 }
    });
  });

  it('rejects post deletion for non-owners', async () => {
    prismaMock.post.findUnique.mockResolvedValue(
      makePost({ id: 14, userId: 99 })
    );

    const res = await request(app).delete('/api/posts/14');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(prismaMock.post.delete).not.toHaveBeenCalled();
  });

  it('deletes a post for the owner', async () => {
    prismaMock.post.findUnique.mockResolvedValue(
      makePost({ id: 14, userId: 7 })
    );

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
    prismaMock.comment.create.mockResolvedValue(
      makeCommentWithAuthor({
        id: 12,
        body: 'hello',
        communityId: 3,
        authorId: 7,
        author: makeAuthorRefRow({ username: 'kai' })
      }) as unknown as ReturnType<typeof makeComment>
    );

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
        author: { select: authorRefSelect }
      }
    });
    expect(res.body.communityId).toBe(3);
  });

  it('updates a comment for the owner', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7, body: 'old body' })
    );
    prismaMock.comment.update.mockResolvedValue(
      makeComment({ id: 12, authorId: 7, body: 'new body', editedUserId: 7 })
    );

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
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 })
    );

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
  });

  it('allows owners to delete their own comments', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 7 })
    );

    const res = await request(app).delete('/api/comments/12');

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('allows moderators to delete comments they do not own', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(
      makeComment({ id: 12, authorId: 99 })
    );
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ reports_manage: true })
    );

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
        downloadUrl: 'https://example.com/download',
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
        downloadUrl: 'https://example.com/download',
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

  it('emits artist_release notifications to subscribers of each collaborating artist', async () => {
    createContributionSubmissionMock.mockResolvedValue({
      id: 12,
      user: { id: 7, username: 'kai' },
      release: { id: 55, title: 'Test Release', communityId: 3 },
      collaborators: [
        { id: 21, name: 'Miles Davis' },
        { id: 22, name: 'John Coltrane' }
      ],
      releaseDescription: 'A real contribution'
    } as Awaited<ReturnType<typeof createContributionSubmissionMock>>);

    prismaMock.artistSubscription.findMany.mockResolvedValue([
      { userId: 99 },
      { userId: 100 }
    ] as never);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 3,
        type: 'Music',
        title: 'Test Release',
        year: 2024,
        fileType: 'wav',
        downloadUrl: 'https://example.com/download',
        sizeInBytes: 12345,
        collaborators: [
          { artist: 'Miles Davis', importance: 'primary' },
          { artist: 'John Coltrane', importance: 'secondary' }
        ]
      });

    expect(res.status).toBe(201);
    expect(prismaMock.artistSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artistId: { in: [21, 22] } } })
    );
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: 'artist_release',
            page: 'contributions',
            pageId: 12
          })
        ])
      })
    );
  });

  it('skips notification emission when the contribution has no collaborators', async () => {
    createContributionSubmissionMock.mockResolvedValue({
      id: 13,
      collaborators: [],
      release: { id: 56, title: 'Solo', communityId: 3 }
    } as never);

    const res = await request(app)
      .post('/api/contributions')
      .send({
        communityId: 3,
        type: 'Music',
        title: 'Solo',
        year: 2024,
        fileType: 'wav',
        downloadUrl: 'https://example.com/download',
        sizeInBytes: 12345,
        collaborators: [{ artist: 'Unknown', importance: 'primary' }]
      });

    expect(res.status).toBe(201);
    expect(prismaMock.artistSubscription.findMany).not.toHaveBeenCalled();
  });
});

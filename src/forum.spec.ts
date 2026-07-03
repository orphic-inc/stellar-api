import {
  request,
  app,
  prismaMock,
  makeUserRank,
  createTopicMock,
  updatePostMock,
  deleteTopicMock,
  deletePostMock,
  deleteForumMock,
  createTopicNoteMock,
  topicSessionMock,
  setCurrentUserRankLevel,
  setCurrentUserPermissions,
  resetApiTestState
} from './test/apiTestHarness';
import {
  makeAuthorRefRow,
  makeForum,
  makeForumTopic,
  makeForumPost,
  makeForumTopicNote,
  makeForumList
} from './test/factories';
import {
  createTopic,
  updateTopic,
  updatePost,
  createTopicNote
} from './modules/forum';
import { AppError } from './lib/errors';

beforeEach(() => {
  resetApiTestState();
});

describe('API forum flows', () => {
  it('creates a forum topic when the user meets the create-class requirement', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassCreate: 100 })
    );
    createTopicMock.mockResolvedValue({
      id: 44,
      title: 'New Topic',
      forumId: 9,
      authorId: 7
    } as Awaited<ReturnType<typeof createTopic>>);

    const res = await request(app).post('/api/forums/9/topics').send({
      title: 'New Topic',
      body: 'Opening post body'
    });

    expect(res.status).toBe(201);
    expect(createTopicMock).toHaveBeenCalledWith(9, 7, {
      title: 'New Topic',
      body: 'Opening post body',
      question: undefined,
      answers: undefined
    });
    expect(res.body.title).toBe('New Topic');
  });

  it('updates a forum topic for the owner', async () => {
    topicSessionMock.updateTopic.mockResolvedValue({
      ok: true,
      topic: {
        id: 44,
        title: 'Renamed Topic',
        isLocked: false,
        isSticky: false
      } as Awaited<ReturnType<typeof updateTopic>>
    });

    const res = await request(app).put('/api/forums/9/topics/44').send({
      title: 'Renamed Topic'
    });

    expect(res.status).toBe(200);
    expect(topicSessionMock.updateTopic).toHaveBeenCalledWith(
      44,
      9,
      expect.objectContaining({ actorId: 7 }),
      { title: 'Renamed Topic', isLocked: undefined, isSticky: undefined }
    );
    expect(res.body.title).toBe('Renamed Topic');
  });

  it('creates a forum post when the topic is unlocked and belongs to the forum', async () => {
    topicSessionMock.replyToTopic.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'Reply body'
    } as never);

    const res = await request(app).post('/api/forums/9/topics/44/posts').send({
      body: 'Reply body'
    });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Reply body');
  });

  it('updates a forum post for the owner', async () => {
    prismaMock.forumPost.findFirst
      .mockResolvedValueOnce(
        makeForumPost({
          id: 21,
          forumTopicId: 44,
          authorId: 7,
          body: 'Old body'
        })
      )
      .mockResolvedValueOnce(
        makeForumPost({
          id: 21,
          forumTopicId: 44,
          authorId: 7,
          body: 'New body'
        })
      );
    updatePostMock.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'New body'
    } as Awaited<ReturnType<typeof updatePost>>);

    const res = await request(app)
      .put('/api/forums/9/topics/44/posts/21')
      .send({
        body: 'New body'
      });

    expect(res.status).toBe(200);
    expect(updatePostMock).toHaveBeenCalledWith(
      21,
      7,
      'Old body',
      'New body',
      44
    );
    expect(res.body.body).toBe('New body');
  });

  it('rejects topic deletion for non-owners without moderator permissions', async () => {
    topicSessionMock.deleteTopic.mockResolvedValue({
      ok: false,
      reason: 'not_authorized'
    });

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(deleteTopicMock).not.toHaveBeenCalled();
  });

  it('allows moderators to delete a forum post', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, forumTopicId: 44, authorId: 99 })
    );
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );

    const res = await request(app).delete('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(204);
    expect(deletePostMock).toHaveBeenCalledWith(21, 44, 9, 7, true);
  });

  it('rejects topic-note creation for non-moderators', async () => {
    const res = await request(app).post('/api/forums/topic-notes').send({
      forumTopicId: 44,
      body: 'staff note'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(createTopicNoteMock).not.toHaveBeenCalled();
  });

  it('allows moderators to create topic notes', async () => {
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    createTopicNoteMock.mockResolvedValue({
      id: 77,
      forumTopicId: 44,
      authorId: 7,
      body: 'staff note'
    } as Awaited<ReturnType<typeof createTopicNote>>);

    const res = await request(app).post('/api/forums/topic-notes').send({
      forumTopicId: 44,
      body: 'staff note'
    });

    expect(res.status).toBe(201);
    expect(createTopicNoteMock).toHaveBeenCalledWith(44, 7, 'staff note');
    expect(res.body.body).toBe('staff note');
  });

  it('allows topic-note authors to delete their own note', async () => {
    prismaMock.forumTopicNote.findUnique.mockResolvedValue(
      makeForumTopicNote({ id: 77, authorId: 7 })
    );

    const res = await request(app).delete('/api/forums/topic-notes/77');

    expect(res.status).toBe(204);
    expect(prismaMock.forumTopicNote.delete).toHaveBeenCalledWith({
      where: { id: 77 }
    });
  });

  it('returns 404 when the topic note does not exist on DELETE', async () => {
    prismaMock.forumTopicNote.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/forums/topic-notes/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Note not found');
  });

  it('returns 403 when a non-author tries to delete a topic note', async () => {
    prismaMock.forumTopicNote.findUnique.mockResolvedValue(
      makeForumTopicNote({ id: 77, authorId: 99 })
    );

    const res = await request(app).delete('/api/forums/topic-notes/77');

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });

  it('allows moderators to list topic notes for a topic', async () => {
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    prismaMock.forumTopicNote.findMany.mockResolvedValue([
      {
        ...makeForumTopicNote({ id: 77, forumTopicId: 44 }),
        author: { id: 7, username: 'testuser' }
      }
    ] as never);

    const res = await request(app).get('/api/forums/topic-notes/44');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(prismaMock.forumTopicNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { forumTopicId: 44 } })
    );
  });

  it('filters forum listings by the current user rank', async () => {
    setCurrentUserRankLevel(100);
    prismaMock.forum.findMany.mockResolvedValue(
      makeForumList([{ id: 1, name: 'Open Forum', minClassRead: 0 }])
    );

    const res = await request(app).get('/api/forums');

    expect(res.status).toBe(200);
    expect(prismaMock.forum.findMany).toHaveBeenCalled();
    expect(res.body).toEqual([{ id: 1, name: 'Open Forum', minClassRead: 0 }]);
  });

  it('rejects direct forum access when the user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(100);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, name: 'Staff Forum', minClassRead: 500 })
    );

    const res = await request(app).get('/api/forums/9');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      msg: 'Insufficient class to read this forum'
    });
  });
});

// ─── GET /api/forums/:id ─────────────────────────────────────────────────────

describe('GET /api/forums/:id', () => {
  it('returns a forum when found and rank is sufficient', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, name: 'Open Forum', minClassRead: 0 })
    );

    const res = await request(app).get('/api/forums/9');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Open Forum');
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });
});

// ─── POST /api/forums/:id/catchup ────────────────────────────────────────────

describe('POST /api/forums/:id/catchup', () => {
  it('marks all topics as read and returns count', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findMany.mockResolvedValue([
      makeForumTopic({ id: 44, lastPostId: 21 }),
      makeForumTopic({ id: 45, lastPostId: 22 })
    ]);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);

    const res = await request(app).post('/api/forums/9/catchup');

    expect(res.status).toBe(200);
    expect(res.body.markedRead).toBe(2);
  });

  it('returns 0 and skips transaction when there are no topics', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/forums/9/catchup');

    expect(res.status).toBe(200);
    expect(res.body.markedRead).toBe(0);
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/forums/99/catchup');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 500 })
    );

    const res = await request(app).post('/api/forums/9/catchup');

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/forums ─────────────────────────────────────────────────────────

describe('POST /api/forums', () => {
  beforeEach(() =>
    setCurrentUserPermissions(
      makeUserRank({ forums_manage: true }).permissions as Record<
        string,
        boolean
      >
    )
  );

  it('creates a forum and returns 201', async () => {
    prismaMock.forum.create.mockResolvedValue(
      makeForum({ id: 5, name: 'New Forum' })
    );

    const res = await request(app).post('/api/forums').send({
      forumCategoryId: 1,
      sort: 2,
      name: 'New Forum',
      minClassRead: 0,
      minClassWrite: 0,
      minClassCreate: 0
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Forum');
  });

  it('returns 403 without forums_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app).post('/api/forums').send({
      forumCategoryId: 1,
      sort: 2,
      name: 'New Forum',
      minClassRead: 0,
      minClassWrite: 0,
      minClassCreate: 0
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/forums')
      .send({ name: 'Incomplete' });

    expect(res.status).toBe(400);
  });
});

// ─── PUT /api/forums/:id ─────────────────────────────────────────────────────

describe('PUT /api/forums/:id', () => {
  beforeEach(() =>
    setCurrentUserPermissions(
      makeUserRank({ forums_manage: true }).permissions as Record<
        string,
        boolean
      >
    )
  );

  it('updates forum fields and returns the forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forum.update.mockResolvedValue(
      makeForum({ id: 9, name: 'Renamed Forum' })
    );

    const res = await request(app)
      .put('/api/forums/9')
      .send({ name: 'Renamed Forum' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed Forum');
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/forums/99')
      .send({ name: 'Renamed Forum' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 without forums_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app)
      .put('/api/forums/9')
      .send({ name: 'Renamed Forum' });

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/forums/:id ───────────────────────────────────────────────────

describe('DELETE /api/forums/:id', () => {
  beforeEach(() =>
    setCurrentUserPermissions(
      makeUserRank({ forums_manage: true }).permissions as Record<
        string,
        boolean
      >
    )
  );

  it('deletes a forum and returns 204', async () => {
    deleteForumMock.mockResolvedValue({ ok: true } as never);

    const res = await request(app).delete('/api/forums/9');

    expect(res.status).toBe(204);
  });

  it('returns 404 when forum does not exist', async () => {
    deleteForumMock.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    } as never);

    const res = await request(app).delete('/api/forums/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 400 when trying to delete the trash forum', async () => {
    deleteForumMock.mockResolvedValue({
      ok: false,
      reason: 'is_trash'
    } as never);

    const res = await request(app).delete('/api/forums/9');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/trash/i);
  });

  it('returns 500 when the trash forum is missing from the install', async () => {
    deleteForumMock.mockResolvedValue({
      ok: false,
      reason: 'no_trash'
    } as never);

    const res = await request(app).delete('/api/forums/9');

    expect(res.status).toBe(500);
  });

  it('returns 403 without forums_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app).delete('/api/forums/9');

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/forums/:forumId/topics ─────────────────────────────────────────

describe('GET /api/forums/:forumId/topics', () => {
  it('returns paginated list of topics for the forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findMany.mockResolvedValue([
      makeForumTopic({ id: 44, title: 'Topic A' })
    ]);
    prismaMock.forumTopic.count.mockResolvedValue(1);

    const res = await request(app).get('/api/forums/9/topics');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  // #231 — topic and last-post authors carry the donor sign + warning sign.
  it('returns topic and lastPost authors as AuthorRef with the signs', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findMany.mockResolvedValue([
      {
        ...makeForumTopic({ id: 44, title: 'Topic A' }),
        author: makeAuthorRefRow({
          isDonor: true,
          donorRank: {
            expiresAt: null,
            donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' }
          }
        }),
        lastPost: {
          id: 21,
          createdAt: new Date(),
          author: makeAuthorRefRow({
            id: 9,
            username: 'warneduser',
            warned: new Date('2026-04-01T00:00:00.000Z')
          })
        }
      } as never
    ]);
    prismaMock.forumTopic.count.mockResolvedValue(1);

    const res = await request(app).get('/api/forums/9/topics');

    expect(res.status).toBe(200);
    expect(res.body.data[0].author).toEqual(
      expect.objectContaining({
        isDonor: true,
        donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' },
        warned: null
      })
    );
    expect(res.body.data[0].lastPost.author).toEqual(
      expect.objectContaining({
        id: 9,
        isDonor: false,
        donorRank: null,
        warned: '2026-04-01T00:00:00.000Z'
      })
    );
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/99/topics');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 500 })
    );

    const res = await request(app).get('/api/forums/9/topics');

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/forums/:forumId/topics/:forumTopicId ───────────────────────────

describe('GET /api/forums/:forumId/topics/:forumTopicId', () => {
  it('returns a topic when forum and topic exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, title: 'Test Topic' })
    );

    const res = await request(app).get('/api/forums/9/topics/44');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test Topic');
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/99/topics/44');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 500 })
    );
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/9/topics/44');

    expect(res.status).toBe(403);
  });

  it('returns 404 when topic does not exist in the forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/9/topics/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Topic not found');
  });
});

// ─── POST /api/forums/:forumId/topics (error paths) ──────────────────────────

describe('POST /api/forums/:forumId/topics — error paths', () => {
  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/forums/99/topics')
      .send({ title: 'New Topic', body: 'Body text' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when user rank is below minClassCreate', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassCreate: 500 })
    );

    const res = await request(app)
      .post('/api/forums/9/topics')
      .send({ title: 'New Topic', body: 'Body text' });

    expect(res.status).toBe(403);
  });
});

// ─── PUT /api/forums/:forumId/topics/:forumTopicId (403 path) ────────────────

describe('PUT /api/forums/:forumId/topics/:forumTopicId — 403 path', () => {
  it('returns 403 for non-owner without moderator permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    topicSessionMock.updateTopic.mockResolvedValue({
      ok: false,
      reason: 'not_authorized'
    });

    const res = await request(app)
      .put('/api/forums/9/topics/44')
      .send({ title: 'Hijack' });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });
});

// ─── DELETE /api/forums/:forumId/topics/:forumTopicId (success paths) ────────

describe('DELETE /api/forums/:forumId/topics/:forumTopicId — success', () => {
  it('owner can delete their topic', async () => {
    topicSessionMock.deleteTopic.mockResolvedValue({ ok: true });

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(204);
    expect(topicSessionMock.deleteTopic).toHaveBeenCalledWith(
      44,
      9,
      expect.objectContaining({ actorId: 7 })
    );
  });

  it('moderator can delete any topic', async () => {
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    topicSessionMock.deleteTopic.mockResolvedValue({ ok: true });

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(204);
    expect(topicSessionMock.deleteTopic).toHaveBeenCalledWith(
      44,
      9,
      expect.objectContaining({ actorId: 7, canModerateForums: true })
    );
  });

  it('returns 404 when topic does not exist', async () => {
    topicSessionMock.deleteTopic.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });

    const res = await request(app).delete('/api/forums/9/topics/99');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/forums/:forumId/topics/:forumTopicId/posts ─────────────────────

describe('GET /api/forums/:forumId/topics/:forumTopicId/posts', () => {
  it('returns paginated list of posts with public last-edit metadata only', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumPost.findMany.mockResolvedValue([
      {
        ...makeForumPost({ id: 21, body: 'Post body' }),
        edits: [
          {
            id: 5,
            forumPostId: 21,
            editorId: 11,
            editedAt: new Date('2024-03-04T00:00:00Z'),
            editor: { id: 11, username: 'mod' }
          }
        ]
      } as never
    ]);
    prismaMock.forumPost.count.mockResolvedValue(1);

    const res = await request(app).get('/api/forums/9/topics/44/posts');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].edits).toBeUndefined();
    expect(res.body.data[0].lastEdit).toMatchObject({
      id: 5,
      forumPostId: 21,
      editorId: 11,
      editor: { id: 11, username: 'mod' }
    });
    expect(res.body.meta.total).toBe(1);
  });

  // #231 — post authors carry the donor sign + warning sign in the list read.
  it('returns post authors as AuthorRef with the signs', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumPost.findMany.mockResolvedValue([
      {
        ...makeForumPost({ id: 21, body: 'Post body' }),
        author: makeAuthorRefRow({
          isDonor: true,
          warned: new Date('2026-05-01T00:00:00.000Z'),
          donorRank: {
            expiresAt: null,
            donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' }
          }
        }),
        edits: []
      } as never
    ]);
    prismaMock.forumPost.count.mockResolvedValue(1);

    const res = await request(app).get('/api/forums/9/topics/44/posts');

    expect(res.status).toBe(200);
    expect(res.body.data[0].author).toEqual({
      id: 7,
      username: 'testuser',
      avatar: null,
      isDonor: true,
      donorRank: { name: 'Patron', badge: 'p.png', color: '#ffd700' },
      warned: '2026-05-01T00:00:00.000Z'
    });
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/99/topics/44/posts');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 500 })
    );

    const res = await request(app).get('/api/forums/9/topics/44/posts');

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/forums/:forumId/topics/:forumTopicId/posts/:id ─────────────────

describe('GET /api/forums/:forumId/topics/:forumTopicId/posts/:id', () => {
  it('returns a single post', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumPost.findFirst.mockResolvedValue({
      ...makeForumPost({ id: 21, body: 'Post body' }),
      edits: [
        {
          id: 5,
          forumPostId: 21,
          editorId: 11,
          editedAt: new Date('2024-03-04T00:00:00Z'),
          editor: { id: 11, username: 'mod' }
        }
      ]
    } as never);

    const res = await request(app).get('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Post body');
    expect(res.body.edits).toBeUndefined();
    expect(res.body.lastEdit.editor.username).toBe('mod');
  });

  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/99/topics/44/posts/21');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when user rank is below minClassRead', async () => {
    setCurrentUserRankLevel(10);
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 500 })
    );

    const res = await request(app).get('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(403);
  });

  it('returns 404 when post does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumPost.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/9/topics/44/posts/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Post not found');
  });
});

describe('GET /api/forums/:forumId/topics/:forumTopicId/posts/:id/edits', () => {
  it('returns moderator edit history newest first', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    prismaMock.forumPost.findFirst.mockResolvedValue({
      ...makeForumPost({ id: 21, body: 'Current body' }),
      edits: [
        {
          id: 6,
          forumPostId: 21,
          editorId: 12,
          previousBody: 'Second draft',
          editedAt: new Date('2024-03-05T00:00:00Z'),
          editor: { id: 12, username: 'charlie' }
        },
        {
          id: 5,
          forumPostId: 21,
          editorId: 11,
          previousBody: 'Original body',
          editedAt: new Date('2024-03-04T00:00:00Z'),
          editor: { id: 11, username: 'mod' }
        }
      ]
    } as never);

    const res = await request(app).get(
      '/api/forums/9/topics/44/posts/21/edits'
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].previousBody).toBe('Second draft');
    expect(res.body.data[1].previousBody).toBe('Original body');
  });

  it('returns 403 for non-moderators', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).get(
      '/api/forums/9/topics/44/posts/21/edits'
    );

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Insufficient permission to view edit history');
  });
});

// ─── POST /api/forums/:forumId/topics/:forumTopicId/posts (error paths) ──────

describe('POST /api/forums/:forumId/topics/:forumTopicId/posts — error paths', () => {
  it('returns 404 when replyToTopic throws a 404 AppError', async () => {
    topicSessionMock.replyToTopic.mockRejectedValue(
      new AppError(404, 'Forum not found')
    );

    const res = await request(app)
      .post('/api/forums/99/topics/44/posts')
      .send({ body: 'Reply' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 403 when replyToTopic throws a 403 AppError', async () => {
    topicSessionMock.replyToTopic.mockRejectedValue(
      new AppError(403, 'Topic is locked')
    );

    const res = await request(app)
      .post('/api/forums/9/topics/44/posts')
      .send({ body: 'Reply' });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Topic is locked');
  });
});

// ─── PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id (403) ───────────

describe('PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id', () => {
  it('allows moderators to edit another user post', async () => {
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    prismaMock.forumPost.findFirst
      .mockResolvedValueOnce(
        makeForumPost({ id: 21, authorId: 99, body: 'Old body' })
      )
      .mockResolvedValueOnce({
        ...makeForumPost({
          id: 21,
          authorId: 99,
          body: 'Edited by mod'
        }),
        edits: [
          {
            id: 8,
            forumPostId: 21,
            editorId: 7,
            editedAt: new Date('2024-03-06T00:00:00Z'),
            editor: { id: 7, username: 'testuser' }
          }
        ]
      } as never);
    updatePostMock.mockResolvedValue(
      makeForumPost({
        id: 21,
        authorId: 99,
        body: 'Edited by mod'
      }) as Awaited<ReturnType<typeof updatePost>>
    );

    const res = await request(app)
      .put('/api/forums/9/topics/44/posts/21')
      .send({ body: 'Edited by mod' });

    expect(res.status).toBe(200);
    expect(updatePostMock).toHaveBeenCalledWith(
      21,
      7,
      'Old body',
      'Edited by mod',
      44
    );
    expect(res.body.lastEdit.editor.username).toBe('testuser');
    expect(res.body.edits).toBeUndefined();
  });

  it('returns 403 when user is not the post author', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, authorId: 99 })
    );

    const res = await request(app)
      .put('/api/forums/9/topics/44/posts/21')
      .send({ body: 'Edited' });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Not authorized');
  });

  it('returns 404 when post does not exist', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/forums/9/topics/44/posts/99')
      .send({ body: 'Edited' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/forums/:forumId/topics/:forumTopicId/posts/:id ──────────────

describe('DELETE /api/forums/:forumId/topics/:forumTopicId/posts/:id — error paths', () => {
  it('returns 404 when post does not exist', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/forums/9/topics/44/posts/99');

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-owner without moderator permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, authorId: 99 })
    );

    const res = await request(app).delete('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/forums/:forumId/topics/:forumTopicId/session ────────────────────

describe('GET /api/forums/:forumId/topics/:forumTopicId/session', () => {
  const sessionPayload = {
    forum: {
      id: 9,
      name: 'Open Forum',
      forumCategoryId: 1,
      forumCategory: null
    },
    topic: makeForumTopic({ id: 44, title: 'Test Topic' }),
    posts: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
    poll: null,
    subscription: { isSubscribed: false },
    affordances: {
      canReply: true,
      canModerate: false,
      canVoteInPoll: false,
      canSubscribe: true,
      canCatchUp: true
    },
    readState: { lastVisiblePostId: null }
  };

  it('returns 200 with the session view model', async () => {
    topicSessionMock.getTopicSession.mockResolvedValue(sessionPayload as never);

    const res = await request(app).get('/api/forums/9/topics/44/session');

    expect(res.status).toBe(200);
    expect(topicSessionMock.getTopicSession).toHaveBeenCalledWith(
      9,
      44,
      expect.objectContaining({ actorId: 7 }),
      expect.objectContaining({ page: 1 })
    );
    expect(res.body.forum.name).toBe('Open Forum');
    expect(res.body.topic.title).toBe('Test Topic');
    expect(res.body.affordances.canReply).toBe(true);
    expect(res.body.subscription.isSubscribed).toBe(false);
  });

  it('returns 404 when getTopicSession throws a 404 AppError', async () => {
    topicSessionMock.getTopicSession.mockRejectedValue(
      new AppError(404, 'Topic not found')
    );

    const res = await request(app).get('/api/forums/9/topics/99/session');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Topic not found');
  });

  it('returns 403 when getTopicSession throws a 403 AppError', async () => {
    topicSessionMock.getTopicSession.mockRejectedValue(
      new AppError(403, 'Insufficient class to read this forum')
    );

    const res = await request(app).get('/api/forums/9/topics/44/session');

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Insufficient class to read this forum');
  });

  it('passes page parameter to getTopicSession', async () => {
    topicSessionMock.getTopicSession.mockResolvedValue(sessionPayload as never);

    await request(app).get('/api/forums/9/topics/44/session?page=3');

    expect(topicSessionMock.getTopicSession).toHaveBeenCalledWith(
      9,
      44,
      expect.any(Object),
      expect.objectContaining({ page: 3 })
    );
  });

  it('derives canModerateForums from the moderator permission', async () => {
    setCurrentUserPermissions(
      makeUserRank({ forums_moderate: true }).permissions as Record<
        string,
        boolean
      >
    );
    topicSessionMock.getTopicSession.mockResolvedValue(sessionPayload as never);

    await request(app).get('/api/forums/9/topics/44/session');

    expect(topicSessionMock.getTopicSession).toHaveBeenCalledWith(
      9,
      44,
      expect.objectContaining({ canModerateForums: true }),
      expect.any(Object)
    );
  });
});

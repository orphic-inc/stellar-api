import {
  request,
  app,
  prismaMock,
  makeUserRank,
  createTopicMock,
  updateTopicMock,
  createPostMock,
  updatePostMock,
  deleteTopicMock,
  deletePostMock,
  deleteForumMock,
  createTopicNoteMock,
  setCurrentUserRankLevel,
  resetApiTestState
} from './test/apiTestHarness';
import {
  makeForum,
  makeForumTopic,
  makeForumPost,
  makeForumTopicNote,
  makeForumList
} from './test/factories';
import {
  createTopic,
  updateTopic,
  createPost,
  updatePost,
  createTopicNote
} from './modules/forum';

describe('API forum flows', () => {
  beforeEach(() => {
    resetApiTestState();
  });

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
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, authorId: 7 })
    );
    updateTopicMock.mockResolvedValue({
      id: 44,
      title: 'Renamed Topic',
      isLocked: false,
      isSticky: false
    } as Awaited<ReturnType<typeof updateTopic>>);

    const res = await request(app).put('/api/forums/9/topics/44').send({
      title: 'Renamed Topic'
    });

    expect(res.status).toBe(200);
    expect(updateTopicMock).toHaveBeenCalledWith(44, {
      title: 'Renamed Topic',
      isLocked: undefined,
      isSticky: undefined
    });
    expect(res.body.title).toBe('Renamed Topic');
  });

  it('creates a forum post when the topic is unlocked and belongs to the forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(
      makeForum({ id: 9, minClassRead: 0 })
    );
    prismaMock.forumTopic.findUnique.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, isLocked: false })
    );
    createPostMock.mockResolvedValue({
      id: 21,
      forumTopicId: 44,
      authorId: 7,
      body: 'Reply body'
    } as Awaited<ReturnType<typeof createPost>>);

    const res = await request(app).post('/api/forums/9/topics/44/posts').send({
      body: 'Reply body'
    });

    expect(res.status).toBe(201);
    expect(createPostMock).toHaveBeenCalledWith(9, 44, 7, 'Reply body');
    expect(res.body.body).toBe('Reply body');
  });

  it('updates a forum post for the owner', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, forumTopicId: 44, authorId: 7, body: 'Old body' })
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
    expect(updatePostMock).toHaveBeenCalledWith(21, 7, 'Old body', 'New body');
    expect(res.body.body).toBe('New body');
  });

  it('rejects topic deletion for non-owners without moderator permissions', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, authorId: 99 })
    );

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Not authorized' });
    expect(deleteTopicMock).not.toHaveBeenCalled();
  });

  it('allows moderators to delete a forum post', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, forumTopicId: 44, authorId: 99 })
    );
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_moderate: true })
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
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_moderate: true })
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

  it('filters forum listings by the current user rank', async () => {
    setCurrentUserRankLevel(100);
    prismaMock.forum.findMany.mockResolvedValue(
      makeForumList([{ id: 1, name: 'Open Forum', minClassRead: 0 }])
    );

    const res = await request(app).get('/api/forums');

    expect(res.status).toBe(200);
    expect(prismaMock.forum.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { minClassRead: { lte: 100 } }
      })
    );
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
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_manage: true })
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
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

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
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_manage: true })
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
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .put('/api/forums/9')
      .send({ name: 'Renamed Forum' });

    expect(res.status).toBe(403);
  });
});

// ─── DELETE /api/forums/:id ───────────────────────────────────────────────────

describe('DELETE /api/forums/:id', () => {
  beforeEach(() =>
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_manage: true })
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
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

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
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, authorId: 99 })
    );

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
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, authorId: 7 })
    );
    deleteTopicMock.mockResolvedValue(undefined as never);

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(204);
    expect(deleteTopicMock).toHaveBeenCalledWith(44, 9, 7, false);
  });

  it('moderator can delete any topic', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ forums_moderate: true })
    );
    prismaMock.forumTopic.findFirst.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 9, authorId: 99 })
    );
    deleteTopicMock.mockResolvedValue(undefined as never);

    const res = await request(app).delete('/api/forums/9/topics/44');

    expect(res.status).toBe(204);
    expect(deleteTopicMock).toHaveBeenCalledWith(44, 9, 7, true);
  });

  it('returns 404 when topic does not exist', async () => {
    prismaMock.forumTopic.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/forums/9/topics/99');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/forums/:forumId/topics/:forumTopicId/posts ─────────────────────

describe('GET /api/forums/:forumId/topics/:forumTopicId/posts', () => {
  it('returns paginated list of posts', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumPost.findMany.mockResolvedValue([
      makeForumPost({ id: 21, body: 'Post body' })
    ]);
    prismaMock.forumPost.count.mockResolvedValue(1);

    const res = await request(app).get('/api/forums/9/topics/44/posts');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
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
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makeForumPost({ id: 21, body: 'Post body' })
    );

    const res = await request(app).get('/api/forums/9/topics/44/posts/21');

    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Post body');
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

// ─── POST /api/forums/:forumId/topics/:forumTopicId/posts (error paths) ──────

describe('POST /api/forums/:forumId/topics/:forumTopicId/posts — error paths', () => {
  it('returns 404 when forum does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(null);
    prismaMock.forumTopic.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/forums/99/topics/44/posts')
      .send({ body: 'Reply' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum not found');
  });

  it('returns 404 when topic does not exist', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/forums/9/topics/99/posts')
      .send({ body: 'Reply' });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Forum topic not found');
  });

  it('returns 403 when topic belongs to a different forum', async () => {
    prismaMock.forum.findUnique.mockResolvedValue(makeForum({ id: 9 }));
    prismaMock.forumTopic.findUnique.mockResolvedValue(
      makeForumTopic({ id: 44, forumId: 99 })
    );

    const res = await request(app)
      .post('/api/forums/9/topics/44/posts')
      .send({ body: 'Reply' });

    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id (403) ───────────

describe('PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id — 403', () => {
  it('returns 403 when user is not the post author', async () => {
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

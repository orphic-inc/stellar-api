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

import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions,
  createPollMock,
  closePollMock,
  topicSessionMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

const setForumAdmin = () =>
  setCurrentUserPermissions(
    makeUserRank({
      forums_manage: true,
      staff: true
    }).permissions as Record<string, boolean>
  );

// ═══════════════════════════════════════════════════════════════════════════════
// Forum Categories
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/forums/categories', () => {
  it('returns categories filtered to accessible forums', async () => {
    prismaMock.forumCategory.findMany.mockResolvedValue([
      { id: 1, name: 'General', sort: 0, forums: [{ id: 10 }] }
    ] as never);

    const res = await request(app).get('/api/forums/categories');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('General');
  });

  it('excludes categories with no accessible forums', async () => {
    prismaMock.forumCategory.findMany.mockResolvedValue([
      { id: 1, name: 'Hidden', sort: 0, forums: [] }
    ] as never);

    const res = await request(app).get('/api/forums/categories');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns all categories when ?all=true is passed', async () => {
    setForumAdmin();
    prismaMock.forumCategory.findMany.mockResolvedValue([
      { id: 1, name: 'Hidden', sort: 0, forums: [] }
    ] as never);

    const res = await request(app).get('/api/forums/categories?all=true');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/forums/categories/:id', () => {
  it('returns a single category with accessible forums', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue({
      id: 1,
      name: 'General',
      sort: 0,
      forums: [{ id: 10, name: 'News' }]
    } as never);

    const res = await request(app).get('/api/forums/categories/1');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('General');
  });

  it('returns 404 when the category does not exist', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/categories/99');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Category not found');
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/forums/categories/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/forums/categories', () => {
  beforeEach(() => setForumAdmin());

  it('creates a category and returns 201', async () => {
    prismaMock.forumCategory.create.mockResolvedValue({
      id: 2,
      name: 'Off-Topic',
      sort: 10
    } as never);

    const res = await request(app)
      .post('/api/forums/categories')
      .send({ name: 'Off-Topic', sort: 10 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Off-Topic');
  });

  it('creates a category with default sort when sort is omitted', async () => {
    prismaMock.forumCategory.create.mockResolvedValue({
      id: 3,
      name: 'News',
      sort: 0
    } as never);

    const res = await request(app)
      .post('/api/forums/categories')
      .send({ name: 'News' });

    expect(res.status).toBe(201);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/forums/categories')
      .send({ sort: 5 });
    expect(res.status).toBe(400);
  });

  it('returns 403 without forums_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app)
      .post('/api/forums/categories')
      .send({ name: 'New' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/forums/categories/:id', () => {
  beforeEach(() => setForumAdmin());

  it('updates a category and returns it', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue({
      id: 1,
      name: 'Old'
    } as never);
    prismaMock.forumCategory.update.mockResolvedValue({
      id: 1,
      name: 'New Name',
      sort: 5
    } as never);

    const res = await request(app)
      .put('/api/forums/categories/1')
      .send({ name: 'New Name', sort: 5 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('returns 404 when the category does not exist', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/forums/categories/99')
      .send({ name: 'New Name' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/forums/categories/:id', () => {
  beforeEach(() => setForumAdmin());

  it('deletes a category and returns 204', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue({
      id: 1,
      name: 'Trash'
    } as never);
    prismaMock.forumCategory.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/forums/categories/1');

    expect(res.status).toBe(204);
  });

  it('returns 404 when the category does not exist', async () => {
    prismaMock.forumCategory.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/forums/categories/99');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Forum Last-Read Topics
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/forums/last-read', () => {
  it('returns last-read markers for the current user', async () => {
    prismaMock.forumLastReadTopic.findMany.mockResolvedValue([
      { userId: 7, forumTopicId: 10, forumPostId: 42 }
    ] as never);

    const res = await request(app).get('/api/forums/last-read');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].forumTopicId).toBe(10);
  });
});

describe('POST /api/forums/last-read', () => {
  const makePost = (overrides = {}) => ({
    id: 42,
    forumTopicId: 10,
    deletedAt: null,
    forumTopic: {
      deletedAt: null,
      forum: { minClassRead: 0 }
    },
    ...overrides
  });

  it('upserts a last-read marker and returns it', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(makePost() as never);
    prismaMock.forumLastReadTopic.upsert.mockResolvedValue({
      userId: 7,
      forumTopicId: 10,
      forumPostId: 42
    } as never);

    const res = await request(app)
      .post('/api/forums/last-read')
      .send({ forumTopicId: 10, forumPostId: 42 });

    expect(res.status).toBe(200);
    expect(res.body.forumPostId).toBe(42);
  });

  it('returns 404 when the post does not exist', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/forums/last-read')
      .send({ forumTopicId: 10, forumPostId: 99 });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user rank is below forum minClassRead', async () => {
    prismaMock.forumPost.findFirst.mockResolvedValue(
      makePost({
        forumTopic: { deletedAt: null, forum: { minClassRead: 9000 } }
      }) as never
    );

    const res = await request(app)
      .post('/api/forums/last-read')
      .send({ forumTopicId: 10, forumPostId: 42 });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/forums/last-read')
      .send({ forumTopicId: 10 });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Forum Polls
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/forums/polls/:topicId', () => {
  const makePoll = (overrides = {}) => ({
    id: 1,
    forumTopicId: 10,
    question: 'Favourite genre?',
    answers: '["Jazz","Rock"]',
    closed: false,
    votes: [],
    forumTopic: {
      deletedAt: null,
      forum: { minClassRead: 0 }
    },
    ...overrides
  });

  it('returns the poll for a topic', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(makePoll() as never);

    const res = await request(app).get('/api/forums/polls/10');

    expect(res.status).toBe(200);
    expect(res.body.question).toBe('Favourite genre?');
  });

  it('returns 404 when the poll does not exist', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/forums/polls/99');

    expect(res.status).toBe(404);
  });

  it('returns 404 when the topic is deleted', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(
      makePoll({
        forumTopic: { deletedAt: new Date(), forum: { minClassRead: 0 } }
      }) as never
    );

    const res = await request(app).get('/api/forums/polls/10');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user rank is below forum minClassRead', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(
      makePoll({
        forumTopic: { deletedAt: null, forum: { minClassRead: 9000 } }
      }) as never
    );

    const res = await request(app).get('/api/forums/polls/10');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/forums/polls', () => {
  it('creates a poll when the user is the topic author', async () => {
    prismaMock.forumTopic.findUnique.mockResolvedValue({
      id: 10,
      authorId: 7, // matches TEST_USER_ID
      deletedAt: null
    } as never);
    createPollMock.mockResolvedValue({
      id: 5,
      forumTopicId: 10,
      question: 'Best album?',
      answers: '["A","B"]',
      closed: false
    } as never);

    const res = await request(app).post('/api/forums/polls').send({
      forumTopicId: 10,
      question: 'Best album?',
      answers: 'A\nB'
    });

    expect(res.status).toBe(201);
    expect(res.body.question).toBe('Best album?');
  });

  it('returns 404 when the topic does not exist', async () => {
    prismaMock.forumTopic.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/forums/polls').send({
      forumTopicId: 99,
      question: 'Best album?',
      answers: 'A\nB'
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user is not the author or a moderator', async () => {
    prismaMock.forumTopic.findUnique.mockResolvedValue({
      id: 10,
      authorId: 99, // different user
      deletedAt: null
    } as never);
    // permission check: default rank has no forums_moderate flag
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).post('/api/forums/polls').send({
      forumTopicId: 10,
      question: 'Best album?',
      answers: 'A\nB'
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/forums/polls')
      .send({ forumTopicId: 10 });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/forums/polls/:id/close', () => {
  it('closes a poll when the user is the topic author', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      id: 5,
      forumTopic: { authorId: 7 }
    } as never);
    closePollMock.mockResolvedValue({
      id: 5,
      closed: true
    } as never);

    const res = await request(app).put('/api/forums/polls/5/close');

    expect(res.status).toBe(200);
    expect(res.body.closed).toBe(true);
  });

  it('returns 404 when the poll does not exist', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue(null);

    const res = await request(app).put('/api/forums/polls/99/close');

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user is not the topic author or moderator', async () => {
    prismaMock.forumPoll.findUnique.mockResolvedValue({
      id: 5,
      forumTopic: { authorId: 99 }
    } as never);
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app).put('/api/forums/polls/5/close');

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Poll Votes
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/forums/poll-votes', () => {
  it('casts a vote and returns it', async () => {
    topicSessionMock.voteTopicPoll.mockResolvedValue({
      ok: true,
      vote: { forumPollId: 5, userId: 7, vote: 1 }
    } as never);

    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 5, vote: 1 });

    expect(res.status).toBe(200);
    expect(res.body.vote).toBe(1);
  });

  it('returns 404 when the poll is not found', async () => {
    topicSessionMock.voteTopicPoll.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    } as never);

    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 99, vote: 0 });

    expect(res.status).toBe(404);
  });

  it('returns 403 when class is insufficient', async () => {
    topicSessionMock.voteTopicPoll.mockResolvedValue({
      ok: false,
      reason: 'insufficient_class'
    } as never);

    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 5, vote: 0 });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Insufficient class to read this forum');
  });

  it('returns 403 when the poll is closed', async () => {
    topicSessionMock.voteTopicPoll.mockResolvedValue({
      ok: false,
      reason: 'closed'
    } as never);

    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 5, vote: 0 });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Poll is closed');
  });

  it('returns 400 for any other failure reason', async () => {
    topicSessionMock.voteTopicPoll.mockResolvedValue({
      ok: false,
      reason: 'already_voted'
    } as never);

    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 5, vote: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/forums/poll-votes')
      .send({ forumPollId: 5 });
    expect(res.status).toBe(400);
  });
});

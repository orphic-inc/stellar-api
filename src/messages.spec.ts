import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  pmMock
} from './test/apiTestHarness';

const PAGED_EMPTY = { total: 0, page: 1, pageSize: 25, conversations: [] };

const makeConversation = () => ({
  id: 1,
  subject: 'Hello',
  createdAt: new Date(),
  updatedAt: new Date(),
  participants: [],
  messages: []
});

const makeMessage = () => ({
  id: 10,
  conversationId: 1,
  senderId: 7,
  body: 'Hey there',
  createdAt: new Date(),
  sender: { id: 7, username: 'testuser', avatar: null }
});

describe('GET /api/messages', () => {
  beforeEach(() => resetApiTestState());

  it('returns inbox with search forwarded to module', async () => {
    pmMock.listInbox.mockResolvedValue(PAGED_EMPTY);
    await request(app).get('/api/messages?page=2&search=hi');
    expect(pmMock.listInbox).toHaveBeenCalledWith(7, 2, 'hi');
  });
});

describe('GET /api/messages/unread-count', () => {
  beforeEach(() => resetApiTestState());

  it('returns count', async () => {
    pmMock.getUnreadCount.mockResolvedValue(3);
    const res = await request(app).get('/api/messages/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });
});

describe('GET /api/messages/sent', () => {
  beforeEach(() => resetApiTestState());

  it('returns sentbox', async () => {
    pmMock.listSentbox.mockResolvedValue(PAGED_EMPTY);
    const res = await request(app).get('/api/messages/sent');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/messages', () => {
  beforeEach(() => resetApiTestState());

  const payload = { toUserId: 99, subject: 'Hi', body: 'Hello!' };

  it('returns 201 on success', async () => {
    pmMock.sendMessage.mockResolvedValue({
      ok: true,
      conversation: makeConversation()
    });
    const res = await request(app).post('/api/messages').send(payload);
    expect(res.status).toBe(201);
  });

  it('maps self_message to 400 and recipient_not_found to 404', async () => {
    pmMock.sendMessage.mockResolvedValue({ ok: false, reason: 'self_message' });
    expect(
      (await request(app).post('/api/messages').send(payload)).status
    ).toBe(400);

    pmMock.sendMessage.mockResolvedValue({
      ok: false,
      reason: 'recipient_not_found'
    });
    expect(
      (await request(app).post('/api/messages').send(payload)).status
    ).toBe(404);
  });

  it('looks up recipient by username when toUserId is omitted', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 99 } as never);
    pmMock.sendMessage.mockResolvedValue({
      ok: true,
      conversation: makeConversation()
    });
    const res = await request(app)
      .post('/api/messages')
      .send({ toUsername: 'alice', subject: 'Hi', body: 'Hello!' });
    expect(res.status).toBe(201);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: { equals: 'alice', mode: 'insensitive' } }
      })
    );
  });

  it('returns 404 when toUsername is provided but user is not found', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/messages')
      .send({ toUsername: 'ghost', subject: 'Hi', body: 'Hello!' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/messages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns conversation', async () => {
    pmMock.viewConversation.mockResolvedValue({
      ok: true,
      conversation: makeConversation()
    });
    const res = await request(app).get('/api/messages/1');
    expect(res.status).toBe(200);
    expect(pmMock.viewConversation).toHaveBeenCalledWith(1, 7);
  });

  it('returns 404 when not found', async () => {
    pmMock.viewConversation.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    expect((await request(app).get('/api/messages/99')).status).toBe(404);
  });
});

describe('POST /api/messages/:id/reply', () => {
  beforeEach(() => resetApiTestState());

  it('returns 201 on success and 403 when not a participant', async () => {
    pmMock.replyToConversation.mockResolvedValue({
      ok: true,
      message: makeMessage()
    });
    expect(
      (await request(app).post('/api/messages/1/reply').send({ body: 'yo' }))
        .status
    ).toBe(201);

    pmMock.replyToConversation.mockResolvedValue({
      ok: false,
      reason: 'not_participant'
    });
    expect(
      (await request(app).post('/api/messages/1/reply').send({ body: 'yo' }))
        .status
    ).toBe(403);
  });
});

describe('PATCH /api/messages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 on success and 404 when not found', async () => {
    pmMock.updateConversationFlags.mockResolvedValue({ ok: true });
    expect(
      (await request(app).patch('/api/messages/1').send({ isSticky: true }))
        .status
    ).toBe(204);

    pmMock.updateConversationFlags.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    expect(
      (await request(app).patch('/api/messages/1').send({ isSticky: true }))
        .status
    ).toBe(404);
  });
});

describe('DELETE /api/messages/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 on success and 404 when not found', async () => {
    pmMock.deleteConversation.mockResolvedValue({ ok: true });
    expect((await request(app).delete('/api/messages/1')).status).toBe(204);

    pmMock.deleteConversation.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    expect((await request(app).delete('/api/messages/99')).status).toBe(404);
  });
});

describe('POST /api/messages/bulk', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 and delegates to module', async () => {
    pmMock.bulkUpdateConversations.mockResolvedValue({ ok: true });
    const res = await request(app)
      .post('/api/messages/bulk')
      .send({ ids: [1, 2], action: 'markRead' });
    expect(res.status).toBe(204);
    expect(pmMock.bulkUpdateConversations).toHaveBeenCalledWith(
      7,
      [1, 2],
      'markRead'
    );
  });
});

// ─── PM drafts ────────────────────────────────────────────────────────────────

const makeDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 7,
  toUserId: null,
  subject: 'Draft subject',
  body: 'Draft body',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

describe('GET /api/messages/drafts', () => {
  beforeEach(() => resetApiTestState());

  it('returns the list of drafts for the current user', async () => {
    prismaMock.pmDraft.findMany.mockResolvedValue([makeDraft()] as never);

    const res = await request(app).get('/api/messages/drafts');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].subject).toBe('Draft subject');
  });
});

describe('POST /api/messages/drafts', () => {
  beforeEach(() => resetApiTestState());

  it('creates a draft and returns 201', async () => {
    const draft = makeDraft({ subject: 'Hello', body: 'World' });
    prismaMock.pmDraft.create.mockResolvedValue(draft as never);

    const res = await request(app)
      .post('/api/messages/drafts')
      .send({ subject: 'Hello', body: 'World' });

    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('Hello');
  });

  it('returns 400 when subject or body is missing', async () => {
    const res = await request(app)
      .post('/api/messages/drafts')
      .send({ subject: 'Only subject' });

    expect(res.status).toBe(400);
    expect(prismaMock.pmDraft.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/messages/drafts/:id', () => {
  beforeEach(() => resetApiTestState());

  it('updates the draft and returns it', async () => {
    const updated = makeDraft({ subject: 'Updated', body: 'New body' });
    prismaMock.pmDraft.findFirst.mockResolvedValue(makeDraft() as never);
    prismaMock.pmDraft.update.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/messages/drafts/1')
      .send({ subject: 'Updated', body: 'New body' });

    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Updated');
  });

  it('returns 404 when the draft does not belong to the current user', async () => {
    prismaMock.pmDraft.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/messages/drafts/1')
      .send({ subject: 'S', body: 'B' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/messages/drafts/:id', () => {
  beforeEach(() => resetApiTestState());

  it('deletes the draft and returns 204', async () => {
    prismaMock.pmDraft.findFirst.mockResolvedValue(makeDraft() as never);
    prismaMock.pmDraft.delete.mockResolvedValue(makeDraft() as never);

    const res = await request(app).delete('/api/messages/drafts/1');

    expect(res.status).toBe(204);
    expect(prismaMock.pmDraft.delete).toHaveBeenCalledWith({
      where: { id: 1 }
    });
  });

  it('returns 404 when the draft does not belong to the current user', async () => {
    prismaMock.pmDraft.findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/messages/drafts/99');

    expect(res.status).toBe(404);
  });
});

// ─── Mass PM ──────────────────────────────────────────────────────────────────

describe('POST /api/messages/mass', () => {
  beforeEach(() => {
    resetApiTestState();
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ staff: true })
    );
  });

  it('sends mass PM to all non-disabled users and records the send count', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 8 } as never,
      { id: 9 } as never
    ]);
    prismaMock.privateConversation.create.mockResolvedValue({} as never);
    prismaMock.massMessage.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/messages/mass')
      .send({ subject: 'Announcement', body: 'Site maintenance tonight.' });

    expect(res.status).toBe(200);
    expect(res.body.sentCount).toBe(2);
    expect(prismaMock.massMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sentCount: 2 })
      })
    );
  });

  it('returns 403 without staff permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .post('/api/messages/mass')
      .send({ subject: 'S', body: 'B' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when subject or body is missing', async () => {
    const res = await request(app)
      .post('/api/messages/mass')
      .send({ subject: 'Missing body' });

    expect(res.status).toBe(400);
  });
});

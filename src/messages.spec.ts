import {
  request,
  app,
  resetApiTestState,
  pmMock,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

const PAGED_EMPTY = { total: 0, page: 1, pageSize: 25, conversations: [] };

const makeConversation = (isTicket = false) => ({
  id: 1,
  subject: 'Hello',
  isStaffTicket: isTicket,
  ticketStatus: isTicket ? ('Unanswered' as const) : null,
  assignedStaffId: null,
  assignedStaff: null,
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
    expect(pmMock.viewConversation).toHaveBeenCalledWith(1, 7, false);
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

// ─── Ticket endpoints ─────────────────────────────────────────────────────────

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true })
  );

describe('GET /api/messages/tickets', () => {
  beforeEach(() => resetApiTestState());

  it('returns user tickets', async () => {
    pmMock.listMyTickets.mockResolvedValue(PAGED_EMPTY);
    const res = await request(app).get('/api/messages/tickets');
    expect(res.status).toBe(200);
    expect(pmMock.listMyTickets).toHaveBeenCalledWith(7, 1);
  });
});

describe('POST /api/messages/tickets', () => {
  beforeEach(() => resetApiTestState());

  it('creates ticket and returns 201', async () => {
    pmMock.createTicket.mockResolvedValue(makeConversation(true));
    const res = await request(app)
      .post('/api/messages/tickets')
      .send({ subject: 'Help', body: 'Need help.' });
    expect(res.status).toBe(201);
    expect(pmMock.createTicket).toHaveBeenCalledWith(7, 'Help', 'Need help.');
  });
});

describe('GET /api/messages/ticket-queue', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    expect((await request(app).get('/api/messages/ticket-queue')).status).toBe(
      403
    );
  });

  it('returns queue for staff', async () => {
    setStaff();
    pmMock.listTicketQueue.mockResolvedValue(PAGED_EMPTY);
    const res = await request(app).get(
      '/api/messages/ticket-queue?status=Open'
    );
    expect(res.status).toBe(200);
    expect(pmMock.listTicketQueue).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Open', staffUserId: 7 })
    );
  });
});

describe('POST /api/messages/:id/resolve', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 on success and 422 when already resolved', async () => {
    pmMock.resolveTicket.mockResolvedValue({ ok: true });
    expect((await request(app).post('/api/messages/1/resolve')).status).toBe(
      204
    );

    pmMock.resolveTicket.mockResolvedValue({
      ok: false,
      reason: 'already_resolved'
    });
    expect((await request(app).post('/api/messages/1/resolve')).status).toBe(
      422
    );
  });
});

describe('POST /api/messages/:id/unresolve', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission and 204 for staff', async () => {
    expect((await request(app).post('/api/messages/1/unresolve')).status).toBe(
      403
    );

    setStaff();
    pmMock.unresolveTicket.mockResolvedValue({ ok: true });
    expect((await request(app).post('/api/messages/1/unresolve')).status).toBe(
      204
    );
  });
});

describe('POST /api/messages/:id/assign', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    expect(
      (
        await request(app)
          .post('/api/messages/1/assign')
          .send({ assignedUserId: 5 })
      ).status
    ).toBe(403);
  });

  it('returns 204 on success and 422 when assignee is not staff', async () => {
    setStaff();
    pmMock.assignTicket.mockResolvedValue({ ok: true });
    expect(
      (
        await request(app)
          .post('/api/messages/1/assign')
          .send({ assignedUserId: 5 })
      ).status
    ).toBe(204);

    pmMock.assignTicket.mockResolvedValue({
      ok: false,
      reason: 'assignee_not_staff'
    });
    expect(
      (
        await request(app)
          .post('/api/messages/1/assign')
          .send({ assignedUserId: 99 })
      ).status
    ).toBe(422);
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

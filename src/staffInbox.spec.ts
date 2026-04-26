import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  staffInboxMock
} from './test/apiTestHarness';

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue({
    permissions: { staff: true }
  });

const PAGED_EMPTY = { total: 0, page: 1, pageSize: 25, conversations: [] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeTicket = (overrides: Record<string, unknown> = {}): any => ({
  id: 1,
  userId: 7,
  subject: 'Help please',
  status: 'Unanswered',
  assignedUserId: null,
  resolverId: null,
  isReadByUser: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: { id: 7, username: 'testuser', avatar: null },
  assignedUser: null,
  resolver: null,
  messages: [],
  ...overrides
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeResponse = (overrides: Record<string, unknown> = {}): any => ({
  id: 1,
  name: 'Standard reply',
  body: 'Thank you for contacting support.',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeMessage = (): any => ({
  id: 10,
  conversationId: 1,
  senderId: 7,
  body: 'Here is my reply',
  createdAt: new Date(),
  sender: { id: 7, username: 'testuser', avatar: null }
});

// ─── Staff ticket list ────────────────────────────────────────────────────────

describe('GET /api/staff-inbox', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    expect((await request(app).get('/api/staff-inbox')).status).toBe(403);
  });

  it('returns ticket list for staff', async () => {
    setStaff();
    staffInboxMock.listStaffTickets.mockResolvedValue({
      ...PAGED_EMPTY,
      conversations: [makeTicket()]
    });
    const res = await request(app).get('/api/staff-inbox?status=Open');
    expect(res.status).toBe(200);
    expect(staffInboxMock.listStaffTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Open', staffUserId: 7 })
    );
  });
});

// ─── Staff unread count ───────────────────────────────────────────────────────

describe('GET /api/staff-inbox/unread-count', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    expect(
      (await request(app).get('/api/staff-inbox/unread-count')).status
    ).toBe(403);
  });

  it('returns count for staff', async () => {
    setStaff();
    staffInboxMock.getStaffUnreadCount.mockResolvedValue(5);
    const res = await request(app).get('/api/staff-inbox/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
  });
});

// ─── User's own tickets ───────────────────────────────────────────────────────

describe('GET /api/staff-inbox/mine', () => {
  beforeEach(() => resetApiTestState());

  it('returns paginated list for authenticated user', async () => {
    staffInboxMock.listMyTickets.mockResolvedValue({
      ...PAGED_EMPTY,
      conversations: [makeTicket()]
    });
    const res = await request(app).get('/api/staff-inbox/mine');
    expect(res.status).toBe(200);
    expect(staffInboxMock.listMyTickets).toHaveBeenCalledWith(7, 1);
  });
});

// ─── Create ticket ────────────────────────────────────────────────────────────

describe('POST /api/staff-inbox', () => {
  beforeEach(() => resetApiTestState());

  it('creates ticket and returns 201', async () => {
    staffInboxMock.createTicket.mockResolvedValue(makeTicket());
    const res = await request(app)
      .post('/api/staff-inbox')
      .send({ subject: 'Help', body: 'I need help please.' });
    expect(res.status).toBe(201);
    expect(staffInboxMock.createTicket).toHaveBeenCalledWith(
      7,
      'Help',
      'I need help please.'
    );
  });
});

// ─── View ticket ─────────────────────────────────────────────────────────────

describe('GET /api/staff-inbox/:id', () => {
  beforeEach(() => resetApiTestState());

  it('calls viewTicket with staffAccess=false for regular user', async () => {
    staffInboxMock.viewTicket.mockResolvedValue({
      ok: true,
      conversation: makeTicket()
    });
    await request(app).get('/api/staff-inbox/1');
    expect(staffInboxMock.viewTicket).toHaveBeenCalledWith(1, 7, false);
  });

  it('calls viewTicket with staffAccess=true for staff', async () => {
    setStaff();
    staffInboxMock.viewTicket.mockResolvedValue({
      ok: true,
      conversation: makeTicket()
    });
    await request(app).get('/api/staff-inbox/1');
    expect(staffInboxMock.viewTicket).toHaveBeenCalledWith(1, 7, true);
  });

  it('returns 403 and 404 for respective failure reasons', async () => {
    staffInboxMock.viewTicket.mockResolvedValue({
      ok: false,
      reason: 'forbidden'
    });
    expect((await request(app).get('/api/staff-inbox/1')).status).toBe(403);

    staffInboxMock.viewTicket.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    expect((await request(app).get('/api/staff-inbox/99')).status).toBe(404);
  });
});

// ─── Reply to ticket ─────────────────────────────────────────────────────────

describe('POST /api/staff-inbox/:id/reply', () => {
  beforeEach(() => resetApiTestState());

  it('returns 201 on success and 422 when resolved', async () => {
    staffInboxMock.replyToTicket.mockResolvedValue({
      ok: true,
      message: makeMessage()
    });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/1/reply')
          .send({ body: 'On it.' })
      ).status
    ).toBe(201);

    staffInboxMock.replyToTicket.mockResolvedValue({
      ok: false,
      reason: 'resolved'
    });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/1/reply')
          .send({ body: 'Late.' })
      ).status
    ).toBe(422);
  });
});

// ─── Resolve / unresolve ──────────────────────────────────────────────────────

describe('POST /api/staff-inbox/:id/resolve', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 on success and 422 when already resolved', async () => {
    staffInboxMock.resolveTicket.mockResolvedValue({ ok: true });
    expect((await request(app).post('/api/staff-inbox/1/resolve')).status).toBe(
      204
    );

    staffInboxMock.resolveTicket.mockResolvedValue({
      ok: false,
      reason: 'already_resolved'
    });
    expect((await request(app).post('/api/staff-inbox/1/resolve')).status).toBe(
      422
    );
  });
});

describe('POST /api/staff-inbox/:id/unresolve', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission and 204 for staff', async () => {
    expect(
      (await request(app).post('/api/staff-inbox/1/unresolve')).status
    ).toBe(403);

    setStaff();
    staffInboxMock.unresolveTicket.mockResolvedValue({ ok: true });
    expect(
      (await request(app).post('/api/staff-inbox/1/unresolve')).status
    ).toBe(204);
  });
});

// ─── Assign ───────────────────────────────────────────────────────────────────

describe('POST /api/staff-inbox/:id/assign', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/1/assign')
          .send({ assignedUserId: 5 })
      ).status
    ).toBe(403);
  });

  it('returns 204 on success and 422 when assignee is not staff', async () => {
    setStaff();
    staffInboxMock.assignTicket.mockResolvedValue({ ok: true });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/1/assign')
          .send({ assignedUserId: 5 })
      ).status
    ).toBe(204);

    staffInboxMock.assignTicket.mockResolvedValue({
      ok: false,
      reason: 'assignee_not_staff'
    });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/1/assign')
          .send({ assignedUserId: 99 })
      ).status
    ).toBe(422);
  });
});

// ─── Canned responses ─────────────────────────────────────────────────────────

describe('GET /api/staff-inbox/responses', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission and list for staff', async () => {
    expect((await request(app).get('/api/staff-inbox/responses')).status).toBe(
      403
    );

    setStaff();
    staffInboxMock.listResponses.mockResolvedValue([makeResponse()]);
    const res = await request(app).get('/api/staff-inbox/responses');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/staff-inbox/responses', () => {
  beforeEach(() => resetApiTestState());

  it('creates response and returns 201', async () => {
    setStaff();
    staffInboxMock.createResponse.mockResolvedValue(makeResponse());
    const res = await request(app).post('/api/staff-inbox/responses').send({
      name: 'Standard reply',
      body: 'Thank you for contacting support.'
    });
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/staff-inbox/responses/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 200 on success', async () => {
    setStaff();
    staffInboxMock.updateResponse.mockResolvedValue({
      ok: true,
      response: makeResponse({ name: 'Updated' })
    });
    const res = await request(app)
      .put('/api/staff-inbox/responses/1')
      .send({ name: 'Updated', body: 'Body.' });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    setStaff();
    staffInboxMock.updateResponse.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    const res = await request(app)
      .put('/api/staff-inbox/responses/99')
      .send({ name: 'x', body: 'y' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/staff-inbox/responses/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns 204 on success and 404 when not found', async () => {
    setStaff();
    staffInboxMock.deleteResponse.mockResolvedValue({ ok: true });
    expect(
      (await request(app).delete('/api/staff-inbox/responses/1')).status
    ).toBe(204);

    staffInboxMock.deleteResponse.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });
    expect(
      (await request(app).delete('/api/staff-inbox/responses/99')).status
    ).toBe(404);
  });
});

// ─── Bulk resolve ─────────────────────────────────────────────────────────────

describe('POST /api/staff-inbox/bulk-resolve', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff and resolved count for staff', async () => {
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/bulk-resolve')
          .send({ ids: [1, 2] })
      ).status
    ).toBe(403);

    setStaff();
    staffInboxMock.bulkResolveTickets.mockResolvedValue({
      ok: true as const,
      resolved: 2
    });
    const res = await request(app)
      .post('/api/staff-inbox/bulk-resolve')
      .send({ ids: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(2);
  });
});

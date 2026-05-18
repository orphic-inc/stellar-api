import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  staffInboxMock,
  staffPmMock
} from './test/apiTestHarness';
import type { StaffResponse } from './modules/staffInbox';
import type { StaffInboxStatus } from '@prisma/client';

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true })
  );

const makeResponse = (
  overrides: Partial<StaffResponse> = {}
): StaffResponse => ({
  id: 1,
  name: 'Standard reply',
  body: 'Thank you for contacting support.',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

const makeTicket = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 1,
    subject: 'Need help',
    status: 'Unanswered' as StaffInboxStatus,
    isReadByUser: false,
    updatedAt: new Date(),
    user: { id: 7, username: 'regular', avatar: null },
    assignedUser: null,
    resolver: null,
    messages: [],
    ...overrides
  }) as never;

// ─── Canned responses ─────────────────────────────────────────────────────────

describe('GET /api/staff-inbox/responses', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    const res = await request(app).get('/api/staff-inbox/responses');
    expect(res.status).toBe(403);
  });

  it('returns list for staff', async () => {
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

// ─── Tickets ─────────────────────────────────────────────────────────────────

describe('POST /api/staff-inbox/tickets', () => {
  beforeEach(() => resetApiTestState());

  it('creates a ticket for the authenticated user', async () => {
    staffPmMock.createTicket.mockResolvedValue(makeTicket());

    const res = await request(app).post('/api/staff-inbox/tickets').send({
      subject: 'Need help',
      body: 'Please assist.'
    });

    expect(res.status).toBe(201);
    expect(staffPmMock.createTicket).toHaveBeenCalledWith(
      7,
      'Need help',
      'Please assist.'
    );
  });

  it('rejects missing subject/body with 400', async () => {
    const res = await request(app).post('/api/staff-inbox/tickets').send({
      subject: '',
      body: ''
    });

    expect(res.status).toBe(400);
    expect(staffPmMock.createTicket).not.toHaveBeenCalled();
  });
});

describe('GET /api/staff-inbox/tickets', () => {
  beforeEach(() => resetApiTestState());

  it('returns the current user ticket list', async () => {
    staffPmMock.listMyTickets.mockResolvedValue({
      total: 1,
      page: 2,
      pageSize: 25,
      conversations: [makeTicket()]
    });

    const res = await request(app).get('/api/staff-inbox/tickets?page=2');

    expect(res.status).toBe(200);
    expect(staffPmMock.listMyTickets).toHaveBeenCalledWith(7, 2);
    expect(res.body.total).toBe(1);
  });
});

describe('GET /api/staff-inbox/queue', () => {
  beforeEach(() => resetApiTestState());

  it('returns 403 without staff permission', async () => {
    const res = await request(app).get('/api/staff-inbox/queue');
    expect(res.status).toBe(403);
  });

  it('passes filters through for staff', async () => {
    setStaff();
    staffPmMock.listQueue.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 25,
      conversations: [makeTicket({ assignedUser: { id: 9, username: 'mod' } })]
    });

    const res = await request(app).get(
      '/api/staff-inbox/queue?status=Open&assignedToMe=true&unassigned=false'
    );

    expect(res.status).toBe(200);
    expect(staffPmMock.listQueue).toHaveBeenCalledWith({
      page: 1,
      status: 'Open',
      assignedToMe: true,
      unassigned: false,
      staffUserId: 7
    });
  });
});

describe('GET /api/staff-inbox/queue/count', () => {
  beforeEach(() => resetApiTestState());

  it('returns unresolved queue count for staff', async () => {
    setStaff();
    staffPmMock.getQueueCount.mockResolvedValue(3);

    const res = await request(app).get('/api/staff-inbox/queue/count');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
  });

  it('returns 403 without staff permission', async () => {
    const res = await request(app).get('/api/staff-inbox/queue/count');

    expect(res.status).toBe(403);
    expect(staffPmMock.getQueueCount).not.toHaveBeenCalled();
  });
});

describe('GET /api/staff-inbox/tickets/:id', () => {
  beforeEach(() => resetApiTestState());

  it('returns the ticket when visible to the caller', async () => {
    staffPmMock.viewTicket.mockResolvedValue({
      ok: true,
      ticket: makeTicket({ messages: [{ id: 11, body: 'Hello' }] })
    });

    const res = await request(app).get('/api/staff-inbox/tickets/1');

    expect(res.status).toBe(200);
    expect(staffPmMock.viewTicket).toHaveBeenCalledWith(1, 7, false);
  });

  it('treats staff viewers as moderators', async () => {
    setStaff();
    staffPmMock.viewTicket.mockResolvedValue({
      ok: true,
      ticket: makeTicket()
    });

    const res = await request(app).get('/api/staff-inbox/tickets/1');

    expect(res.status).toBe(200);
    expect(staffPmMock.viewTicket).toHaveBeenCalledWith(1, 7, true);
  });

  it('returns 404 when the ticket is not visible', async () => {
    staffPmMock.viewTicket.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });

    const res = await request(app).get('/api/staff-inbox/tickets/99');

    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid ticket id', async () => {
    const res = await request(app).get('/api/staff-inbox/tickets/nope');

    expect(res.status).toBe(400);
    expect(staffPmMock.viewTicket).not.toHaveBeenCalled();
  });
});

describe('POST /api/staff-inbox/tickets/:id/reply', () => {
  beforeEach(() => resetApiTestState());

  it('creates a reply for the current user', async () => {
    staffPmMock.replyToTicket.mockResolvedValue({
      ok: true,
      message: {
        id: 2,
        conversationId: 1,
        senderId: 7,
        body: 'Reply',
        createdAt: new Date(),
        sender: { id: 7, username: 'regular', avatar: null }
      }
    });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/reply')
      .send({ body: 'Reply' });

    expect(res.status).toBe(201);
    expect(staffPmMock.replyToTicket).toHaveBeenCalledWith(
      1,
      7,
      'Reply',
      false
    );
  });

  it('maps forbidden and resolved replies to 403 and 422', async () => {
    staffPmMock.replyToTicket.mockResolvedValueOnce({
      ok: false,
      reason: 'forbidden'
    });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/tickets/1/reply')
          .send({ body: 'Reply' })
      ).status
    ).toBe(403);

    staffPmMock.replyToTicket.mockResolvedValueOnce({
      ok: false,
      reason: 'resolved'
    });
    expect(
      (
        await request(app)
          .post('/api/staff-inbox/tickets/1/reply')
          .send({ body: 'Reply' })
      ).status
    ).toBe(422);
  });

  it('passes moderator=true for staff replies', async () => {
    setStaff();
    staffPmMock.replyToTicket.mockResolvedValue({
      ok: true,
      message: {
        id: 3,
        conversationId: 1,
        senderId: 7,
        body: 'Staff reply',
        createdAt: new Date(),
        sender: { id: 7, username: 'mod', avatar: null }
      }
    });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/reply')
      .send({ body: 'Staff reply' });

    expect(res.status).toBe(201);
    expect(staffPmMock.replyToTicket).toHaveBeenCalledWith(
      1,
      7,
      'Staff reply',
      true
    );
  });

  it('returns 400 for an invalid ticket id', async () => {
    const res = await request(app)
      .post('/api/staff-inbox/tickets/nope/reply')
      .send({ body: 'Reply' });

    expect(res.status).toBe(400);
    expect(staffPmMock.replyToTicket).not.toHaveBeenCalled();
  });
});

describe('POST /api/staff-inbox/tickets/:id/resolve', () => {
  beforeEach(() => resetApiTestState());

  it('allows the owner path to resolve their own ticket', async () => {
    staffPmMock.resolveTicket.mockResolvedValue({ ok: true });

    const res = await request(app).post('/api/staff-inbox/tickets/1/resolve');

    expect(res.status).toBe(204);
    expect(staffPmMock.resolveTicket).toHaveBeenCalledWith(1, 7, false);
  });

  it('passes moderator=true for staff resolution', async () => {
    setStaff();
    staffPmMock.resolveTicket.mockResolvedValue({ ok: true });

    const res = await request(app).post('/api/staff-inbox/tickets/1/resolve');

    expect(res.status).toBe(204);
    expect(staffPmMock.resolveTicket).toHaveBeenCalledWith(1, 7, true);
  });

  it('maps already_resolved to 422', async () => {
    staffPmMock.resolveTicket.mockResolvedValue({
      ok: false,
      reason: 'already_resolved'
    });

    const res = await request(app).post('/api/staff-inbox/tickets/1/resolve');

    expect(res.status).toBe(422);
  });

  it('maps forbidden to 403', async () => {
    staffPmMock.resolveTicket.mockResolvedValue({
      ok: false,
      reason: 'forbidden'
    });

    const res = await request(app).post('/api/staff-inbox/tickets/1/resolve');

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid ticket id', async () => {
    const res = await request(app).post(
      '/api/staff-inbox/tickets/nope/resolve'
    );

    expect(res.status).toBe(400);
    expect(staffPmMock.resolveTicket).not.toHaveBeenCalled();
  });
});

describe('POST /api/staff-inbox/tickets/:id/unresolve', () => {
  beforeEach(() => resetApiTestState());

  it('requires staff and maps not_resolved to 422', async () => {
    const noStaff = await request(app).post(
      '/api/staff-inbox/tickets/1/unresolve'
    );
    expect(noStaff.status).toBe(403);

    setStaff();
    staffPmMock.unresolveTicket.mockResolvedValue({
      ok: false,
      reason: 'not_resolved'
    });

    const res = await request(app).post('/api/staff-inbox/tickets/1/unresolve');

    expect(res.status).toBe(422);
  });

  it('returns 204 on success', async () => {
    setStaff();
    staffPmMock.unresolveTicket.mockResolvedValue({ ok: true });

    const res = await request(app).post('/api/staff-inbox/tickets/1/unresolve');

    expect(res.status).toBe(204);
  });

  it('returns 404 when the ticket is missing', async () => {
    setStaff();
    staffPmMock.unresolveTicket.mockResolvedValue({
      ok: false,
      reason: 'not_found'
    });

    const res = await request(app).post('/api/staff-inbox/tickets/1/unresolve');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/staff-inbox/tickets/:id/assign', () => {
  beforeEach(() => resetApiTestState());

  it('resolves assignedUsername to a user id for staff', async () => {
    setStaff();
    prismaMock.user.findFirst.mockResolvedValue({ id: 12 } as never);
    staffPmMock.assignTicket.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/assign')
      .send({ assignedUsername: 'ModUser' });

    expect(res.status).toBe(204);
    expect(staffPmMock.assignTicket).toHaveBeenCalledWith(1, 12);
  });

  it('returns 404 when assignedUsername does not exist', async () => {
    setStaff();
    prismaMock.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/assign')
      .send({ assignedUsername: 'missing' });

    expect(res.status).toBe(404);
  });

  it('maps assignee_not_staff to 422', async () => {
    setStaff();
    staffPmMock.assignTicket.mockResolvedValue({
      ok: false,
      reason: 'assignee_not_staff'
    });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/assign')
      .send({ assignedUserId: 44 });

    expect(res.status).toBe(422);
  });

  it('uses assignedUserId directly without username lookup', async () => {
    setStaff();
    staffPmMock.assignTicket.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/assign')
      .send({ assignedUserId: 44, assignedUsername: 'ignored-name' });

    expect(res.status).toBe(204);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(staffPmMock.assignTicket).toHaveBeenCalledWith(1, 44);
  });

  it('allows unassigning a ticket with null assignedUserId', async () => {
    setStaff();
    staffPmMock.assignTicket.mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/staff-inbox/tickets/1/assign')
      .send({ assignedUserId: null });

    expect(res.status).toBe(204);
    expect(staffPmMock.assignTicket).toHaveBeenCalledWith(1, null);
  });
});

describe('POST /api/staff-inbox/bulk-resolve', () => {
  beforeEach(() => resetApiTestState());

  it('resolves selected tickets for staff', async () => {
    setStaff();
    staffPmMock.bulkResolve.mockResolvedValue({ ok: true, resolved: 2 });

    const res = await request(app)
      .post('/api/staff-inbox/bulk-resolve')
      .send({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(staffPmMock.bulkResolve).toHaveBeenCalledWith([1, 2]);
    expect(res.body.resolved).toBe(2);
  });

  it('returns 403 without staff permission', async () => {
    const res = await request(app)
      .post('/api/staff-inbox/bulk-resolve')
      .send({ ids: [1, 2] });

    expect(res.status).toBe(403);
    expect(staffPmMock.bulkResolve).not.toHaveBeenCalled();
  });
});

import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  staffInboxMock
} from './test/apiTestHarness';
import type { StaffResponse } from './modules/staffInbox';

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

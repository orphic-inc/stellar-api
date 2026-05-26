import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { makeUser } from './test/factories';

beforeEach(() => resetApiTestState());

const setAdmin = () =>
  prismaMock.userRank.findUnique.mockResolvedValue({
    id: 1,
    name: 'Admin',
    level: 1000,
    color: '',
    badge: '',
    displayStaff: false,
    permissions: {
      admin: true,
      staff: true,
      forums_read: true,
      forums_post: true
    }
  } as never);

// ─── GET /api/donations ───────────────────────────────────────────────────────

describe('GET /api/donations', () => {
  it('returns 403 when user lacks admin permission (null rank)', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/donations');
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has non-admin rank', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      name: 'Member',
      level: 10,
      color: '',
      badge: '',
      displayStaff: false,
      permissions: {}
    } as never);
    const res = await request(app).get('/api/donations');
    expect(res.status).toBe(403);
  });

  it('returns paginated donations', async () => {
    setAdmin();
    const donation = {
      id: 1,
      userId: 2,
      amount: 25,
      email: 'donor@test.com',
      donatedAt: new Date('2026-01-01'),
      currency: 'USD',
      source: 'Staff PM',
      reason: 'Thanks',
      rank: 5,
      addedBy: 7,
      totalRank: 5,
      user: { id: 2, username: 'supporter' }
    };
    prismaMock.donation.findMany.mockResolvedValue([donation] as never);
    prismaMock.donation.count.mockResolvedValue(1);

    const res = await request(app).get('/api/donations');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('passes userId filter to both findMany and count', async () => {
    setAdmin();
    prismaMock.donation.findMany.mockResolvedValue([]);
    prismaMock.donation.count.mockResolvedValue(0);

    await request(app).get('/api/donations?userId=5');

    expect(prismaMock.donation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 5 } })
    );
    expect(prismaMock.donation.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 5 } })
    );
  });

  it('applies no where clause when userId is absent', async () => {
    setAdmin();
    prismaMock.donation.findMany.mockResolvedValue([]);
    prismaMock.donation.count.mockResolvedValue(0);

    await request(app).get('/api/donations');

    expect(prismaMock.donation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it('rejects non-integer userId', async () => {
    setAdmin();
    const res = await request(app).get('/api/donations?userId=abc');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/donations ──────────────────────────────────────────────────────

describe('POST /api/donations', () => {
  beforeEach(() => setAdmin());

  const validBody = {
    userId: 2,
    amount: 25,
    email: 'donor@test.com',
    donatedAt: '2026-01-01T00:00:00.000Z',
    currency: 'USD',
    source: 'Staff PM',
    reason: 'General support'
  };

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/donations').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app)
      .post('/api/donations')
      .send({ ...validBody, reason: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/api/donations')
      .send({ ...validBody, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/donations').send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('User not found');
  });

  it('returns 201 with created donation and calls audit', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 2 }) as never);
    const created = {
      id: 10,
      userId: 2,
      amount: 25,
      email: 'donor@test.com',
      donatedAt: new Date('2026-01-01'),
      currency: 'USD',
      source: 'Staff PM',
      reason: 'General support',
      rank: 0,
      addedBy: 0,
      totalRank: 0,
      user: { id: 2, username: 'supporter' }
    };
    prismaMock.donation.create.mockResolvedValue(created as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/donations').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });
});

// ─── DELETE /api/donations/:id ────────────────────────────────────────────────

describe('DELETE /api/donations/:id', () => {
  beforeEach(() => setAdmin());

  it('returns 404 when donation does not exist', async () => {
    prismaMock.donation.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/donations/99');
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Donation not found');
  });

  it('returns 204 on success and calls audit', async () => {
    prismaMock.donation.findUnique.mockResolvedValue({
      id: 5,
      userId: 2
    } as never);
    prismaMock.donation.delete.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/donations/5');
    expect(res.status).toBe(204);
    expect(prismaMock.donation.delete).toHaveBeenCalledWith({
      where: { id: 5 }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });

  it('returns 400 for non-integer id', async () => {
    const res = await request(app).delete('/api/donations/abc');
    expect(res.status).toBe(400);
  });
});

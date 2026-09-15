/**
 * GET /api/users/invites — the `status` query filter (registry enum sweep).
 *
 * `status` filters an `InviteStatus` COLUMN. It used to be validated as
 * `z.string().optional()` and handed to Prisma with a `status as never` cast,
 * so a value outside the enum reached the query, threw
 * PrismaClientValidationError, and surfaced as a **500** — the global handler
 * has no `statusCode` to read off that error and falls through to
 * `err.statusCode ?? 500`.
 *
 * These pin the corrected contract: a good value filters, a bad one is a 400
 * like every other rejected query value, and an absent one does not filter.
 */
import {
  request,
  app,
  prismaMock,
  resetApiTestState,
  setCurrentUserPermissions
} from './test/apiTestHarness';

describe('GET /api/users/invites — status filter', () => {
  beforeEach(() => {
    resetApiTestState();
    setCurrentUserPermissions({ invites_manage: true });
    prismaMock.invite.findMany.mockResolvedValue([] as never);
    prismaMock.invite.count.mockResolvedValue(0 as never);
  });

  it('accepts a real InviteStatus and filters on it', async () => {
    const res = await request(app).get('/api/users/invites?status=pending');

    expect(res.status).toBe(200);
    expect(prismaMock.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } })
    );
  });

  // The regression: this used to be a 500 from deep inside Prisma.
  it('rejects a value outside the enum with 400, not a 500 from Prisma', async () => {
    const res = await request(app).get('/api/users/invites?status=bogus');

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('status');
    expect(prismaMock.invite.findMany).not.toHaveBeenCalled();
  });

  it('does not filter when status is absent', async () => {
    const res = await request(app).get('/api/users/invites');

    expect(res.status).toBe(200);
    expect(prismaMock.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe('GET /api/users/invites — email search and ordering (#636)', () => {
  beforeEach(() => {
    resetApiTestState();
    setCurrentUserPermissions({ invites_manage: true });
    prismaMock.invite.findMany.mockResolvedValue([] as never);
    prismaMock.invite.count.mockResolvedValue(0 as never);
  });

  it('matches a case-insensitive substring, combined with status', async () => {
    const res = await request(app).get(
      '/api/users/invites?status=pending&email=%20@Example.org%20'
    );

    expect(res.status).toBe(200);
    const where = {
      status: 'pending',
      email: { contains: '@Example.org', mode: 'insensitive' }
    };
    expect(prismaMock.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where })
    );
    expect(prismaMock.invite.count).toHaveBeenCalledWith({ where });
  });

  it('rejects a search shorter than three characters', async () => {
    const res = await request(app).get('/api/users/invites?email=ab');

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('email');
  });

  it('breaks expires ties on id, so pages cannot overlap', async () => {
    await request(app).get('/api/users/invites');

    expect(prismaMock.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ expires: 'desc' }, { id: 'desc' }]
      })
    );
  });
});

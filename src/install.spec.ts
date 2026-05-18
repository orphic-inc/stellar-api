import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// ─── GET /api/install ─────────────────────────────────────────────────────────

describe('GET /api/install', () => {
  it('reports installed when ranks and users exist', async () => {
    prismaMock.userRank.count.mockResolvedValue(4);
    prismaMock.user.count.mockResolvedValue(1);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(res.body.installed).toBe(true);
    expect(res.body.registrationStatus).toBe('open');
  });

  it('reports not installed when no users exist', async () => {
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(res.body.installed).toBe(false);
  });
});

// ─── POST /api/install ────────────────────────────────────────────────────────

describe('POST /api/install', () => {
  it('returns 409 when already installed', async () => {
    prismaMock.user.count.mockResolvedValue(1);

    const res = await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(res.status).toBe(409);
    expect(res.body.msg).toBe('Application already installed');
  });

  it('returns 400 when validation fails', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app).post('/api/install').send({
      username: 'sy',
      email: 'not-an-email',
      password: 'short'
    });

    expect(res.status).toBe(400);
  });

  it('creates the first SysOp user and returns a JWT cookie', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);

    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) => {
      const tx = prismaMock;
      tx.userRank.count.mockResolvedValueOnce(0);
      tx.userRank.create
        .mockResolvedValueOnce({ id: 10, level: 100 } as never)
        .mockResolvedValueOnce({ id: 11, level: 200 } as never)
        .mockResolvedValueOnce({ id: 12, level: 500 } as never)
        .mockResolvedValueOnce({ id: 13, level: 1000 } as never);
      tx.forumCategory.create.mockResolvedValueOnce({ id: 1 } as never);
      tx.forum.create.mockResolvedValueOnce({ id: 1 } as never);
      tx.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
      tx.profile.create.mockResolvedValueOnce({ id: 5 } as never);
      tx.user.create.mockResolvedValueOnce({
        id: 1,
        username: 'sysop',
        email: 'sysop@example.com',
        avatar: 'https://gravatar.test/avatar.png',
        inviteCount: 100,
        dateRegistered: new Date().toISOString(),
        userRank: {
          level: 1000,
          name: 'SysOp',
          color: '#a0d468',
          badge: '',
          permissions: { admin: true }
        }
      } as never);
      return (cb as (tx: typeof prismaMock) => Promise<unknown>)(tx);
    });

    const res = await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('sysop');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=signed-jwt')])
    );
  });

  it('uses existing ranks when they were pre-seeded', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);

    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) => {
      const tx = prismaMock;
      tx.userRank.count.mockResolvedValueOnce(4);
      tx.userRank.findFirst.mockResolvedValueOnce({ id: 13 } as never);
      tx.forumCategory.create.mockResolvedValueOnce({ id: 1 } as never);
      tx.forum.create.mockResolvedValueOnce({ id: 1 } as never);
      tx.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
      tx.profile.create.mockResolvedValueOnce({ id: 5 } as never);
      tx.user.create.mockResolvedValueOnce({
        id: 1,
        username: 'sysop',
        email: 'sysop@example.com',
        avatar: 'https://gravatar.test/avatar.png',
        inviteCount: 100,
        dateRegistered: new Date().toISOString(),
        userRank: {
          level: 1000,
          name: 'SysOp',
          color: '#a0d468',
          badge: '',
          permissions: { admin: true }
        }
      } as never);
      return (cb as (tx: typeof prismaMock) => Promise<unknown>)(tx);
    });

    const res = await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.userRank.create).not.toHaveBeenCalled();
  });
});

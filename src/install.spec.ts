import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';

beforeEach(() => resetApiTestState());

// Shared mock setup for a successful install with pre-seeded ranks/forums.
// seedRanks/seedForums both no-op when counts > 0.
function mockPreseededBootstrap() {
  prismaMock.userRank.count.mockResolvedValue(4);
  prismaMock.forumCategory.count.mockResolvedValue(7);
  prismaMock.userRank.findFirst.mockResolvedValue({
    id: 13,
    level: 1000
  } as never);
}

function mockSysopTransaction() {
  prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) => {
    const tx = prismaMock;
    tx.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
    tx.profile.create.mockResolvedValueOnce({ id: 5 } as never);
    tx.user.create.mockResolvedValueOnce({
      id: 1,
      username: 'sysop',
      email: 'sysop@example.com',
      avatar: 'https://gravatar.test/avatar.png',
      isArtist: false,
      isDonor: false,
      canDownload: true,
      inviteCount: 100,
      dateRegistered: new Date(),
      lastLogin: null,
      contributed: 5_368_709_120n,
      consumed: 0n,
      ratio: 0,
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
}

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

  it('includes configWarnings in the response', async () => {
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.configWarnings)).toBe(true);
  });

  it('includes setupChecklist items for unresolved launch configuration', async () => {
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(
      res.body.setupChecklist.map((item: { message: string }) => item.message)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('registrationStatus is still "open"'),
        expect.stringContaining('maxUsers is still the default value'),
        expect.stringContaining('approvedDomains is empty')
      ])
    );
  });

  it('omits dismissed launch checklist items', async () => {
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: ['max-users-default'],
      updatedAt: new Date()
    } as never);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(
      res.body.setupChecklist.find(
        (item: { id: string }) => item.id === 'max-users-default'
      )
    ).toBeUndefined();
  });
});

describe('POST /api/install/checklist/:id/dismiss', () => {
  beforeEach(() => resetApiTestState());

  it('persists a dismissed checklist item for staff', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue({
      id: 1,
      permissions: { staff: true }
    } as never);
    prismaMock.siteSettings.upsert
      .mockResolvedValueOnce({
        id: 1,
        approvedDomains: [],
        registrationStatus: 'open',
        maxUsers: 7000,
        dismissedLaunchChecklist: [],
        updatedAt: new Date()
      } as never)
      .mockResolvedValueOnce({
        id: 1,
        approvedDomains: [],
        registrationStatus: 'open',
        maxUsers: 7000,
        dismissedLaunchChecklist: ['max-users-default'],
        updatedAt: new Date()
      } as never);

    const res = await request(app).post(
      '/api/install/checklist/max-users-default/dismiss'
    );

    expect(res.status).toBe(204);
    expect(prismaMock.siteSettings.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { dismissedLaunchChecklist: ['max-users-default'] }
      })
    );
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
    mockPreseededBootstrap();
    mockSysopTransaction();

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

  it('returns a complete auth user with canDownload and contributed in the response', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    mockPreseededBootstrap();
    mockSysopTransaction();

    const res = await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(res.status).toBe(201);
    expect(res.body.user.canDownload).toBe(true);
    expect(res.body.user.contributed).toBe('5368709120');
    expect(res.body.user.consumed).toBe('0');
  });

  it('seeds ranks and forums on a completely fresh DB', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);

    // seedRanks: no existing ranks → creates 4
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.userRank.create
      .mockResolvedValueOnce({ id: 10, level: 100 } as never)
      .mockResolvedValueOnce({ id: 11, level: 200 } as never)
      .mockResolvedValueOnce({ id: 12, level: 500 } as never)
      .mockResolvedValueOnce({ id: 13, level: 1000 } as never);

    // seedForums: no existing categories → creates them
    prismaMock.forumCategory.count.mockResolvedValue(0);
    prismaMock.forumCategory.create.mockResolvedValue({ id: 1 } as never);
    prismaMock.forum.create.mockResolvedValue({ id: 1 } as never);

    prismaMock.userRank.findFirst.mockResolvedValue({
      id: 13,
      level: 1000
    } as never);
    mockSysopTransaction();

    const res = await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(res.status).toBe(201);
    expect(prismaMock.userRank.create).toHaveBeenCalledTimes(4);
    expect(prismaMock.forumCategory.create).toHaveBeenCalled();
  });

  it('skips seeding when ranks and forums already exist', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    mockPreseededBootstrap();
    mockSysopTransaction();

    await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(prismaMock.userRank.create).not.toHaveBeenCalled();
    expect(prismaMock.forumCategory.create).not.toHaveBeenCalled();
  });

  it('assigns the 5 GiB startup buffer to the SysOp user', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    mockPreseededBootstrap();
    mockSysopTransaction();

    await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contributed: 5_368_709_120n
        })
      })
    );
  });
});

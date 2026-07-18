import {
  request,
  app,
  resetApiTestState,
  prismaMock
} from './test/apiTestHarness';
import { DEFAULT_RANKS } from './modules/bootstrap';

beforeEach(() => resetApiTestState());

// Shared mock setup for a successful install with pre-seeded ranks/forums.
// seedRanks/seedForums both no-op when counts > 0.
function mockPreseededBootstrap() {
  prismaMock.forumCategory.count.mockResolvedValue(7);
  prismaMock.userRank.findFirst.mockResolvedValue({
    id: 13,
    level: 1000
  } as never);
  prismaMock.userRank.findUnique.mockResolvedValue({
    id: 13,
    level: 1000,
    name: 'SysOp'
  } as never);
  // seedRankPromotionRules loads the seeded ranks; empty is fine for these tests
  // (no rule rungs resolve, nothing to assert on here).
  prismaMock.userRank.findMany.mockResolvedValue([] as never);
}

function mockSysopTransaction() {
  // seedSystemUser + seedStylesheetFixtures run just before the SysOp transaction:
  // the reserved System user is absent (findUnique → null), its UserSettings/Profile/
  // User rows create as base mocks (the tx's once-mocks below still win for the SysOp),
  // and the two built-in fixtures create + repoint their registry rows.
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.userSettings.create.mockResolvedValue({ id: 4 } as never);
  prismaMock.profile.create.mockResolvedValue({ id: 5 } as never);
  prismaMock.user.create.mockResolvedValue({ id: 2 } as never);
  prismaMock.authorStylesheet.findFirst.mockResolvedValue(null);
  prismaMock.authorStylesheet.create.mockResolvedValue({ id: 100 } as never);
  prismaMock.stylesheet.upsert.mockResolvedValue({ id: 1 } as never);

  // The flagship-community seed runs right after the user transaction commits.
  prismaMock.community.findFirst.mockResolvedValue(null);
  prismaMock.community.create.mockResolvedValue({ id: 1 } as never);
  prismaMock.consumer.upsert.mockResolvedValue({ id: 1 } as never);
  prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) => {
    const tx = prismaMock;
    tx.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
    tx.profile.create.mockResolvedValueOnce({ id: 5 } as never);
    tx.user.create.mockResolvedValueOnce({
      id: 1,
      username: 'sysop',
      email: 'sysop@example.com',
      avatar: null,
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
        id: 13,
        level: 1000,
        name: 'SysOp',
        color: '#a0d468',
        badge: '',
        permissions: { admin: true },
        personalCollageLimit: 0
      },
      secondaryRanks: []
    } as never);
    return (cb as (tx: typeof prismaMock) => Promise<unknown>)(tx);
  });
}

// ─── GET /api/install ─────────────────────────────────────────────────────────

describe('GET /api/install', () => {
  it('reports installed when installedAt is stamped', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: new Date(),
      updatedAt: new Date()
    } as never);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(res.body.installed).toBe(true);
    expect(res.body.registrationStatus).toBe('open');
  });

  it('reports not installed when installedAt is null', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    } as never);

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
        expect.stringContaining('registrationStatus is "closed"'),
        expect.stringContaining('maxUsers is still the default value'),
        expect.stringContaining('approvedDomains is empty')
      ])
    );
  });

  it('omits the registration checklist item once registration is opened', async () => {
    prismaMock.userRank.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    } as never);

    const res = await request(app).get('/api/install');

    expect(res.status).toBe(200);
    expect(
      res.body.setupChecklist.find(
        (item: { id: string }) => item.id === 'registration-closed'
      )
    ).toBeUndefined();
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
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: new Date(),
      updatedAt: new Date()
    } as never);

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

    // seedRanks checks each canonical level individually; none exist yet.
    prismaMock.userRank.findUnique.mockResolvedValue(null);
    prismaMock.userRank.create.mockResolvedValue({
      id: 13,
      level: 1000
    } as never);
    // seedRankPromotionRules then loads the freshly seeded ranks.
    prismaMock.userRank.findMany.mockResolvedValue([] as never);

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
    // One create per rung of the full class ladder.
    expect(prismaMock.userRank.create).toHaveBeenCalledTimes(
      DEFAULT_RANKS.length
    );
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

  it('stamps installedAt as the install transition', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findFirst.mockResolvedValue(null);
    mockPreseededBootstrap();
    mockSysopTransaction();

    await request(app).post('/api/install').send({
      username: 'sysop',
      email: 'sysop@example.com',
      password: 'secure-password-123'
    });

    // markInstalled() upserts SiteSettings with a stamped installedAt.
    expect(prismaMock.siteSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ installedAt: expect.any(Date) })
      })
    );
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

  it('seeds the flagship community owned by the SysOp', async () => {
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
    // Named after the site, public, with the SysOp connected as CommunityStaff.
    expect(prismaMock.community.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Stellar',
          registrationStatus: 'open',
          staff: { connect: { id: 1 } }
        })
      })
    );
    // Owner is also registered as a Consumer (mirrors POST /api/communities).
    expect(prismaMock.consumer.upsert).toHaveBeenCalled();
  });
});

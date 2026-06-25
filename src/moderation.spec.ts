import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank,
  setCurrentUserPermissions,
  getUserSettingsMock,
  updateUserSettingsMock,
  createUserMock
} from './test/apiTestHarness';
import { makeUser } from './test/factories';
import { sendRecoveryEmail } from './lib/mailer';

const sendRecoveryEmailMock = sendRecoveryEmail as jest.Mock;

beforeEach(() => resetApiTestState());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const setStaff = () =>
  setCurrentUserPermissions(
    makeUserRank({
      staff: true,
      users_warn: true,
      users_disable: true,
      users_edit: true,
      donor_ranks_manage: true
    }).permissions as Record<string, boolean>
  );

const setUserHistoryViewer = () =>
  setCurrentUserPermissions(
    makeUserRank({
      users_view_ips: true,
      users_view_email: true
    }).permissions as Record<string, boolean>
  );

const setAdmin = () =>
  setCurrentUserPermissions(
    makeUserRank({
      admin: true,
      staff: true,
      users_warn: true,
      users_disable: true,
      users_edit: true
    }).permissions as Record<string, boolean>
  );

const setDonorRankManager = () =>
  setCurrentUserPermissions(
    makeUserRank({
      donor_ranks_manage: true
    }).permissions as Record<string, boolean>
  );

const setRecoveryManager = () =>
  setCurrentUserPermissions(
    makeUserRank({
      recovery_manage: true
    }).permissions as Record<string, boolean>
  );

const mockTargetUser = (overrides = {}) =>
  prismaMock.user.findUnique.mockResolvedValue(
    makeUser({ id: 9, ...overrides })
  );

// ─── Warnings ─────────────────────────────────────────────────────────────────

describe('GET /api/users/:id/warnings', () => {
  beforeEach(() => setStaff());

  it('returns the list of warnings for the target user', async () => {
    prismaMock.userWarning.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 9,
        warnedById: 7,
        reason: 'Rule violation',
        expiresAt: null,
        createdAt: new Date(),
        warnedBy: { id: 7, username: 'admin' }
      } as never
    ]);

    const res = await request(app).get('/api/users/9/warnings');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reason).toBe('Rule violation');
  });

  it('returns 403 without staff permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).get('/api/users/9/warnings');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/warn', () => {
  beforeEach(() => setStaff());

  it('creates a warning and returns 201', async () => {
    mockTargetUser();
    prismaMock.$transaction.mockResolvedValue([
      {
        id: 1,
        userId: 9,
        warnedById: 7,
        reason: 'Spam',
        expiresAt: null,
        createdAt: new Date()
      },
      makeUser()
    ] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/users/9/warn')
      .send({ reason: 'Spam' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('warning');
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/users/999/warn')
      .send({ reason: 'Spam' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await request(app).post('/api/users/9/warn').send({});
    expect(res.status).toBe(400);
  });
});

// ─── Moderation notes ─────────────────────────────────────────────────────────

describe('GET /api/users/:id/notes', () => {
  beforeEach(() => setStaff());

  it('returns moderation notes for the target user', async () => {
    prismaMock.userModerationNote.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 9,
        authorId: 7,
        body: 'Watch this user',
        createdAt: new Date(),
        author: { id: 7, username: 'admin' }
      } as never
    ]);

    const res = await request(app).get('/api/users/9/notes');

    expect(res.status).toBe(200);
    expect(res.body[0].body).toBe('Watch this user');
  });
});

describe('POST /api/users/:id/notes', () => {
  beforeEach(() => setStaff());

  it('creates a moderation note and returns 201', async () => {
    mockTargetUser();
    prismaMock.userModerationNote.create.mockResolvedValue({
      id: 1,
      userId: 9,
      authorId: 7,
      body: 'Watch this user',
      createdAt: new Date()
    } as never);

    const res = await request(app)
      .post('/api/users/9/notes')
      .send({ body: 'Watch this user' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('note');
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/users/999/notes')
      .send({ body: 'Note' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when body is missing', async () => {
    const res = await request(app).post('/api/users/9/notes').send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/users/:id/notes/:noteId', () => {
  beforeEach(() => setStaff());

  it('deletes the note and returns 204', async () => {
    prismaMock.userModerationNote.findFirst.mockResolvedValue({
      id: 5,
      userId: 9,
      authorId: 7,
      body: 'Old note',
      createdAt: new Date()
    } as never);
    prismaMock.userModerationNote.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/users/9/notes/5');

    expect(res.status).toBe(204);
  });

  it('returns 404 when the note does not exist for that user', async () => {
    prismaMock.userModerationNote.findFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/users/9/notes/999');
    expect(res.status).toBe(404);
  });
});

// ─── Disable / Enable ─────────────────────────────────────────────────────────

describe('POST /api/users/:id/disable', () => {
  beforeEach(() => setStaff());

  it('disables the user account and returns a msg', async () => {
    mockTargetUser();
    prismaMock.user.update.mockResolvedValue(makeUser({ disabled: true }));
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/users/9/disable');

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('User disabled');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { disabled: true }
    });
  });

  it('returns 404 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/users/999/disable');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/users/:id/enable', () => {
  beforeEach(() => setStaff());

  it('enables the user account and returns a msg', async () => {
    mockTargetUser({ disabled: true });
    prismaMock.user.update.mockResolvedValue(makeUser({ disabled: false }));
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/users/9/enable');

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('User enabled');
  });

  it('returns 404 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/users/9/enable');
    expect(res.status).toBe(404);
  });
});

// ─── Rank change ──────────────────────────────────────────────────────────────

describe('PUT /api/users/:id/rank', () => {
  beforeEach(() => setAdmin());

  it('updates the user rank and returns a msg', async () => {
    mockTargetUser();
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true })) // permission check
      .mockResolvedValueOnce(null);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 2, secondary: false },
      { id: 5, secondary: true }
    ] as never);
    prismaMock.$transaction.mockResolvedValue([
      makeUser(),
      {},
      { count: 1 }
    ] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 2, secondaryRankIds: [5] });

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Rank updated');
  });

  it('returns 403 without users_edit permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 2 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when userRankId is missing', async () => {
    const res = await request(app).put('/api/users/9/rank').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:id/rank', () => {
  beforeEach(() => setStaff());

  it('returns the rank assignment including the current rankLocked state', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      userRankId: 2,
      rankLocked: true,
      secondaryRanks: [{ userRankId: 5 }]
    } as never);

    const res = await request(app).get('/api/users/9/rank');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userRankId: 2,
      secondaryRankIds: [5],
      rankLocked: true
    });
  });

  it('returns 404 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/users/9/rank');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/users/:id/rank-lock', () => {
  beforeEach(() => setStaff());

  it('locks a user and records an audit entry', async () => {
    mockTargetUser();
    prismaMock.user.update.mockResolvedValue(
      makeUser({ id: 9, rankLocked: true }) as never
    );
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/users/9/rank-lock')
      .send({ rankLocked: true });

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Rank locked');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { rankLocked: true }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'user.rank_lock_changed',
          targetType: 'User',
          targetId: 9,
          metadata: { rankLocked: true }
        })
      })
    );
  });

  it('unlocks a user', async () => {
    mockTargetUser();
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 9 }) as never);

    const res = await request(app)
      .put('/api/users/9/rank-lock')
      .send({ rankLocked: false });

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Rank unlocked');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { rankLocked: false }
    });
  });

  it('does not touch the secondary-rank set (avoids the setUserRank wipe)', async () => {
    mockTargetUser();
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 9 }) as never);

    await request(app).put('/api/users/9/rank-lock').send({ rankLocked: true });

    // setUserRank clears+rebuilds userSecondaryRank on every call; the lock
    // toggle must never go through that path or it would strip Donor/VIP.
    expect(prismaMock.userSecondaryRank.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { rankLocked: true }
    });
  });

  it('returns 403 without users_edit permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app)
      .put('/api/users/9/rank-lock')
      .send({ rankLocked: true });
    expect(res.status).toBe(403);
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/users/9/rank-lock')
      .send({ rankLocked: true });
    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('User not found');
  });

  it('returns 400 when rankLocked is missing or not a boolean', async () => {
    const res = await request(app).put('/api/users/9/rank-lock').send({});
    expect(res.status).toBe(400);
  });
});

// ─── IP history ───────────────────────────────────────────────────────────────

describe('GET /api/users/:id/ip-history', () => {
  beforeEach(() => setUserHistoryViewer());

  it('returns session IP history for the target user', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        userId: 9,
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        revokedAt: null
      } as never
    ]);

    const res = await request(app).get('/api/users/9/ip-history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({
      ip: '1.2.3.4',
      seenAt: expect.any(String)
    });
  });

  it('skips sessions with null ipAddress', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        id: 'sess-null',
        userId: 9,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        lastActiveAt: null,
        revokedAt: null
      } as never
    ]);

    const res = await request(app).get('/api/users/9/ip-history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('uses createdAt as seenAt when lastActiveAt is null', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        id: 'sess-2',
        userId: 9,
        ipAddress: '5.6.7.8',
        userAgent: null,
        createdAt,
        lastActiveAt: null,
        revokedAt: null
      } as never
    ]);

    const res = await request(app).get('/api/users/9/ip-history');

    expect(res.status).toBe(200);
    expect(res.body[0].seenAt).toBe(createdAt.toISOString());
  });

  it('deduplicates sessions from the same IP address', async () => {
    const session = {
      id: 'sess-a',
      userId: 9,
      ipAddress: '10.0.0.1',
      userAgent: null,
      createdAt: new Date(),
      lastActiveAt: null,
      revokedAt: null
    };
    prismaMock.userSession.findMany.mockResolvedValue([
      { ...session, id: 'sess-a' } as never,
      { ...session, id: 'sess-b' } as never
    ]);

    const res = await request(app).get('/api/users/9/ip-history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns 403 without users_view_ips permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).get('/api/users/9/ip-history');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/:id/email-history', () => {
  beforeEach(() => setUserHistoryViewer());

  it('returns email history entries in the frontend contract shape', async () => {
    prismaMock.userEmailHistory.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 9,
        newEmail: 'first@example.com',
        oldEmail: 'older@example.com',
        ipAddress: null,
        changedAt: new Date('2026-05-01T00:00:00.000Z')
      } as never
    ]);

    const res = await request(app).get('/api/users/9/email-history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        email: 'first@example.com',
        changedAt: '2026-05-01T00:00:00.000Z'
      }
    ]);
  });

  it('returns 403 without users_view_email permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).get('/api/users/9/email-history');
    expect(res.status).toBe(403);
  });
});

// ─── Donor ranks ──────────────────────────────────────────────────────────────

describe('GET /api/users/donor-ranks', () => {
  it('returns the list of donor ranks', async () => {
    prismaMock.donorRank.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Bronze',
        minDonation: 1000,
        badge: null,
        expiresAfterDays: null
      } as never
    ]);

    const res = await request(app).get('/api/users/donor-ranks');

    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Bronze');
  });
});

describe('POST /api/users/donor-ranks', () => {
  beforeEach(() => setDonorRankManager());

  it('creates a donor rank and returns 201', async () => {
    prismaMock.donorRank.create.mockResolvedValue({
      id: 1,
      name: 'Gold',
      minDonation: 5000,
      badge: null,
      expiresAfterDays: 365,
      perks: {},
      color: null
    } as never);

    const res = await request(app)
      .post('/api/users/donor-ranks')
      .send({ name: 'Gold', minDonation: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Gold');
  });

  it('creates a donor rank with all optional fields', async () => {
    prismaMock.donorRank.create.mockResolvedValue({
      id: 2,
      name: 'Platinum',
      minDonation: 10000,
      badge: 'plat',
      expiresAfterDays: 180,
      perks: { downloads: true },
      color: '#silver'
    } as never);

    const res = await request(app)
      .post('/api/users/donor-ranks')
      .send({
        name: 'Platinum',
        minDonation: 10000,
        expiresAfterDays: 180,
        perks: { downloads: true },
        color: '#silver',
        badge: 'plat'
      });

    expect(res.status).toBe(201);
    expect(res.body.badge).toBe('plat');
  });

  it('returns 403 without donor_ranks_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app)
      .post('/api/users/donor-ranks')
      .send({ name: 'Gold', minDonation: 5000 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/users/donor-ranks')
      .send({ name: 'Gold' }); // missing minDonation
    expect(res.status).toBe(400);
  });
});

// ─── Snatch list ──────────────────────────────────────────────────────────────

describe('GET /api/users/me/snatch-list', () => {
  it('returns the snatch list with the correct shape', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      {
        id: 10,
        consumerId: 7,
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01'),
        contribution: {
          release: {
            id: 42,
            title: 'Kind of Blue',
            communityId: 3,
            credits: [{ role: 'Main', artist: { name: 'Miles Davis' } }]
          }
        }
      } as never
    ]);

    const res = await request(app).get('/api/users/me/snatch-list');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(10);
    expect(res.body[0].release.title).toBe('Kind of Blue');
    expect(res.body[0].artist.name).toBe('Miles Davis');
    expect(res.body[0]).toHaveProperty('downloadedAt');
  });

  it('deduplicates releases that appear multiple times', async () => {
    const grantBase = {
      consumerId: 7,
      status: 'COMPLETED',
      createdAt: new Date('2026-01-01'),
      contribution: {
        release: {
          id: 42,
          title: 'Kind of Blue',
          communityId: null,
          credits: [{ role: 'Main', artist: { name: 'Miles Davis' } }]
        }
      }
    };
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      { ...grantBase, id: 10 } as never,
      { ...grantBase, id: 11 } as never
    ]);

    const res = await request(app).get('/api/users/me/snatch-list');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('returns null artist when release has no artist', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      {
        id: 12,
        consumerId: 7,
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01'),
        contribution: {
          release: {
            id: 43,
            title: 'VA Compilation',
            communityId: null,
            credits: []
          }
        }
      } as never
    ]);

    const res = await request(app).get('/api/users/me/snatch-list');

    expect(res.status).toBe(200);
    expect(res.body[0].artist).toBeNull();
  });
});

// ─── User settings ────────────────────────────────────────────────────────────

describe('GET /api/users/settings', () => {
  it('returns settings for the authenticated user', async () => {
    const settings = { siteAppearance: 'dark', styledTooltips: true };
    getUserSettingsMock.mockResolvedValue(settings as never);

    const res = await request(app).get('/api/users/settings');

    expect(res.status).toBe(200);
    expect(res.body.siteAppearance).toBe('dark');
  });

  it('returns 404 when the user does not exist', async () => {
    getUserSettingsMock.mockResolvedValue(null);
    const res = await request(app).get('/api/users/settings');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/users/settings', () => {
  it('updates and returns settings', async () => {
    const updated = { siteAppearance: 'light', styledTooltips: false };
    updateUserSettingsMock.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/users/settings')
      .send({ siteAppearance: 'light' });

    expect(res.status).toBe(200);
    expect(res.body.siteAppearance).toBe('light');
  });

  it('returns 404 when the user does not exist', async () => {
    updateUserSettingsMock.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/users/settings')
      .send({ siteAppearance: 'light' });
    expect(res.status).toBe(404);
  });
});

// ─── Public user profile ──────────────────────────────────────────────────────

describe('GET /api/users/:id', () => {
  it('returns a public user profile', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ id: 9, username: 'alice' }) as never
    );

    const res = await request(app).get('/api/users/9');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
  });

  it('returns 404 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/users/9');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/users/not-a-number');
    expect(res.status).toBe(400);
  });
});

// ─── Admin user creation ──────────────────────────────────────────────────────

describe('POST /api/users', () => {
  beforeEach(() => setAdmin());

  it('creates a user and returns 201', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    createUserMock.mockResolvedValue(makeUser({ id: 20 }) as never);

    const res = await request(app).post('/api/users').send({
      username: 'newuser',
      email: 'new@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(201);
  });

  it('returns 400 when the username or email already exists', async () => {
    prismaMock.user.findFirst.mockResolvedValue(makeUser({ id: 1 }) as never);

    const res = await request(app).post('/api/users').send({
      username: 'existing',
      email: 'existing@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('User already exists');
  });

  it('returns 403 without users_edit permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app).post('/api/users').send({
      username: 'newuser',
      email: 'new@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newuser' }); // missing email and password
    expect(res.status).toBe(400);
  });
});

// ─── Warning deletion ─────────────────────────────────────────────────────────

describe('DELETE /api/users/:id/warnings/:warnId', () => {
  beforeEach(() => setStaff());

  it('deletes the warning and returns 204', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 5,
      userId: 9
    } as never);
    prismaMock.userWarning.delete.mockResolvedValue({} as never);
    prismaMock.userWarning.count.mockResolvedValue(1);

    const res = await request(app).delete('/api/users/9/warnings/5');

    expect(res.status).toBe(204);
    expect(prismaMock.userWarning.delete).toHaveBeenCalledWith({
      where: { id: 5 }
    });
  });

  it('clears the warned timestamp when no warnings remain', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 5,
      userId: 9
    } as never);
    prismaMock.userWarning.delete.mockResolvedValue({} as never);
    prismaMock.userWarning.count.mockResolvedValue(0);
    prismaMock.user.update.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/users/9/warnings/5');

    expect(res.status).toBe(204);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { warned: null }
    });
  });

  it('returns 404 when the warning does not belong to the user', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue({
      id: 5,
      userId: 99 // different user
    } as never);

    const res = await request(app).delete('/api/users/9/warnings/5');

    expect(res.status).toBe(404);
  });

  it('returns 404 when the warning does not exist', async () => {
    prismaMock.userWarning.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/api/users/9/warnings/5');

    expect(res.status).toBe(404);
  });
});

// ─── Donor rank update and deletion ──────────────────────────────────────────

describe('PUT /api/users/donor-ranks/:rankId', () => {
  beforeEach(() => setDonorRankManager());

  it('updates a donor rank and returns it', async () => {
    const existing = { id: 2, name: 'Silver', minDonation: 2000 };
    prismaMock.donorRank.findUnique.mockResolvedValue(existing as never);
    prismaMock.donorRank.update.mockResolvedValue({
      ...existing,
      name: 'Gold'
    } as never);

    const res = await request(app)
      .put('/api/users/donor-ranks/2')
      .send({ name: 'Gold', minDonation: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Gold');
  });

  it('updates a donor rank with all optional fields', async () => {
    const existing = { id: 2, name: 'Silver', minDonation: 2000 };
    prismaMock.donorRank.findUnique.mockResolvedValue(existing as never);
    prismaMock.donorRank.update.mockResolvedValue({
      ...existing,
      name: 'Platinum',
      expiresAfterDays: 90,
      perks: { extra: true },
      color: '#gold',
      badge: 'plat'
    } as never);

    const res = await request(app)
      .put('/api/users/donor-ranks/2')
      .send({
        name: 'Platinum',
        minDonation: 2000,
        expiresAfterDays: 90,
        perks: { extra: true },
        color: '#gold',
        badge: 'plat'
      });

    expect(res.status).toBe(200);
    expect(res.body.badge).toBe('plat');
  });

  it('returns 404 when the donor rank does not exist', async () => {
    prismaMock.donorRank.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/users/donor-ranks/2')
      .send({ name: 'Gold', minDonation: 2000 });

    expect(res.status).toBe(404);
  });

  it('returns 403 without donor_ranks_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app)
      .put('/api/users/donor-ranks/2')
      .send({ name: 'Gold', minDonation: 2000 });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/users/donor-ranks/:rankId', () => {
  beforeEach(() => setDonorRankManager());

  it('deletes a donor rank and returns 204', async () => {
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 2 } as never);
    prismaMock.donorRank.delete.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/users/donor-ranks/2');

    expect(res.status).toBe(204);
    expect(prismaMock.donorRank.delete).toHaveBeenCalledWith({
      where: { id: 2 }
    });
  });

  it('returns 404 when the donor rank does not exist', async () => {
    prismaMock.donorRank.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/users/donor-ranks/2');
    expect(res.status).toBe(404);
  });
});

// ─── Grant and revoke donor status ────────────────────────────────────────────

describe('POST /api/users/:id/donor', () => {
  beforeEach(() => setStaff());

  it('grants donor status and returns 201', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(
      makeUser({ id: 9 }) as never
    );
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/users/9/donor')
      .send({ donorRankId: 3 });

    expect(res.status).toBe(201);
    expect(res.body.msg).toBe('Donor status granted');
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/users/9/donor')
      .send({ donorRankId: 3 });

    expect(res.status).toBe(404);
  });

  it('returns 404 when the donor rank does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 9 }) as never);
    prismaMock.donorRank.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/users/9/donor')
      .send({ donorRankId: 99 });

    expect(res.status).toBe(404);
  });

  it('returns 400 when donorRankId is missing', async () => {
    const res = await request(app).post('/api/users/9/donor').send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/users/:id/donor', () => {
  beforeEach(() => setStaff());

  it('revokes donor status and returns 204', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 9 }) as never);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);

    const res = await request(app).delete('/api/users/9/donor');

    expect(res.status).toBe(204);
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/users/9/donor');
    expect(res.status).toBe(404);
  });
});

// ─── Staff snatch list ────────────────────────────────────────────────────────

describe('GET /api/users/:id/snatch-list', () => {
  beforeEach(() => setStaff());

  it('returns the snatch list for a user as staff', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      {
        id: 20,
        consumerId: 9,
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01'),
        contribution: {
          release: {
            id: 55,
            title: 'Dark Side',
            communityId: 2,
            credits: [{ role: 'Main', artist: { name: 'Pink Floyd' } }]
          }
        }
      }
    ] as never);

    const res = await request(app).get('/api/users/9/snatch-list');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].release.title).toBe('Dark Side');
  });

  it('returns 403 without staff permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).get('/api/users/9/snatch-list');
    expect(res.status).toBe(403);
  });

  it('returns null artist when release has no artist', async () => {
    prismaMock.downloadAccessGrant.findMany.mockResolvedValue([
      {
        id: 21,
        consumerId: 9,
        status: 'COMPLETED',
        createdAt: new Date('2026-01-01'),
        contribution: {
          release: {
            id: 56,
            title: 'Various Artists',
            communityId: 2,
            credits: []
          }
        }
      }
    ] as never);

    const res = await request(app).get('/api/users/9/snatch-list');

    expect(res.status).toBe(200);
    expect(res.body[0].artist).toBeNull();
  });
});

// ─── Additional branch coverage ───────────────────────────────────────────────

describe('POST /api/users/:id/warn with expiresAt', () => {
  beforeEach(() => setStaff());

  it('creates a warning with an expiry date', async () => {
    mockTargetUser();
    prismaMock.$transaction.mockResolvedValue([
      {
        id: 2,
        userId: 9,
        warnedById: 7,
        reason: 'Repeated violations',
        expiresAt: new Date('2026-12-31'),
        createdAt: new Date()
      },
      makeUser()
    ] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/users/9/warn').send({
      reason: 'Repeated violations',
      expiresAt: '2026-12-31T00:00:00.000Z'
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('warning');
  });
});

describe('PUT /api/users/:id/rank — rank not found', () => {
  beforeEach(() => setAdmin());

  it('returns 404 when the target rank does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 9 }) as never);
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true, users_edit: true })) // permission check
      .mockResolvedValueOnce(null);
    prismaMock.userRank.findMany.mockResolvedValue([] as never);

    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 999 });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('Rank not found');
  });

  it('returns 404 when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 2 });

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('User not found');
  });

  it('returns 422 when a non-secondary rank is assigned as a secondary class', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 9 }) as never);
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true, users_edit: true }))
      .mockResolvedValueOnce(null);
    prismaMock.userRank.findMany.mockResolvedValue([
      { id: 2, secondary: false },
      { id: 6, secondary: false }
    ] as never);

    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 2, secondaryRankIds: [6] });

    expect(res.status).toBe(422);
    expect(res.body.msg).toMatch(/secondary-class ranks/);
  });
});

describe('POST /api/users/:id/donor with expiresAt', () => {
  beforeEach(() => setStaff());

  it('grants donor status with an expiry date', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(
      makeUser({ id: 9 }) as never
    );
    prismaMock.donorRank.findUnique.mockResolvedValue({ id: 3 } as never);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .post('/api/users/9/donor')
      .send({ donorRankId: 3, expiresAt: '2027-01-01T00:00:00.000Z' });

    expect(res.status).toBe(201);
  });
});

// ─── Staff recovery queue ─────────────────────────────────────────────────────

describe('GET /api/users/recovery-requests', () => {
  beforeEach(() => setRecoveryManager());

  it('returns paginated pending recovery requests', async () => {
    prismaMock.accountRecovery.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 9,
        token: 'abc',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
        createdAt: new Date(),
        user: { username: 'alice', email: 'alice@example.com' }
      }
    ] as never);
    prismaMock.accountRecovery.count.mockResolvedValue(1);

    const res = await request(app).get('/api/users/recovery-requests');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].username).toBe('alice');
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 403 without recovery_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).get('/api/users/recovery-requests');
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/users/recovery-requests/:reqId', () => {
  beforeEach(() => setRecoveryManager());

  it('deletes a pending recovery request and audits', async () => {
    prismaMock.accountRecovery.findUnique.mockResolvedValue({
      id: 5,
      usedAt: null
    } as never);
    prismaMock.accountRecovery.delete.mockResolvedValue({} as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/users/recovery-requests/5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Recovery request revoked' });
  });

  it('returns 404 for an unknown request', async () => {
    prismaMock.accountRecovery.findUnique.mockResolvedValue(null);
    const res = await request(app).delete('/api/users/recovery-requests/99');
    expect(res.status).toBe(404);
  });

  it('returns 409 when token has already been used', async () => {
    prismaMock.accountRecovery.findUnique.mockResolvedValue({
      id: 5,
      usedAt: new Date()
    } as never);
    const res = await request(app).delete('/api/users/recovery-requests/5');
    expect(res.status).toBe(409);
  });

  it('returns 403 without recovery_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).delete('/api/users/recovery-requests/5');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/users/:id/recovery', () => {
  beforeEach(() => setRecoveryManager());

  it('sends a recovery email and audits', async () => {
    sendRecoveryEmailMock.mockResolvedValue(true);
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ id: 9, email: 'target@example.com', disabled: false }) as never
    );
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app).post('/api/users/9/recovery');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Recovery email sent' });
    expect(sendRecoveryEmailMock).toHaveBeenCalledWith(
      'target@example.com',
      expect.stringContaining('/recovery?token=')
    );
  });

  it('returns 404 for an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/users/999/recovery');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a disabled user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ id: 9, disabled: true }) as never
    );
    const res = await request(app).post('/api/users/9/recovery');
    expect(res.status).toBe(404);
  });

  it('returns 403 without recovery_manage permission', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    const res = await request(app).post('/api/users/9/recovery');
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/staff-bio', () => {
  beforeEach(() => setAdmin());

  it('allows an admin to edit another user bio', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 9 } as never);
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 9 }) as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/users/9/staff-bio')
      .send({ staffBio: 'Admin-updated bio' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ msg: 'Staff bio updated' });
  });

  it('allows a staff-listed user to edit their own bio', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    prismaMock.userRank.findUnique.mockResolvedValueOnce({
      displayStaff: true
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 } as never);
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 7 }) as never);
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/users/7/staff-bio')
      .send({ staffBio: 'My [b]bio[/b]' });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { staffBio: 'My [b]bio[/b]' }
    });
  });

  it('returns 403 when a non-staff-listed user edits their own bio', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );
    prismaMock.userRank.findUnique.mockResolvedValueOnce({
      displayStaff: false
    } as never);

    const res = await request(app)
      .put('/api/users/7/staff-bio')
      .send({ staffBio: 'Nope' });

    expect(res.status).toBe(403);
  });

  it('returns 403 when a non-admin edits another user bio', async () => {
    setCurrentUserPermissions(
      makeUserRank().permissions as Record<string, boolean>
    );

    const res = await request(app)
      .put('/api/users/9/staff-bio')
      .send({ staffBio: 'Nope' });

    expect(res.status).toBe(403);
  });
});

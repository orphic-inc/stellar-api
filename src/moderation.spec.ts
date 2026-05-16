import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';
import { makeUser } from './test/factories';

beforeEach(() => resetApiTestState());

// ─── Helpers ──────────────────────────────────────────────────────────────────

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true, users_warn: true, users_disable: true })
  );

const setAdmin = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({
      admin: true,
      staff: true,
      users_warn: true,
      users_disable: true
    })
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
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
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
});

// ─── Rank change ──────────────────────────────────────────────────────────────

describe('PUT /api/users/:id/rank', () => {
  beforeEach(() => setAdmin());

  it('updates the user rank and returns a msg', async () => {
    mockTargetUser();
    // Second findUnique call is for the rank lookup
    prismaMock.userRank.findUnique
      .mockResolvedValueOnce(makeUserRank({ admin: true })) // permission check
      .mockResolvedValueOnce(makeUserRank()); // rank existence check
    prismaMock.user.update.mockResolvedValue(makeUser());
    prismaMock.auditLog.create.mockResolvedValue({} as never);

    const res = await request(app)
      .put('/api/users/9/rank')
      .send({ userRankId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Rank updated');
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
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

// ─── IP history ───────────────────────────────────────────────────────────────

describe('GET /api/users/:id/ip-history', () => {
  beforeEach(() => setStaff());

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
    expect(res.body[0].ipAddress).toBe('1.2.3.4');
  });

  it('returns 403 without staff permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
    const res = await request(app).get('/api/users/9/ip-history');
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
  beforeEach(() => setAdmin());

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

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());
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
            artist: { name: 'Miles Davis' }
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
          artist: { name: 'Miles Davis' }
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
});

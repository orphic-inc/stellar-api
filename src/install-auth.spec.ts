import {
  request,
  app,
  mockedIsInstalled,
  prismaMock,
  makeUserRank,
  bcryptMock,
  createInviteMock,
  getProfileByIdMock,
  getProfileByLookupMock,
  updateProfileMock,
  getUserSettingsMock,
  updateUserSettingsMock,
  createUserMock,
  resetApiTestState
} from './test/apiTestHarness';
import { makeUser, asUserMock } from './test/factories';
import { updateProfile } from './modules/profile';
import { sendRecoveryEmail } from './lib/mailer';

const sendRecoveryEmailMock = sendRecoveryEmail as jest.Mock;

describe('API auth/profile/user flows', () => {
  beforeEach(() => {
    resetApiTestState();
  });

  it('blocks protected API routes until installation is complete', async () => {
    mockedIsInstalled.mockResolvedValue(false);

    const res = await request(app).get('/api/posts');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      installed: false,
      msg: 'Application not installed. Please complete setup at /install.'
    });
  });

  it('returns a msg response when registration hits an existing user', async () => {
    // Registration must be open to reach the duplicate-user check — the
    // harness default mirrors prod ('closed'), which rejects earlier.
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'open',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    });
    prismaMock.user.findFirst.mockResolvedValue(makeUser({ id: 1 }));

    const res = await request(app).post('/api/auth/register').send({
      username: 'existing-user',
      email: 'exists@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User already exists' });
  });

  it('rejects self-registration when registration is closed', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'closed',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    });

    const res = await request(app).post('/api/auth/register').send({
      username: 'closed-user',
      email: 'closed@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Registration is currently closed' });
  });

  it('enforces invite-only registration rules and accepts a matching invite', async () => {
    prismaMock.siteSettings.upsert.mockResolvedValue({
      id: 1,
      approvedDomains: [],
      registrationStatus: 'invite',
      maxUsers: 7000,
      dismissedLaunchChecklist: [],
      installedAt: null,
      updatedAt: new Date()
    });

    const missingInvite = await request(app).post('/api/auth/register').send({
      username: 'invite-user',
      email: 'invite@example.com',
      password: 'password123'
    });
    expect(missingInvite.status).toBe(403);

    prismaMock.invite.findUnique.mockResolvedValueOnce(null);
    const invalidInvite = await request(app).post('/api/auth/register').send({
      username: 'invite-user',
      email: 'invite@example.com',
      password: 'password123',
      inviteKey: 'bad-key'
    });
    expect(invalidInvite.status).toBe(403);

    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 1,
      inviterId: 5,
      inviteKey: 'abc123',
      email: 'other@example.com',
      expires: new Date(),
      reason: 'Referral',
      status: 'pending'
    });
    const wrongEmail = await request(app).post('/api/auth/register').send({
      username: 'invite-user',
      email: 'invite@example.com',
      password: 'password123',
      inviteKey: 'abc123'
    });
    expect(wrongEmail.status).toBe(403);

    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 2,
      inviterId: 5,
      inviteKey: 'good-key',
      email: 'invite@example.com',
      expires: new Date(),
      reason: 'Referral',
      status: 'pending'
    });
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.badPassword.findFirst.mockResolvedValueOnce(null);
    prismaMock.userRank.findFirst.mockResolvedValueOnce(makeUserRank());
    prismaMock.$transaction.mockImplementationOnce(async (cb: unknown) =>
      (cb as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
    );
    prismaMock.userSettings.create.mockResolvedValueOnce({ id: 4 } as never);
    prismaMock.profile.create.mockResolvedValueOnce({ id: 5 } as never);
    prismaMock.user.create.mockResolvedValueOnce(
      asUserMock({
        id: 12,
        username: 'invite-user',
        email: 'invite@example.com',
        password: 'hashed-password',
        avatar: null,
        isArtist: false,
        isDonor: false,
        canDownload: true,
        inviteCount: 0,
        contributed: BigInt(0),
        consumed: BigInt(0),
        ratio: 0,
        dateRegistered: '2026-04-24T00:00:00.000Z',
        lastLogin: '2026-04-24T00:00:00.000Z',
        userRank: {
          id: 1,
          level: 100,
          name: 'User',
          color: '',
          badge: '',
          permissions: {},
          personalCollageLimit: 0
        },
        secondaryRanks: []
      })
    );
    prismaMock.invite.update.mockResolvedValueOnce({} as never);

    const accepted = await request(app).post('/api/auth/register').send({
      username: 'invite-user',
      email: 'invite@example.com',
      password: 'password123',
      inviteKey: 'good-key'
    });

    expect(accepted.status).toBe(201);
    expect(prismaMock.invite.update).toHaveBeenCalledWith({
      where: { inviteKey: 'good-key' },
      data: { status: 'accepted' }
    });
  });

  it('returns a msg response when login is attempted on a disabled account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: true })
    );

    const res = await request(app).post('/api/auth').send({
      email: 'disabled@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Account disabled' });
  });

  it('logs in successfully and returns a user plus auth cookie', async () => {
    const authUser = {
      id: 7,
      username: 'kai',
      email: 'kai@example.com',
      avatar: null,
      isArtist: false,
      isDonor: false,
      canDownload: true,
      inviteCount: 0,
      contributed: '10',
      consumed: '5',
      ratio: 2,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastLogin: '2026-04-24T00:00:00.000Z',
      userRank: {
        id: 1,
        level: 100,
        name: 'User',
        color: '',
        badge: '',
        permissions: {},
        personalCollageLimit: 0,
        authorStylesheetLimit: 0
      },
      secondaryRanks: []
    };
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: false })
    );
    bcryptMock.compare.mockResolvedValue(true);
    prismaMock.user.update.mockResolvedValue(
      asUserMock({
        ...authUser,
        contributed: BigInt(10),
        consumed: BigInt(5),
        ratio: 0
      })
    );
    prismaMock.userSession.create.mockResolvedValue({
      id: 'test-session-id',
      userId: 7,
      ipAddress: '',
      userAgent: '',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      revokedAt: null
    });

    const res = await request(app).post('/api/auth').send({
      email: 'kai@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: authUser });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=signed-jwt')])
    );
  });

  it('returns invalid credentials when the password does not match', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: false })
    );
    bcryptMock.compare.mockResolvedValue(false);

    const res = await request(app).post('/api/auth').send({
      email: 'kai@example.com',
      password: 'wrong-password'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'Invalid credentials' });
  });

  it('returns the current authenticated user from /api/auth', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      asUserMock({
        id: 7,
        username: 'kai',
        email: 'kai@example.com',
        avatar: null,
        isArtist: false,
        isDonor: false,
        canDownload: true,
        inviteCount: 0,
        contributed: BigInt(0),
        consumed: BigInt(0),
        ratio: 0,
        dateRegistered: '2026-04-24T00:00:00.000Z',
        lastLogin: '2026-04-24T00:00:00.000Z',
        userRank: {
          id: 1,
          level: 100,
          name: 'User',
          color: '',
          badge: '',
          permissions: {},
          personalCollageLimit: 0
        },
        secondaryRanks: []
      })
    );

    const res = await request(app).get('/api/auth');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('kai');
    expect(res.body.contributed).toBe('0');
    expect(res.body.consumed).toBe('0');
  });

  it('returns 401 from /api/auth when the authenticated user no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/auth');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ msg: 'Unauthorized' });
  });

  it('clears the auth cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=;')])
    );
  });

  it('changes password and revokes active sessions', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      password: 'hashed-password'
    } as never);
    bcryptMock.compare.mockResolvedValue(true);
    prismaMock.badPassword.findFirst.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/password').send({
      currentPassword: 'password123',
      newPassword: 'new-password-123'
    });

    expect(res.status).toBe(204);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { password: 'hashed-password' }
    });
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('rejects password changes for bad current passwords or banned new passwords', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7,
      password: 'hashed-password'
    } as never);
    bcryptMock.compare.mockResolvedValueOnce(false);

    const wrongCurrent = await request(app).post('/api/auth/password').send({
      currentPassword: 'wrong',
      newPassword: 'new-password-123'
    });
    expect(wrongCurrent.status).toBe(400);

    bcryptMock.compare.mockResolvedValueOnce(true);
    prismaMock.badPassword.findFirst.mockResolvedValueOnce({ id: 1 } as never);

    const banned = await request(app).post('/api/auth/password').send({
      currentPassword: 'password123',
      newPassword: 'password'
    });
    expect(banned.status).toBe(400);
    expect(banned.body).toEqual({ msg: 'Password is not allowed' });
  });

  it('changes email with a password check and writes email history', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 7,
        email: 'old@example.com',
        password: 'hashed-password'
      } as never)
      .mockResolvedValueOnce(null);
    bcryptMock.compare.mockResolvedValue(true);

    const res = await request(app)
      .put('/api/auth/email')
      .set('x-forwarded-for', '203.0.113.10, 10.0.0.1')
      .send({
        newEmail: 'NEW@example.com',
        password: 'password123'
      });

    expect(res.status).toBe(200);
    expect(prismaMock.userEmailHistory.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        oldEmail: 'old@example.com',
        newEmail: 'new@example.com',
        ipAddress: '203.0.113.10'
      }
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { email: 'new@example.com' }
    });
  });

  it('rejects email changes for wrong passwords or duplicate emails', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 7,
      email: 'old@example.com',
      password: 'hashed-password'
    } as never);
    bcryptMock.compare.mockResolvedValueOnce(false);

    const wrongPassword = await request(app).put('/api/auth/email').send({
      newEmail: 'new@example.com',
      password: 'wrong'
    });
    expect(wrongPassword.status).toBe(400);

    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 7,
        email: 'old@example.com',
        password: 'hashed-password'
      } as never)
      .mockResolvedValueOnce(makeUser({ id: 12, email: 'new@example.com' }));
    bcryptMock.compare.mockResolvedValueOnce(true);

    const duplicate = await request(app).put('/api/auth/email').send({
      newEmail: 'new@example.com',
      password: 'password123'
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({ msg: 'Email already in use' });
  });

  it('handles recovery requests and reset flows', async () => {
    sendRecoveryEmailMock.mockResolvedValue(true);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 7,
      email: 'kai@example.com'
    } as never);
    prismaMock.$transaction.mockResolvedValueOnce([{}, { id: 1 }] as never);

    const requestRes = await request(app)
      .post('/api/auth/recovery/request')
      .send({ email: 'kai@example.com' });

    expect(requestRes.status).toBe(200);
    expect(sendRecoveryEmailMock).toHaveBeenCalledWith(
      'kai@example.com',
      expect.stringContaining('/recovery?token=')
    );

    prismaMock.accountRecovery.findFirst.mockResolvedValueOnce(null);
    const invalidReset = await request(app)
      .post('/api/auth/recovery/reset')
      .send({ token: 'bad-token', newPassword: 'new-password-123' });
    expect(invalidReset.status).toBe(400);

    prismaMock.accountRecovery.findFirst.mockResolvedValueOnce({
      id: 9,
      userId: 7
    } as never);
    prismaMock.badPassword.findFirst.mockResolvedValueOnce({ id: 1 } as never);
    const bannedReset = await request(app)
      .post('/api/auth/recovery/reset')
      .send({ token: 'good-token', newPassword: 'password' });
    expect(bannedReset.status).toBe(400);

    prismaMock.accountRecovery.findFirst.mockResolvedValueOnce({
      id: 9,
      userId: 7
    } as never);
    prismaMock.badPassword.findFirst.mockResolvedValueOnce(null);
    const successReset = await request(app)
      .post('/api/auth/recovery/reset')
      .send({ token: 'good-token', newPassword: 'new-password-123' });

    expect(successReset.status).toBe(200);
    expect(prismaMock.accountRecovery.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { usedAt: expect.any(Date) }
    });
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('skips token creation when sendRecoveryEmail returns false (SMTP off)', async () => {
    sendRecoveryEmailMock.mockResolvedValueOnce(false);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 7,
      email: 'kai@example.com'
    } as never);

    const res = await request(app)
      .post('/api/auth/recovery/request')
      .send({ email: 'kai@example.com' });

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('lists and revokes the current user sessions', async () => {
    prismaMock.userSession.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        userId: 7,
        ipAddress: '203.0.113.10',
        userAgent: 'Jest',
        createdAt: new Date(),
        lastActiveAt: new Date(),
        revokedAt: null
      }
    ] as never);

    const listRes = await request(app).get('/api/auth/sessions');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    prismaMock.userSession.findFirst.mockResolvedValueOnce(null);
    const missingRes = await request(app).delete('/api/auth/sessions/sess-2');
    expect(missingRes.status).toBe(404);

    prismaMock.userSession.findFirst.mockResolvedValueOnce({
      id: 'sess-1',
      userId: 7
    } as never);
    prismaMock.userSession.update.mockResolvedValueOnce({} as never);

    const deleteRes = await request(app).delete('/api/auth/sessions/sess-1');
    expect(deleteRes.status).toBe(204);
    expect(prismaMock.userSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it('maps profile invite exhaustion to a msg response', async () => {
    createInviteMock.mockResolvedValue({ ok: false, reason: 'no_invites' });

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({
        email: 'friend@example.com',
        reason: 'trusted collaborator'
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'No invites remaining' });
  });

  it('returns the invite key on successful invite creation', async () => {
    createInviteMock.mockResolvedValue({
      ok: true,
      inviteKey: 'invite-key-123',
      emailSent: true
    });

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({
        email: 'friend@example.com',
        reason: 'trusted collaborator'
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ inviteKey: 'invite-key-123', emailSent: true });
  });

  it('returns the refreshed profile payload after updating /profile/me', async () => {
    updateProfileMock.mockResolvedValue({
      id: 7,
      username: 'kai',
      avatar: null,
      profile: {
        id: 3,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'New Title',
        profileInfo: null,
        profileInfoHtml: ''
      },
      userSettings: {
        id: 4,
        siteAppearance: 'dark',
        externalStylesheet: null,
        activeAuthorStylesheetId: null,
        styledTooltips: true,
        paranoia: 0,
        notificationMethod: 'Popup' as const,
        showEmail: false,
        showLastSeen: false,
        showContributedStats: true,
        showConsumedStats: true,
        showRatioStats: true
      },
      userRank: {
        id: 1,
        name: 'User',
        color: '',
        badge: '',
        displayStaff: false
      },
      inviteTree: [],
      community: null,
      email: null,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastSeen: null,
      isArtist: false,
      isDonor: false,
      disabled: false,
      warned: null,
      standing: 'clean',
      inviteCount: 0,
      stats: {
        contributed: '0',
        consumed: '0',
        ratio: '1.00',
        buffer: '0'
      },
      activitySummary: {
        contributions: 0,
        requestsCreated: 0,
        requestsFilled: 0,
        forumTopics: 0,
        forumPosts: 0,
        comments: 0,
        collagesStarted: 0,
        collageEntries: 0
      },
      percentiles: {
        contributed: { percentile: 100, rank: 1, total: 1, raw: 0 },
        consumed: { percentile: 100, rank: 1, total: 1, raw: 0 },
        contributions: { percentile: 100, rank: 1, total: 1, raw: 0 },
        forumPosts: { percentile: 100, rank: 1, total: 1, raw: 0 },
        requestsFilled: { percentile: 100, rank: 1, total: 1, raw: 0 },
        artistsAdded: { percentile: 100, rank: 1, total: 1, raw: 0 },
        overall: 100
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
      staffBio: null,
      recentContributions: [],
      recentSnatches: []
    } as Awaited<ReturnType<typeof updateProfile>>);

    const res = await request(app).put('/api/profile/me').send({
      profileTitle: 'New Title',
      siteAppearance: 'dark'
    });

    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(7, {
      profileTitle: 'New Title',
      siteAppearance: 'dark'
    });
    expect(res.body.profile.profileTitle).toBe('New Title');
  });

  it('returns the current profile aggregate from /api/profile/me', async () => {
    getProfileByIdMock.mockResolvedValue({
      id: 7,
      username: 'kai',
      avatar: null,
      email: 'kai@example.com',
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastSeen: '2026-04-24T00:00:00.000Z',
      isArtist: false,
      isDonor: false,
      disabled: false,
      warned: null,
      standing: 'clean',
      inviteCount: 1,
      stats: {
        contributed: '100',
        consumed: '50',
        ratio: '2.00',
        buffer: '50'
      },
      userRank: {
        id: 1,
        name: 'User',
        color: '',
        badge: '',
        displayStaff: false
      },
      profile: {
        id: 3,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'Title',
        profileInfo: '<p>bio</p>',
        profileInfoHtml: '<p>bio</p>'
      },
      userSettings: {
        id: 4,
        siteAppearance: 'dark',
        externalStylesheet: null,
        activeAuthorStylesheetId: null,
        styledTooltips: true,
        paranoia: 0,
        notificationMethod: 'Popup',
        showEmail: true,
        showLastSeen: true,
        showContributedStats: true,
        showConsumedStats: true,
        showRatioStats: true
      },
      activitySummary: {
        contributions: 1,
        requestsCreated: 2,
        requestsFilled: 3,
        forumTopics: 4,
        forumPosts: 5,
        comments: 6,
        collagesStarted: 7,
        collageEntries: 8
      },
      percentiles: {
        contributed: { percentile: 90, rank: 2, total: 10, raw: 900 },
        consumed: { percentile: 80, rank: 3, total: 10, raw: 800 },
        contributions: { percentile: 70, rank: 4, total: 10, raw: 1 },
        forumPosts: { percentile: 60, rank: 5, total: 10, raw: 5 },
        requestsFilled: { percentile: 50, rank: 6, total: 10, raw: 3 },
        artistsAdded: { percentile: 40, rank: 7, total: 10, raw: 2 },
        overall: 72
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
      staffBio: null,
      recentContributions: [],
      recentSnatches: [],
      inviteTree: [],
      community: null
    });

    const res = await request(app).get('/api/profile/me');

    expect(res.status).toBe(200);
    expect(getProfileByIdMock).toHaveBeenCalledWith(7, 7);
    expect(res.body.stats.ratio).toBe('2.00');
  });

  it('returns the viewer-aware profile aggregate from /api/profile/user/:userId', async () => {
    getProfileByLookupMock.mockResolvedValue({
      id: 9,
      username: 'target-user',
      avatar: null,
      email: null,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastSeen: null,
      isArtist: false,
      isDonor: false,
      disabled: false,
      warned: null,
      standing: 'clean',
      inviteCount: null,
      stats: {
        contributed: null,
        consumed: null,
        ratio: null,
        buffer: null
      },
      userRank: {
        id: 1,
        name: 'User',
        color: '',
        badge: '',
        displayStaff: false
      },
      profile: {
        id: 5,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'Hidden Stats',
        profileInfo: '<p>bio</p>',
        profileInfoHtml: '<p>bio</p>'
      },
      activitySummary: {
        contributions: 0,
        requestsCreated: 0,
        requestsFilled: 0,
        forumTopics: 0,
        forumPosts: 0,
        comments: 0,
        collagesStarted: 0,
        collageEntries: 0
      },
      percentiles: {
        contributed: { percentile: 10, rank: 9, total: 10, raw: 0 },
        consumed: { percentile: 10, rank: 9, total: 10, raw: 0 },
        contributions: { percentile: 10, rank: 9, total: 10, raw: 0 },
        forumPosts: { percentile: 10, rank: 9, total: 10, raw: 0 },
        requestsFilled: { percentile: 10, rank: 9, total: 10, raw: 0 },
        artistsAdded: { percentile: 10, rank: 9, total: 10, raw: 0 },
        overall: 10
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
      staffBio: null,
      recentContributions: [],
      recentSnatches: [],
      userSettings: undefined,
      inviteTree: [],
      community: null
    });

    const res = await request(app).get('/api/profile/user/target-user');

    expect(res.status).toBe(200);
    expect(getProfileByLookupMock).toHaveBeenCalledWith('target-user', 7);
    expect(res.body.email).toBeNull();
  });

  it('disables the current account and clears the auth cookie', async () => {
    prismaMock.user.update.mockResolvedValue(
      asUserMock({ id: 7, disabled: true })
    );

    const res = await request(app).delete('/api/profile');

    expect(res.status).toBe(204);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { disabled: true }
    });
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('token=;')])
    );
  });

  it('returns user settings for the authenticated user', async () => {
    getUserSettingsMock.mockResolvedValue({
      id: 4,
      siteAppearance: 'dark',
      externalStylesheet: null,
      styledTooltips: true,
      paranoia: 1,
      notificationMethod: 'Popup' as const,
      showEmail: false,
      showLastSeen: false,
      showContributedStats: true,
      showConsumedStats: true,
      showRatioStats: true,
      activeAuthorStylesheetId: null,
      ircNick: 'stargazer'
    });

    const res = await request(app).get('/api/users/settings');

    expect(res.status).toBe(200);
    expect(getUserSettingsMock).toHaveBeenCalledWith(7);
    expect(res.body.siteAppearance).toBe('dark');
    expect(res.body.ircNick).toBe('stargazer');
  });

  it('returns the updated settings payload from /api/users/settings', async () => {
    updateUserSettingsMock.mockResolvedValue({
      id: 4,
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png',
      notificationMethod: 'Popup' as const,
      showEmail: true,
      showLastSeen: true,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false,
      activeAuthorStylesheetId: null
    });

    const res = await request(app).put('/api/users/settings').send({
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png',
      showEmail: true,
      showLastSeen: true,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    });

    expect(res.status).toBe(200);
    expect(updateUserSettingsMock).toHaveBeenCalledWith(7, {
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png',
      showEmail: true,
      showLastSeen: true,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    });
    expect(res.body.avatar).toBe('https://example.com/avatar.png');
  });

  it('rejects admin user creation without users_edit permission', async () => {
    const res = await request(app).post('/api/users').send({
      username: 'new-user',
      email: 'new@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ msg: 'Permission denied' });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('returns a msg response when admin user creation hits an existing user', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ users_edit: true })
    );
    prismaMock.user.findFirst.mockResolvedValue(makeUser({ id: 99 }));

    const res = await request(app).post('/api/users').send({
      username: 'existing-user',
      email: 'exists@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User already exists' });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('creates a user for admins with users_edit permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ users_edit: true })
    );
    prismaMock.user.findFirst.mockResolvedValue(null);
    createUserMock.mockResolvedValue({
      id: 18,
      username: 'new-user',
      email: 'new@example.com'
    });

    const res = await request(app).post('/api/users').send({
      username: 'new-user',
      email: 'new@example.com',
      password: 'password123',
      userRankId: 2
    });

    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalledWith(
      {
        username: 'new-user',
        email: 'new@example.com',
        password: 'password123',
        userRankId: 2
      },
      7
    );
    expect(res.body).toEqual({
      id: 18,
      username: 'new-user',
      email: 'new@example.com'
    });
  });
});

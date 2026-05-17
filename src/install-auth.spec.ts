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
    prismaMock.user.findFirst.mockResolvedValue(makeUser({ id: 1 }));

    const res = await request(app).post('/api/auth/register').send({
      username: 'existing-user',
      email: 'exists@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ msg: 'User already exists' });
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
      uploaded: '0',
      downloaded: '0',
      ratio: 0,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastLogin: '2026-04-24T00:00:00.000Z',
      userRank: {
        level: 100,
        name: 'User',
        color: '',
        badge: '',
        permissions: {}
      }
    };
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: 'hashed-password', disabled: false })
    );
    bcryptMock.compare.mockResolvedValue(true);
    prismaMock.user.update.mockResolvedValue(
      asUserMock({ ...authUser, uploaded: BigInt(0), downloaded: BigInt(0) })
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
        dateRegistered: '2026-04-24T00:00:00.000Z',
        lastLogin: '2026-04-24T00:00:00.000Z',
        userRank: {
          level: 100,
          name: 'User',
          color: '',
          badge: '',
          permissions: {}
        }
      })
    );

    const res = await request(app).get('/api/auth');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('kai');
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
        profileInfo: null
      },
      userSettings: {
        id: 4,
        siteAppearance: 'dark',
        externalStylesheet: null,
        styledTooltips: true,
        paranoia: 0,
        notificationMethod: 'Popup' as const,
        showEmail: false,
        showLastSeen: false,
        showUploadedStats: true,
        showDownloadedStats: true,
        showRatioStats: true
      },
      userRank: { id: 1, name: 'User', color: '', badge: '' },
      inviteTree: [],
      email: null,
      dateRegistered: '2026-04-24T00:00:00.000Z',
      lastSeen: null,
      isArtist: false,
      isDonor: false,
      disabled: false,
      warned: null,
      inviteCount: 0,
      stats: {
        uploaded: '0',
        downloaded: '0',
        totalEarned: '0',
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
        uploaded: { percentile: 100, rank: 1, total: 1 },
        downloaded: { percentile: 100, rank: 1, total: 1 },
        contributions: { percentile: 100, rank: 1, total: 1 },
        forumPosts: { percentile: 100, rank: 1, total: 1 },
        requestsFilled: { percentile: 100, rank: 1, total: 1 }
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
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
      inviteCount: 1,
      stats: {
        uploaded: '100',
        downloaded: '50',
        totalEarned: '100',
        ratio: '2.00',
        buffer: '50'
      },
      userRank: { id: 1, name: 'User', color: '', badge: '' },
      profile: {
        id: 3,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'Title',
        profileInfo: '<p>bio</p>'
      },
      userSettings: {
        id: 4,
        siteAppearance: 'dark',
        externalStylesheet: null,
        styledTooltips: true,
        paranoia: 0,
        notificationMethod: 'Popup',
        showEmail: true,
        showLastSeen: true,
        showUploadedStats: true,
        showDownloadedStats: true,
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
        uploaded: { percentile: 90, rank: 2, total: 10 },
        downloaded: { percentile: 80, rank: 3, total: 10 },
        contributions: { percentile: 70, rank: 4, total: 10 },
        forumPosts: { percentile: 60, rank: 5, total: 10 },
        requestsFilled: { percentile: 50, rank: 6, total: 10 }
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
      recentContributions: [],
      recentSnatches: [],
      inviteTree: []
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
      inviteCount: null,
      stats: {
        uploaded: null,
        downloaded: null,
        totalEarned: null,
        ratio: null,
        buffer: null
      },
      userRank: { id: 1, name: 'User', color: '', badge: '' },
      profile: {
        id: 5,
        avatar: null,
        avatarMouseoverText: null,
        profileTitle: 'Hidden Stats',
        profileInfo: '<p>bio</p>'
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
        uploaded: { percentile: 10, rank: 9, total: 10 },
        downloaded: { percentile: 10, rank: 9, total: 10 },
        contributions: { percentile: 10, rank: 9, total: 10 },
        forumPosts: { percentile: 10, rank: 9, total: 10 },
        requestsFilled: { percentile: 10, rank: 9, total: 10 }
      },
      donorPresentation: null,
      collageShelves: {
        featuredPersonalCollages: [],
        publicCollages: []
      },
      staffPmOverview: null,
      recentContributions: [],
      recentSnatches: [],
      userSettings: undefined,
      inviteTree: []
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
      showUploadedStats: true,
      showDownloadedStats: true,
      showRatioStats: true
    });

    const res = await request(app).get('/api/users/settings');

    expect(res.status).toBe(200);
    expect(getUserSettingsMock).toHaveBeenCalledWith(7);
    expect(res.body.siteAppearance).toBe('dark');
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
      showUploadedStats: false,
      showDownloadedStats: false,
      showRatioStats: false
    });

    const res = await request(app).put('/api/users/settings').send({
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png',
      showEmail: true,
      showLastSeen: true,
      showUploadedStats: false,
      showDownloadedStats: false,
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
      showUploadedStats: false,
      showDownloadedStats: false,
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

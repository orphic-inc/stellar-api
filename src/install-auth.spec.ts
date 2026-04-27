import {
  request,
  app,
  mockedIsInstalled,
  prismaMock,
  makeUserRank,
  bcryptMock,
  createInviteMock,
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
    prismaMock.user.update.mockResolvedValue(asUserMock(authUser));

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
      inviteKey: 'invite-key-123'
    });

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({
        email: 'friend@example.com',
        reason: 'trusted collaborator'
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ inviteKey: 'invite-key-123' });
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
        paranoia: 0
      },
      userRank: { name: 'User', color: '' },
      inviteTree: []
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
      paranoia: 1
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
      avatar: 'https://example.com/avatar.png'
    });

    const res = await request(app).put('/api/users/settings').send({
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png'
    });

    expect(res.status).toBe(200);
    expect(updateUserSettingsMock).toHaveBeenCalledWith(7, {
      siteAppearance: 'light',
      externalStylesheet: 'https://example.com/style.css',
      styledTooltips: false,
      paranoia: 2,
      avatar: 'https://example.com/avatar.png'
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

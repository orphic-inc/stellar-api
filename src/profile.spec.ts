import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  getProfileByIdMock,
  getProfileByLookupMock,
  updateProfileMock,
  createInviteMock
} from './test/apiTestHarness';

jest.mock('./modules/ratio', () => ({
  getRatioStats: jest.fn()
}));

jest.mock('./modules/ratioPolicy', () => ({
  getPolicyState: jest.fn()
}));

jest.mock('./modules/rankProgressionJob', () => ({
  // startRankProgressionJob is invoked at app bootstrap — keep it a noop
  startRankProgressionJob: jest.fn()
}));

import { getRatioStats } from './modules/ratio';
import { getPolicyState } from './modules/ratioPolicy';

const getRatioStatsMock = getRatioStats as jest.MockedFunction<
  typeof getRatioStats
>;
const getPolicyStateMock = getPolicyState as jest.MockedFunction<
  typeof getPolicyState
>;

const mockProfile = {
  id: 7,
  username: 'testuser',
  email: 'test@example.com',
  avatar: null,
  profile: null
};

const mockRatioStats = {
  contributed: '1000000000',
  consumed: '500000000',
  ratio: 2.0,
  requiredRatio: 0.6,
  meetsRequirement: true,
  bracket: { label: '1–2 GB' },
  contributionCoverage: 1.0,
  eligibleContributionBytes: '500000000'
};

beforeEach(() => {
  resetApiTestState();
  getProfileByIdMock.mockResolvedValue(mockProfile as never);
  getProfileByLookupMock.mockResolvedValue(mockProfile as never);
  updateProfileMock.mockResolvedValue(mockProfile as never);
  getRatioStatsMock.mockResolvedValue(mockRatioStats as never);
  getPolicyStateMock.mockResolvedValue(null as never);
  prismaMock.auditLog.create.mockResolvedValue({} as never);
});

describe('GET /api/profile/me', () => {
  it('returns own profile', async () => {
    const res = await request(app).get('/api/profile/me');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
  });

  it('returns 404 when profile not found', async () => {
    getProfileByIdMock.mockResolvedValue(null as never);

    const res = await request(app).get('/api/profile/me');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/profile', () => {
  it('returns list of active users', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 7, username: 'testuser', avatar: null, profile: null }
    ] as never);

    const res = await request(app).get('/api/profile');

    expect(res.status).toBe(200);
    expect(res.body[0].username).toBe('testuser');
  });
});

describe('GET /api/profile/user/:userId', () => {
  it('returns profile by id or username', async () => {
    const res = await request(app).get('/api/profile/user/testuser');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
    expect(getProfileByLookupMock).toHaveBeenCalledWith('testuser', 7);
  });

  it('returns 404 when user not found', async () => {
    getProfileByLookupMock.mockResolvedValue(null as never);

    const res = await request(app).get('/api/profile/user/nobody');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/profile/me/ratio', () => {
  it('returns ratio stats and policy', async () => {
    const res = await request(app).get('/api/profile/me/ratio');

    expect(res.status).toBe(200);
    expect(res.body.ratio).toBe(2.0);
    expect(res.body.policy).toBeNull();
  });
});

describe('PUT /api/profile/me', () => {
  it('updates profile and returns updated data', async () => {
    const res = await request(app)
      .put('/api/profile/me')
      .send({ profileTitle: 'Jazz fan' });

    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(7, {
      profileTitle: 'Jazz fan'
    });
  });

  it('returns 404 when user not found', async () => {
    updateProfileMock.mockResolvedValue(null as never);

    const res = await request(app)
      .put('/api/profile/me')
      .send({ profileTitle: 'Jazz fan' });

    expect(res.status).toBe(404);
  });

  it('accepts an https external stylesheet URL', async () => {
    const res = await request(app)
      .put('/api/profile/me')
      .send({ externalStylesheet: 'https://cdn.example.com/theme.css' });

    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(7, {
      externalStylesheet: 'https://cdn.example.com/theme.css'
    });
  });

  it.each([
    ['http', 'http://cdn.example.com/theme.css'],
    ['ftp', 'ftp://cdn.example.com/theme.css'],
    ['javascript', 'javascript:alert(1)']
  ])(
    'rejects a non-https (%s) external stylesheet URL (400)',
    async (_s, url) => {
      const res = await request(app)
        .put('/api/profile/me')
        .send({ externalStylesheet: url });

      expect(res.status).toBe(400);
      expect(updateProfileMock).not.toHaveBeenCalled();
    }
  );

  it('accepts an empty string to clear the external stylesheet', async () => {
    const res = await request(app)
      .put('/api/profile/me')
      .send({ externalStylesheet: '' });

    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(7, {
      externalStylesheet: ''
    });
  });
});

describe('DELETE /api/profile', () => {
  it('disables account and clears cookie, returns 204', async () => {
    prismaMock.user.update.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/profile');

    expect(res.status).toBe(204);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { disabled: true }
    });
  });
});

describe('POST /api/profile/referral/create-invite', () => {
  it('creates invite and returns inviteKey', async () => {
    createInviteMock.mockResolvedValue({
      ok: true,
      inviteKey: 'abc123',
      emailSent: true
    } as never);

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({ email: 'newuser@example.com', reason: 'Great community member' });

    expect(res.status).toBe(201);
    expect(res.body.inviteKey).toBe('abc123');
  });

  it('returns 403 when user has no invites remaining', async () => {
    createInviteMock.mockResolvedValue({
      ok: false,
      reason: 'no_invites'
    } as never);

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({ email: 'newuser@example.com' });

    expect(res.status).toBe(403);
  });

  it('returns 409 when invite already sent to that address', async () => {
    createInviteMock.mockResolvedValue({
      ok: false,
      reason: 'duplicate'
    } as never);

    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({ email: 'existing@example.com' });

    expect(res.status).toBe(409);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/profile/referral/create-invite')
      .send({ reason: 'No email provided' });

    expect(res.status).toBe(400);
  });
});

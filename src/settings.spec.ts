import {
  request,
  app,
  resetApiTestState,
  prismaMock,
  makeUserRank
} from './test/apiTestHarness';

jest.mock('./modules/settings', () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn()
}));

import { getSettings, updateSettings } from './modules/settings';

const getSettingsMock = getSettings as jest.MockedFunction<typeof getSettings>;
const updateSettingsMock = updateSettings as jest.MockedFunction<
  typeof updateSettings
>;

const mockSettings = {
  id: 1,
  registrationStatus: 'open',
  maxUsers: 5000,
  approvedDomains: ['example.com'],
  dismissedLaunchChecklist: [],
  updatedAt: new Date('2026-01-01')
};

beforeEach(() => {
  resetApiTestState();
  getSettingsMock.mockResolvedValue(mockSettings as never);
  updateSettingsMock.mockResolvedValue(mockSettings as never);
});

describe('GET /api/settings', () => {
  it('returns site settings for authenticated user', async () => {
    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.registrationStatus).toBe('open');
  });
});

describe('PUT /api/settings', () => {
  beforeEach(() => {
    prismaMock.userRank.findUnique.mockResolvedValue(
      makeUserRank({ admin: true })
    );
    prismaMock.auditLog.create.mockResolvedValue({
      id: 1,
      actorId: 7,
      action: 'settings.update',
      targetType: 'SiteSettings',
      targetId: 1,
      meta: {},
      createdAt: new Date()
    } as never);
  });

  it('updates settings and returns them', async () => {
    const updated = { ...mockSettings, registrationStatus: 'invite' };
    updateSettingsMock.mockResolvedValue(updated as never);

    const res = await request(app)
      .put('/api/settings')
      .send({ registrationStatus: 'invite', maxUsers: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.registrationStatus).toBe('invite');
    expect(updateSettingsMock).toHaveBeenCalled();
  });

  it('returns 403 without admin permission', async () => {
    prismaMock.userRank.findUnique.mockResolvedValue(makeUserRank());

    const res = await request(app)
      .put('/api/settings')
      .send({ registrationStatus: 'open', maxUsers: 5000 });

    expect(res.status).toBe(403);
  });

  it('returns 400 when registrationStatus is invalid', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ registrationStatus: 'invalid_value' });

    expect(res.status).toBe(400);
  });
});

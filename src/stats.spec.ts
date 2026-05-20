import { request, app, resetApiTestState } from './test/apiTestHarness';

jest.mock('./modules/stats', () => ({
  getSystemStats: jest.fn()
}));

import { getSystemStats } from './modules/stats';

const getStatsMock = getSystemStats as jest.MockedFunction<
  typeof getSystemStats
>;

const mockStats = {
  maxUsers: 5000,
  totalUsers: 250,
  totalReleases: 1800,
  totalContributions: 4500,
  totalArtists: 600,
  totalCommunities: 12
};

beforeEach(() => {
  resetApiTestState();
  getStatsMock.mockResolvedValue(mockStats as never);
});

describe('GET /api/stats', () => {
  it('returns site statistics', async () => {
    const res = await request(app).get('/api/stats');

    expect(res.status).toBe(200);
    expect(res.body.maxUsers).toBe(5000);
    expect(res.body.totalUsers).toBe(250);
    expect(res.body.totalReleases).toBe(1800);
  });
});

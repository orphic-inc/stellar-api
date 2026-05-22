import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState
} from './test/apiTestHarness';

jest.mock('./modules/stats', () => ({
  getSystemStats: jest.fn()
}));

jest.mock('./modules/statsHistory', () => ({
  getSiteStatHistory: jest.fn(),
  captureSiteStats: jest.fn(),
  captureUserStats: jest.fn(),
  getUserStatHistory: jest.fn()
}));

import { getSystemStats } from './modules/stats';
import * as statsHistoryModule from './modules/statsHistory';

const getStatsMock = getSystemStats as jest.MockedFunction<
  typeof getSystemStats
>;
const historyMock = statsHistoryModule as jest.Mocked<
  typeof statsHistoryModule
>;

const setAdmin = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ admin: true })
  );

const mockStats = {
  maxUsers: 5000,
  totalUsers: 250,
  totalReleases: 1800,
  totalContributions: 4500,
  totalArtists: 600,
  totalCommunities: 12
};

const mockSnapshots = [
  {
    id: 1,
    bucketAt: new Date(),
    capturedAt: new Date(),
    maxUsers: 5000,
    totalUsers: 250,
    enabledUsers: 240,
    activeToday: 10,
    activeThisWeek: 50,
    activeThisMonth: 100,
    communities: 5,
    releases: 200,
    artists: 80,
    blogPosts: 3,
    announcements: 1,
    comments: 500,
    contributedLinks: 200,
    contributedLinkDownloads: 1000
  }
];

beforeEach(() => {
  resetApiTestState();
  getStatsMock.mockResolvedValue(mockStats as never);
  historyMock.getSiteStatHistory.mockResolvedValue(mockSnapshots as never);
  historyMock.captureSiteStats.mockResolvedValue(undefined);
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

describe('GET /api/stats/history', () => {
  it('returns array of site stat snapshots', async () => {
    const res = await request(app).get('/api/stats/history');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      totalUsers: 250,
      enabledUsers: 240,
      communities: 5
    });
  });

  it('calls getSiteStatHistory', async () => {
    await request(app).get('/api/stats/history');
    expect(historyMock.getSiteStatHistory).toHaveBeenCalled();
  });
});

describe('POST /api/stats/snapshot', () => {
  it('returns 403 for non-admin user', async () => {
    const res = await request(app).post('/api/stats/snapshot');
    expect(res.status).toBe(403);
  });

  it('returns 204 for admin user', async () => {
    setAdmin();
    const res = await request(app).post('/api/stats/snapshot');
    expect(res.status).toBe(204);
    expect(historyMock.captureSiteStats).toHaveBeenCalled();
  });
});

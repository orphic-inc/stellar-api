import {
  request,
  app,
  prismaMock,
  makeUserRank,
  resetApiTestState
} from './test/apiTestHarness';
import { AppError } from './lib/errors';

jest.mock('./modules/statsHistory', () => ({
  getSiteStatHistory: jest.fn(),
  captureSiteStats: jest.fn(),
  captureUserStats: jest.fn(),
  getUserStatHistory: jest.fn()
}));

import * as statsHistoryModule from './modules/statsHistory';

const historyMock = statsHistoryModule as jest.Mocked<
  typeof statsHistoryModule
>;

const setStaff = () =>
  prismaMock.userRank.findUnique.mockResolvedValue(
    makeUserRank({ staff: true })
  );

const mockHistory = [
  {
    id: 1,
    userId: 7,
    period: 'Daily',
    capturedAt: new Date().toISOString(),
    contributed: '1073741824',
    consumed: '536870912',
    contributionCount: 5
  }
];

const mockUserWithSettings = {
  id: 7,
  userSettings: { showContributedStats: true, showConsumedStats: true }
};

beforeEach(() => {
  resetApiTestState();
  historyMock.getUserStatHistory.mockResolvedValue(mockHistory as never);
});

describe('GET /api/users/:id/stats/history', () => {
  it('returns 400 when period is missing', async () => {
    const res = await request(app).get('/api/users/7/stats/history');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ msg: 'Validation failed' });
  });

  it('returns 400 when period is invalid', async () => {
    const res = await request(app).get(
      '/api/users/7/stats/history?period=Hourly'
    );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ msg: 'Validation failed' });
  });

  it('returns 404 when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get(
      '/api/users/999/stats/history?period=Daily'
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ msg: 'User not found' });
  });

  it('returns 200 with history for own user (id=7 matches harness user)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(mockUserWithSettings as never);
    const res = await request(app).get(
      '/api/users/7/stats/history?period=Daily'
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(historyMock.getUserStatHistory).toHaveBeenCalledWith(
      7,
      'Daily',
      7,
      false,
      mockUserWithSettings
    );
  });

  it('returns 200 for staff viewing another user', async () => {
    setStaff();
    prismaMock.user.findUnique.mockResolvedValue({
      id: 99,
      userSettings: { showContributedStats: false, showConsumedStats: false }
    } as never);
    const res = await request(app).get(
      '/api/users/99/stats/history?period=Monthly'
    );
    expect(res.status).toBe(200);
    expect(historyMock.getUserStatHistory).toHaveBeenCalledWith(
      99,
      'Monthly',
      7,
      true,
      expect.objectContaining({ id: 99 })
    );
  });

  it('returns 403 when getUserStatHistory throws AppError 403', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 99,
      userSettings: { showContributedStats: false, showConsumedStats: false }
    } as never);
    historyMock.getUserStatHistory.mockRejectedValue(
      new AppError(403, 'Stats are private')
    );
    const res = await request(app).get(
      '/api/users/99/stats/history?period=Daily'
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ msg: 'Stats are private' });
  });
});

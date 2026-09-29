/**
 * The stats job's failure policy (#596, ADR-0048): set-based writes. Each
 * cascade starts its captures together, so one failing must not stop the
 * others writing. The CRS capture's per-user containment is pinned in
 * crsHistoryModule.spec.ts.
 */
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('./logging', () => ({ getLogger: () => mockLog }));

const mockCaptureUserStats = jest.fn();
const mockCaptureSiteStats = jest.fn();
const mockCaptureCommunityHealth = jest.fn();
const mockCaptureCrsSnapshots = jest.fn();
jest.mock('./statsHistory', () => ({
  captureUserStats: (p: string) => mockCaptureUserStats(p),
  captureSiteStats: () => mockCaptureSiteStats()
}));
jest.mock('./communityHealthHistory', () => ({
  captureCommunityHealth: (p: string) => mockCaptureCommunityHealth(p)
}));
jest.mock('./crsHistory', () => ({
  captureCrsSnapshots: (p: string) => mockCaptureCrsSnapshots(p)
}));

import { startStatsJob } from './statsJob';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('startStatsJob — a failing capture', () => {
  it('still runs the other hourly captures when one throws', async () => {
    mockCaptureSiteStats.mockRejectedValue(new Error('connection lost'));
    mockCaptureUserStats.mockResolvedValue(undefined);
    mockCaptureCommunityHealth.mockResolvedValue(undefined);

    startStatsJob();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(mockCaptureUserStats).toHaveBeenCalledWith('Daily');
    expect(mockCaptureCommunityHealth).toHaveBeenCalledWith('Daily');
    expect(mockLog.error).toHaveBeenCalledWith(
      'Hourly stats capture failed',
      expect.anything()
    );
  });
});

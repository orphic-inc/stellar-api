/**
 * Unit tests for statsHistory module — verifies DB call shapes using mocked Prisma.
 */

import { prismaMock, resetApiTestState } from './test/apiTestHarness';
import { AppError } from './lib/errors';

jest.mock('./modules/stats', () => ({
  getSystemStats: jest.fn()
}));

import type * as StatsHistoryModule from './modules/statsHistory';
const {
  captureUserStats,
  captureSiteStats,
  getUserStatHistory,
  getSiteStatHistory
} = jest.requireActual<typeof StatsHistoryModule>('./modules/statsHistory');

import { getSystemStats } from './modules/stats';
const getSystemStatsMock = getSystemStats as jest.MockedFunction<
  typeof getSystemStats
>;

beforeEach(() => resetApiTestState());

// ─── captureUserStats ─────────────────────────────────────────────────────────

describe('captureUserStats', () => {
  it('calls createMany with skipDuplicates and prunes old records', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: 1,
        contributed: BigInt(1000),
        consumed: BigInt(500),
        contributionCount: 3
      }
    ]);
    prismaMock.userStatSnapshot.createMany.mockResolvedValue({ count: 1 });
    prismaMock.userStatSnapshot.deleteMany.mockResolvedValue({ count: 0 });

    await captureUserStats('Daily');

    expect(prismaMock.userStatSnapshot.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(prismaMock.userStatSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: 'Daily' })
      })
    );
  });

  it('skips createMany when no users found', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.userStatSnapshot.deleteMany.mockResolvedValue({ count: 0 });

    await captureUserStats('Monthly');

    expect(prismaMock.userStatSnapshot.createMany).not.toHaveBeenCalled();
  });
});

// ─── captureSiteStats ─────────────────────────────────────────────────────────

describe('captureSiteStats', () => {
  const mockStats = {
    maxUsers: 5000,
    totalUsers: 100,
    enabledUsers: 98,
    activeToday: 10,
    activeThisWeek: 30,
    activeThisMonth: 60,
    communities: 2,
    releases: 50,
    artists: 20,
    blogPosts: 1,
    announcements: 0,
    comments: 200,
    contributedLinks: 50,
    contributedLinkDownloads: 300
  };

  it('upserts a site snapshot using hourBucket', async () => {
    getSystemStatsMock.mockResolvedValue(mockStats as never);
    prismaMock.siteStatSnapshot.upsert.mockResolvedValue({} as never);

    await captureSiteStats();

    expect(prismaMock.siteStatSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: expect.objectContaining({ totalUsers: 100 })
      })
    );
  });

  it('is idempotent — upsert update is a no-op', async () => {
    getSystemStatsMock.mockResolvedValue(mockStats as never);
    prismaMock.siteStatSnapshot.upsert.mockResolvedValue({} as never);

    await captureSiteStats();
    await captureSiteStats();

    expect(prismaMock.siteStatSnapshot.upsert).toHaveBeenCalledTimes(2);
    const calls = prismaMock.siteStatSnapshot.upsert.mock.calls;
    expect(calls[0][0].update).toEqual({});
    expect(calls[1][0].update).toEqual({});
  });
});

// ─── getUserStatHistory ───────────────────────────────────────────────────────

describe('getUserStatHistory', () => {
  const privateSettings = {
    showContributedStats: false,
    showConsumedStats: false
  };
  const publicSettings = {
    showContributedStats: true,
    showConsumedStats: true
  };
  const halfSettings = { showContributedStats: true, showConsumedStats: false };

  const mockRows = [
    {
      id: 1,
      userId: 5,
      period: 'Daily',
      bucketAt: new Date(),
      capturedAt: new Date(),
      contributed: BigInt(1_000_000),
      consumed: BigInt(500_000),
      contributionCount: 3
    }
  ];

  beforeEach(() => {
    prismaMock.userStatSnapshot.findMany.mockResolvedValue(mockRows as never);
  });

  it('throws 403 when non-owner, non-staff, all stats private', async () => {
    await expect(
      getUserStatHistory(5, 'Daily', 7, false, {
        id: 5,
        userSettings: privateSettings as never
      })
    ).rejects.toThrow(AppError);

    await expect(
      getUserStatHistory(5, 'Daily', 7, false, {
        id: 5,
        userSettings: privateSettings as never
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns full data for owner', async () => {
    const result = await getUserStatHistory(5, 'Daily', 5, false, {
      id: 5,
      userSettings: publicSettings as never
    });
    expect(result[0].contributed).toBe('1000000');
    expect(result[0].consumed).toBe('500000');
  });

  it('nulls out consumed when showConsumedStats is false for non-owner', async () => {
    const result = await getUserStatHistory(5, 'Daily', 7, false, {
      id: 5,
      userSettings: halfSettings as never
    });
    expect(result[0].contributed).toBe('1000000');
    expect(result[0].consumed).toBeNull();
  });

  it('staff bypasses all privacy settings', async () => {
    const result = await getUserStatHistory(5, 'Daily', 7, true, {
      id: 5,
      userSettings: privateSettings as never
    });
    expect(result[0].contributed).toBe('1000000');
    expect(result[0].consumed).toBe('500000');
  });
});

// ─── getSiteStatHistory ───────────────────────────────────────────────────────

describe('getSiteStatHistory', () => {
  it('returns results in ascending capturedAt order (fetches desc, reverses)', async () => {
    const older = { id: 1, capturedAt: new Date('2024-01-01') };
    const newer = { id: 2, capturedAt: new Date('2024-01-02') };
    prismaMock.siteStatSnapshot.findMany.mockResolvedValue([
      newer,
      older
    ] as never);

    const result = await getSiteStatHistory();

    expect(result[0].capturedAt).toEqual(older.capturedAt);
    expect(result[1].capturedAt).toEqual(newer.capturedAt);
  });

  it('passes take limit to findMany', async () => {
    prismaMock.siteStatSnapshot.findMany.mockResolvedValue([]);
    await getSiteStatHistory(50);
    expect(prismaMock.siteStatSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });
});

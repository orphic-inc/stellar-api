/**
 * Unit tests for the community-health snapshot module (#75) — verifies the
 * capture folds raw per-(community, status) counts into a banded pulse via the
 * real `computePulse`, writes idempotently, and prunes by retention; and that
 * the history query reads oldest-first. Prisma is mocked; `computePulse`,
 * `getBucket`, and `getRetentionCutoff` run for real.
 */

import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
jest.mock('./lib/prisma', () => ({ prisma: prismaMock }));

jest.mock('./modules/logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

import {
  captureCommunityHealth,
  getCommunityHealthHistory
} from './modules/communityHealthHistory';

beforeEach(() => mockReset(prismaMock));

// ─── captureCommunityHealth ───────────────────────────────────────────────────

describe('captureCommunityHealth', () => {
  it('folds counts into a banded pulse, writes with skipDuplicates, prunes by period', async () => {
    // Community 1: 9 PASS / 1 FAIL → Healthy. Community 2: 1 PASS / 9 UNKNOWN →
    // pulse 1.0 but coverage 0.1 < floor → Unknown.
    prismaMock.$queryRaw.mockResolvedValue([
      { communityId: 1, linkStatus: 'PASS', count: 9 },
      { communityId: 1, linkStatus: 'FAIL', count: 1 },
      { communityId: 2, linkStatus: 'PASS', count: 1 },
      { communityId: 2, linkStatus: 'UNKNOWN', count: 9 }
    ] as never);
    prismaMock.communityHealthSnapshot.createMany.mockResolvedValue({
      count: 2
    });
    prismaMock.communityHealthSnapshot.deleteMany.mockResolvedValue({
      count: 0
    });

    await captureCommunityHealth('Daily');

    const createArg = prismaMock.communityHealthSnapshot.createMany.mock
      .calls[0][0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    expect(createArg.skipDuplicates).toBe(true);
    expect(createArg.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          communityId: 1,
          period: 'Daily',
          checked: 10,
          total: 10,
          coverage: 1,
          pulse: 0.9,
          status: 'Healthy'
        }),
        expect.objectContaining({
          communityId: 2,
          checked: 1,
          total: 10,
          status: 'Unknown'
        })
      ])
    );

    expect(prismaMock.communityHealthSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: 'Daily' })
      })
    );
  });

  it('skips createMany when no communities have contributions, still prunes', async () => {
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.communityHealthSnapshot.deleteMany.mockResolvedValue({
      count: 0
    });

    await captureCommunityHealth('Monthly');

    expect(
      prismaMock.communityHealthSnapshot.createMany
    ).not.toHaveBeenCalled();
    expect(prismaMock.communityHealthSnapshot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: 'Monthly' })
      })
    );
  });
});

// ─── getCommunityHealthHistory ────────────────────────────────────────────────

describe('getCommunityHealthHistory', () => {
  it('queries the community + period, oldest-first', async () => {
    prismaMock.communityHealthSnapshot.findMany.mockResolvedValue([] as never);

    await getCommunityHealthHistory(7, 'Yearly');

    expect(prismaMock.communityHealthSnapshot.findMany).toHaveBeenCalledWith({
      where: { communityId: 7, period: 'Yearly' },
      orderBy: { capturedAt: 'asc' }
    });
  });
});

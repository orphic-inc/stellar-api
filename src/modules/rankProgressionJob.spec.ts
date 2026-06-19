/**
 * Unit tests for the rank-progression sweep wiring. The decision logic is the
 * pure evaluator's job (rankProgression.spec.ts) and the real end-to-end DB path
 * is covered by rankProgressionJob.integration.ts; here we pin the DB-bound shell:
 * ladder mapping, the system-actor gate, and — most importantly — that an auto
 * change is a primary-rank-only update that never touches secondary ranks.
 */
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';

jest.mock('./ratio', () => ({
  getEligibleContributionBytes: jest.fn()
}));
import { getEligibleContributionBytes } from './ratio';
import {
  loadLadder,
  resolveSystemActorId,
  runRankProgressionSweep
} from './rankProgressionJob';

const GiB = BigInt(1024 ** 3);
const mockedEligibleBytes = getEligibleContributionBytes as jest.Mock;

beforeEach(() => {
  resetApiTestState();
  mockedEligibleBytes.mockReset();
});

// A four-rung ladder: User(1)→Member(2), plus assigned Staff(8)/SysOp(9).
const ladderRanks = [
  { id: 1, level: 100, name: 'User' },
  { id: 2, level: 150, name: 'Member' },
  { id: 8, level: 500, name: 'Staff' },
  { id: 9, level: 1000, name: 'SysOp' }
];
const userToMemberRule = {
  id: 1,
  fromRankId: 1,
  toRankId: 2,
  minContributed: 10n * GiB,
  minRatio: 0.7,
  minContributions: 0,
  minAccountAgeDays: 7,
  extra: null,
  enabled: true
};

const mockLadder = () => {
  prismaMock.userRank.findMany.mockResolvedValue(ladderRanks as never);
  prismaMock.rankPromotionRule.findMany.mockResolvedValue([
    userToMemberRule
  ] as never);
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('loadLadder', () => {
  it('marks ranks below Staff (500) as auto-managed and the rest assigned', async () => {
    mockLadder();
    const { ranks } = await loadLadder();
    const autoByName = Object.fromEntries(
      ranks.map((r) => [r.name, r.autoManaged])
    );
    expect(autoByName).toEqual({
      User: true,
      Member: true,
      Staff: false,
      SysOp: false
    });
  });
});

describe('resolveSystemActorId', () => {
  it('returns the lowest-id SysOp-level user', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 3 } as never);
    expect(await resolveSystemActorId()).toBe(3);
  });

  it('returns null when no SysOp user exists', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await resolveSystemActorId()).toBeNull();
  });
});

describe('runRankProgressionSweep', () => {
  const mockSweepFor = (
    user: {
      id: number;
      userRankId: number;
      consumed: bigint;
      dateRegistered: Date;
      rankLocked: boolean;
    },
    stats: {
      eligibleBytes: bigint;
      contributionCount: number;
      qualityCount: number;
      distinctReleases: number;
      activeWarnings: number;
    }
  ) => {
    mockLadder();
    prismaMock.user.findFirst.mockResolvedValue({ id: 9 } as never); // system actor
    prismaMock.user.findMany.mockResolvedValueOnce([user] as never);
    mockedEligibleBytes.mockResolvedValue(stats.eligibleBytes);
    // buildProgressionInput issues contribution.count twice (accounted, then
    // quality) in array order under Promise.all.
    prismaMock.contribution.count
      .mockResolvedValueOnce(stats.contributionCount as never)
      .mockResolvedValueOnce(stats.qualityCount as never);
    prismaMock.contribution.findMany.mockResolvedValue(
      Array.from({ length: stats.distinctReleases }, (_, i) => ({
        releaseId: i + 1
      })) as never
    );
    prismaMock.userWarning.count.mockResolvedValue(
      stats.activeWarnings as never
    );
  };

  const promotingUser = {
    id: 5,
    userRankId: 1,
    consumed: 0n,
    dateRegistered: daysAgo(30),
    rankLocked: false
  };

  it('promotes an eligible user with a primary-only update — never touching secondary ranks', async () => {
    mockSweepFor(promotingUser, {
      eligibleBytes: 20n * GiB,
      contributionCount: 0,
      qualityCount: 0,
      distinctReleases: 0,
      activeWarnings: 0
    });

    const result = await runRankProgressionSweep();

    expect(result).toEqual({ scanned: 1, promoted: 1, demoted: 0 });
    // Primary rank moved to Member (id 2)…
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { userRankId: 2 }
    });
    // …and the secondary-rank set was left untouched (the setUserRank trap).
    expect(prismaMock.userSecondaryRank.deleteMany).not.toHaveBeenCalled();
  });

  it('notifies and audits the promotion as an automated change', async () => {
    mockSweepFor(promotingUser, {
      eligibleBytes: 20n * GiB,
      contributionCount: 0,
      qualityCount: 0,
      distinctReleases: 0,
      activeWarnings: 0
    });

    await runRankProgressionSweep();

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 5,
        type: 'rank_promoted',
        actorId: 9
      })
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 9,
        action: 'user.rank_changed',
        targetType: 'User',
        targetId: 5,
        metadata: expect.objectContaining({ auto: true, direction: 'promote' })
      })
    });
  });

  it('leaves a user who meets no threshold unchanged', async () => {
    mockSweepFor(
      { ...promotingUser, dateRegistered: daysAgo(1) }, // too young (needs 7d)
      {
        eligibleBytes: 1n * GiB, // under 10 GiB
        contributionCount: 0,
        qualityCount: 0,
        distinctReleases: 0,
        activeWarnings: 0
      }
    );

    const result = await runRankProgressionSweep();

    expect(result).toEqual({ scanned: 1, promoted: 0, demoted: 0 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('freezes a rankLocked user even when fully eligible', async () => {
    mockSweepFor(
      { ...promotingUser, rankLocked: true },
      {
        eligibleBytes: 20n * GiB,
        contributionCount: 0,
        qualityCount: 0,
        distinctReleases: 0,
        activeWarnings: 0
      }
    );

    const result = await runRankProgressionSweep();

    expect(result.promoted).toBe(0);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('no-ops when there is no SysOp actor to attribute changes to', async () => {
    mockLadder();
    prismaMock.user.findFirst.mockResolvedValue(null);

    const result = await runRankProgressionSweep();

    expect(result).toEqual({ scanned: 0, promoted: 0, demoted: 0 });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});

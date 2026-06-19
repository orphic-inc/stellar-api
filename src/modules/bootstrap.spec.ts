/**
 * Unit tests for the class-ladder bootstrap (USER_CLASSES_PLAN §5). seedRanks /
 * seedForums are exercised by the install integration path; these specs pin the
 * ladder shape and the promotion-rule seeding (which projects the evaluator's
 * DEFAULT_RULES onto real DB rank ids by level).
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_RANKS, seedRankPromotionRules } from './bootstrap';
import { DEFAULT_RULES } from './rankProgression';

const GiB = BigInt(1024 ** 3);

describe('DEFAULT_RANKS ladder', () => {
  it('covers the full primary class ladder at the confirmed levels', () => {
    expect(DEFAULT_RANKS.map((r) => r.level)).toEqual([
      100, 150, 200, 300, 350, 400, 450, 500, 1000
    ]);
  });

  it('uses the §11-confirmed prestige-tier names', () => {
    const nameByLevel = new Map(DEFAULT_RANKS.map((r) => [r.level, r.name]));
    expect(nameByLevel.get(150)).toBe('Member');
    expect(nameByLevel.get(300)).toBe('Elite');
    expect(nameByLevel.get(350)).toBe('Stellarific');
    expect(nameByLevel.get(400)).toBe('Stellartastic');
    expect(nameByLevel.get(450)).toBe('Stellarige');
  });

  it('keeps personal-collage headroom monotonic up the ladder', () => {
    const limits = DEFAULT_RANKS.filter((r) => r.level <= 450).map(
      (r) => r.personalCollageLimit
    );
    const sorted = [...limits].sort((a, b) => a - b);
    expect(limits).toEqual(sorted);
  });
});

describe('seedRankPromotionRules', () => {
  // Real DB ids deliberately differ from the evaluator's fixture ids (1–9) to
  // prove the seeder resolves rungs by level, not by hard-coded id.
  const fullRanks = [
    { id: 11, level: 100 },
    { id: 12, level: 150 },
    { id: 13, level: 200 },
    { id: 14, level: 300 },
    { id: 15, level: 350 },
    { id: 16, level: 400 },
    { id: 17, level: 450 },
    { id: 18, level: 500 },
    { id: 19, level: 1000 }
  ];

  const makeClient = (ranks: { id: number; level: number }[]) => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const client = {
      userRank: { findMany: jest.fn().mockResolvedValue(ranks) },
      rankPromotionRule: { upsert }
    } as unknown as PrismaClient;
    return { client, upsert };
  };

  it('seeds one rule per DEFAULT_RULES rung, resolving from/to ids by level', async () => {
    const { client, upsert } = makeClient(fullRanks);
    await seedRankPromotionRules(client);

    expect(upsert).toHaveBeenCalledTimes(DEFAULT_RULES.length);
    const first = upsert.mock.calls[0][0];
    // User(100)→Member(150) projected onto DB ids 11→12.
    expect(first.where.fromRankId_toRankId).toEqual({
      fromRankId: 11,
      toRankId: 12
    });
    expect(first.create.minContributed).toBe(10n * GiB);
    expect(first.create.minAccountAgeDays).toBe(7);
  });

  it('is create-if-absent so runtime tuning survives a re-seed', async () => {
    const { client, upsert } = makeClient(fullRanks);
    await seedRankPromotionRules(client);
    for (const call of upsert.mock.calls) expect(call[0].update).toEqual({});
  });

  it('carries the prestige Extra predicates onto the top two rungs', async () => {
    const { client, upsert } = makeClient(fullRanks);
    await seedRankPromotionRules(client);
    expect(upsert.mock.calls.map((c) => c[0].create.extra)).toEqual([
      null,
      null,
      null,
      null,
      'DISTINCT_RELEASES_500',
      'QUALITY_CONTRIB_500'
    ]);
  });

  it('skips rungs whose ranks are not seeded yet instead of throwing', async () => {
    // Only User + Member exist — only the 100→150 rung is seedable.
    const { client, upsert } = makeClient([
      { id: 11, level: 100 },
      { id: 12, level: 150 }
    ]);
    await seedRankPromotionRules(client);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

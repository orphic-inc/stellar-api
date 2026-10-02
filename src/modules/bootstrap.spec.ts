/**
 * Unit tests for the class-ladder bootstrap (USER_CLASSES_PLAN §5). seedRanks /
 * seedForums are exercised by the install integration path; these specs pin the
 * ladder shape and the promotion-rule seeding (which projects the evaluator's
 * DEFAULT_RULES onto real DB rank ids by level).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_RANKS,
  SYSTEM_USERNAME,
  seedDefaultCommunity,
  seedRankPromotionRules,
  seedRanks,
  seedSystemUser
} from './bootstrap';
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

  // #876: an avatar can only be set by upload, so the entry rank needs a slot.
  it('lets the entry rank upload one image, and never fewer up the ladder', () => {
    const limits = DEFAULT_RANKS.filter((r) => r.level <= 450).map(
      (r) => r.assetLimit ?? Infinity
    );
    expect(limits[0]).toBe(1);
    expect(limits).toEqual([...limits].sort((a, b) => a - b));
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

  const makeClient = (
    ranks: { id: number; level: number }[],
    existingRules = 0
  ) => {
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    const client = {
      userRank: { findMany: jest.fn().mockResolvedValue(ranks) },
      rankPromotionRule: {
        count: jest.fn().mockResolvedValue(existingRules),
        createMany
      }
    } as unknown as PrismaClient;
    const rows = () =>
      createMany.mock.calls[0][0].data as {
        fromRankId: number;
        toRankId: number;
        minContributed: bigint;
        minAccountAgeDays: number;
        extra: string | null;
      }[];
    return { client, createMany, rows };
  };

  it('seeds one rule per DEFAULT_RULES rung, resolving from/to ids by level', async () => {
    const { client, rows } = makeClient(fullRanks);
    await seedRankPromotionRules(client);

    expect(rows()).toHaveLength(DEFAULT_RULES.length);
    // User(100)→Member(150) projected onto DB ids 11→12.
    expect(rows()[0]).toMatchObject({ fromRankId: 11, toRankId: 12 });
    expect(rows()[0].minContributed).toBe(10n * GiB);
    expect(rows()[0].minAccountAgeDays).toBe(7);
  });

  // #882: once any rule exists the rules are staff's, so a rule staff tuned or
  // deleted stays as they left it.
  it('writes nothing once any rule exists', async () => {
    const { client, createMany } = makeClient(fullRanks, 1);
    await seedRankPromotionRules(client);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('carries the prestige Extra predicates onto the top two rungs', async () => {
    const { client, rows } = makeClient(fullRanks);
    await seedRankPromotionRules(client);
    expect(rows().map((r) => r.extra)).toEqual([
      null,
      null,
      null,
      null,
      'DISTINCT_RELEASES_500',
      'QUALITY_CONTRIB_500'
    ]);
  });

  it('skips rungs whose ranks do not exist instead of throwing', async () => {
    // Only User + Member exist — only the 100→150 rung is seedable.
    const { client, rows } = makeClient([
      { id: 11, level: 100 },
      { id: 12, level: 150 }
    ]);
    await seedRankPromotionRules(client);
    expect(rows()).toHaveLength(1);
  });
});

describe('seedRanks (#882)', () => {
  const makeClient = (existingRanks: number) => {
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    const client = {
      userRank: {
        count: jest.fn().mockResolvedValue(existingRanks),
        createMany
      }
    } as unknown as PrismaClient;
    return { client, createMany };
  };

  it('creates the whole default ladder in one insert on a fresh install', async () => {
    const { client, createMany } = makeClient(0);
    await seedRanks(client);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(
      createMany.mock.calls[0][0].data.map((r: { level: number }) => r.level)
    ).toEqual(DEFAULT_RANKS.map((r) => r.level));
  });

  // Once any rank exists the ranks are staff's: an edited one isn't rewritten,
  // and a deleted one isn't recreated.
  it('writes nothing once any rank exists', async () => {
    const { client, createMany } = makeClient(1);
    await seedRanks(client);
    expect(createMany).not.toHaveBeenCalled();
  });
});

/**
 * Two POST /install requests on a fresh site run seedAll side by side (#596).
 * Each seeder must treat a row the other created first (P2002) as already
 * seeded, and still fail on anything else.
 */
describe('a concurrent seed that wins a unique key', () => {
  const prismaErr = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test'
    });

  it('seedRanks carries on past a ladder created concurrently', async () => {
    const createMany = jest.fn().mockRejectedValue(prismaErr('P2002'));
    const client = {
      userRank: { count: jest.fn().mockResolvedValue(0), createMany }
    } as unknown as PrismaClient;
    await expect(seedRanks(client)).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('seedRankPromotionRules carries on past rules created concurrently', async () => {
    const createMany = jest.fn().mockRejectedValue(prismaErr('P2002'));
    const client = {
      userRank: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            DEFAULT_RANKS.map((r, i) => ({ id: i + 1, level: r.level }))
          )
      },
      rankPromotionRule: { count: jest.fn().mockResolvedValue(0), createMany }
    } as unknown as PrismaClient;
    await expect(seedRankPromotionRules(client)).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('seedSystemUser returns the id of the System user created concurrently', async () => {
    const tx = {
      userSettings: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      profile: { create: jest.fn().mockResolvedValue({ id: 2 }) },
      user: { create: jest.fn().mockRejectedValue(prismaErr('P2002')) }
    };
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 42 });
    const client = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow
      },
      userRank: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)
    } as unknown as PrismaClient;
    await expect(seedSystemUser(client)).resolves.toBe(42);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { username: SYSTEM_USERNAME },
      select: { id: true }
    });
  });

  it('seedDefaultCommunity carries on past the community created concurrently', async () => {
    const client = {
      community: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(prismaErr('P2002'))
      }
    } as unknown as PrismaClient;
    await expect(seedDefaultCommunity(client, 7)).resolves.toBeUndefined();
  });

  // Only P2002 means "already seeded"; any other failure still stops the seed.
  it('rethrows any other error', async () => {
    const other = prismaErr('P2003');
    const client = {
      community: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(other)
      }
    } as unknown as PrismaClient;
    await expect(seedDefaultCommunity(client, 7)).rejects.toBe(other);
  });
});

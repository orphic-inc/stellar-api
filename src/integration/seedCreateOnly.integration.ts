import { readFileSync } from 'fs';
import { join } from 'path';
import { truncateAll, testPrisma } from '../test/dbHelpers';
import {
  DEFAULT_RANKS,
  seedRanks,
  seedRankPromotionRules
} from '../modules/bootstrap';
import { DEFAULT_RULES } from '../modules/rankProgression';

/**
 * The boot seed is create-only (#882). Every container start runs it, and it
 * used to rewrite each seeded rank whose name still matched and recreate any
 * seeded rank or default rule staff had deleted. After the first seed the
 * ranks and rules are staff's.
 */
beforeEach(truncateAll);

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

const seed = async () => {
  await seedRanks(testPrisma);
  await seedRankPromotionRules(testPrisma);
};

const rankAt = (level: number) =>
  testPrisma.userRank.findUniqueOrThrow({ where: { level } });

describe('the boot seed (#882)', () => {
  it('creates the full ladder and the default rules on an empty database', async () => {
    await seed();
    expect(await testPrisma.userRank.count()).toBe(DEFAULT_RANKS.length);
    expect(await testPrisma.rankPromotionRule.count()).toBe(
      DEFAULT_RULES.length
    );
  });

  it('leaves a staff-edited seeded rank and rule as staff left them', async () => {
    await seed();
    const user = await rankAt(100);
    await testPrisma.userRank.update({
      where: { id: user.id },
      data: {
        color: '#123456',
        assetLimit: 4,
        permissions: { wiki_edit: true }
      }
    });
    const rule = await testPrisma.rankPromotionRule.findFirstOrThrow({
      where: { fromRankId: user.id }
    });
    await testPrisma.rankPromotionRule.update({
      where: { id: rule.id },
      data: { minAccountAgeDays: 99 }
    });

    await seed();

    expect(await rankAt(100)).toMatchObject({
      color: '#123456',
      assetLimit: 4,
      permissions: { wiki_edit: true }
    });
    expect(
      (
        await testPrisma.rankPromotionRule.findUniqueOrThrow({
          where: { id: rule.id }
        })
      ).minAccountAgeDays
    ).toBe(99);
  });

  it('does not recreate a seeded rank or rule staff deleted', async () => {
    await seed();
    const top = await rankAt(450);
    await testPrisma.rankPromotionRule.deleteMany({
      where: { OR: [{ fromRankId: top.id }, { toRankId: top.id }] }
    });
    await testPrisma.userRank.delete({ where: { id: top.id } });

    await seed();

    expect(
      await testPrisma.userRank.findUnique({ where: { level: 450 } })
    ).toBeNull();
    expect(await testPrisma.userRank.count()).toBe(DEFAULT_RANKS.length - 1);
    expect(await testPrisma.rankPromotionRule.count()).toBe(
      DEFAULT_RULES.length - 1
    );
  });

  // Two POST /install requests on a fresh site run the seed side by side. The
  // loser's emptiness check is replayed as a stale read: the winner's ladder is
  // already written, and the loser's single insert meets the unique keys.
  it('leaves exactly one ladder and one rule set when a concurrent seed wins', async () => {
    await seed();
    jest
      .spyOn(testPrisma.userRank, 'count')
      .mockImplementationOnce((() => Promise.resolve(0)) as never);
    jest
      .spyOn(testPrisma.rankPromotionRule, 'count')
      .mockImplementationOnce((() => Promise.resolve(0)) as never);

    await expect(seed()).resolves.toBeUndefined();
    expect(await testPrisma.userRank.count()).toBe(DEFAULT_RANKS.length);
    expect(await testPrisma.rankPromotionRule.count()).toBe(
      DEFAULT_RULES.length
    );
  });
});

/**
 * The migration that carries #876 to existing installs, which the seed no
 * longer reaches. The test database is already migrated, so this replays its
 * statement over rows written as they were before it.
 */
describe('the entry-rank assetLimit migration (#882)', () => {
  const MIGRATION = join(
    __dirname,
    '../../prisma/migrations/20261002180000_entry_rank_asset_limit/migration.sql'
  );
  const statement = () =>
    readFileSync(MIGRATION, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();

  const rank = (level: number, assetLimit: number | null) =>
    testPrisma.userRank.create({
      data: { level, name: `Rank ${level}`, permissions: {}, assetLimit }
    });

  it('raises only the entry rank, and only from the old seeded 0', async () => {
    await rank(100, 0);
    await rank(150, 0);

    await testPrisma.$executeRawUnsafe(statement());

    expect((await rankAt(100)).assetLimit).toBe(1);
    expect((await rankAt(150)).assetLimit).toBe(0);
  });

  it('leaves an entry rank staff set to another value', async () => {
    await rank(100, 3);
    await testPrisma.$executeRawUnsafe(statement());
    expect((await rankAt(100)).assetLimit).toBe(3);
  });
});

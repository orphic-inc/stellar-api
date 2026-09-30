/**
 * Integration coverage for the boot seeders' lost inserts (#596 group 6).
 *
 * Two `POST /install` requests on a fresh site run `seedAll` side by side, so
 * each seeder's "already seeded?" read can miss rows the other request is
 * creating. Each test replays the loser deterministically: the winner's rows
 * are already written, and a spy makes the loser's read miss them.
 *
 * `goldenRules.ts` (#835) and `wikiFixtures.ts` (#836): the loser's insert
 * meets the unique key, which means "already seeded", never an error.
 */
import { Prisma } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  GOLDEN_RULES,
  GOLDEN_RULE_CODE_PREFIX,
  seedGoldenRules
} from '../modules/goldenRules';
import {
  BUILTIN_WIKI_FIXTURES,
  seedWikiFixtures
} from '../modules/wikiFixtures';
import { seedSystemUser } from '../modules/bootstrap';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

const goldenCodes = async () =>
  (
    await testPrisma.rule.findMany({
      where: { code: { startsWith: GOLDEN_RULE_CODE_PREFIX } },
      select: { code: true, _count: { select: { subRules: true } } },
      orderBy: { code: 'asc' }
    })
  ).map((r) => [r.code, r._count.subRules]);

const expectedGolden = () =>
  GOLDEN_RULES.map((r) => [r.code, r.subRules.length]).sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]))
  );

describe('seedGoldenRules — a concurrent seed', () => {
  it('treats rules the other seed created as already seeded', async () => {
    await seedGoldenRules(testPrisma);
    jest
      .spyOn(testPrisma.rule, 'count')
      .mockImplementationOnce((() => Promise.resolve(0)) as never);

    await expect(seedGoldenRules(testPrisma)).resolves.toBeUndefined();
    expect(await goldenCodes()).toEqual(expectedGolden());
  });

  it('still creates the rules the other seed had not reached', async () => {
    await seedGoldenRules(testPrisma);
    // The winner is partway through: only the first two rules have landed.
    await testPrisma.rule.deleteMany({
      where: {
        code: { in: GOLDEN_RULES.slice(2).map((r) => r.code) }
      }
    });
    jest
      .spyOn(testPrisma.rule, 'count')
      .mockImplementationOnce((() => Promise.resolve(0)) as never);

    await seedGoldenRules(testPrisma);
    expect(await goldenCodes()).toEqual(expectedGolden());
  });
});

describe('seedWikiFixtures — a concurrent seed', () => {
  it('treats pages the other seed created as already seeded', async () => {
    const systemUserId = await seedSystemUser(testPrisma);
    await seedWikiFixtures(testPrisma, systemUserId);
    jest
      .spyOn(testPrisma.wikiPage, 'findUnique')
      .mockImplementationOnce((() => Promise.resolve(null)) as never);

    await expect(
      seedWikiFixtures(testPrisma, systemUserId)
    ).resolves.toBeUndefined();
    expect(await testPrisma.wikiPage.count()).toBe(
      BUILTIN_WIKI_FIXTURES.length
    );
  });

  it('still fails loudly when another page holds a fixture id', async () => {
    const systemUserId = await seedSystemUser(testPrisma);
    const [first] = BUILTIN_WIKI_FIXTURES;
    await testPrisma.wikiPage.create({
      data: {
        id: first.id,
        slug: 'not-a-fixture',
        title: 'Squatter',
        body: '',
        authorId: systemUserId
      }
    });

    await expect(
      seedWikiFixtures(testPrisma, systemUserId)
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { truncateAll, testPrisma } from '../test/dbHelpers';

/**
 * #881's migration, re-run against rows written in the old reading. Each value
 * the old reading treated as unlimited (`0`, a stray negative) must come out
 * `null`, and a real cap must survive, so no rank changes behaviour. The test
 * database is already migrated, so this replays the migration's data step:
 * the column change itself is what lets `null` be written here at all.
 */
const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261002120000_rank_quota_null_unlimited/migration.sql'
);

const dataStatements = (): string[] =>
  readFileSync(MIGRATION, 'utf8')
    .split(';')
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((statement) => statement.startsWith('UPDATE'));

beforeEach(truncateAll);

afterAll(async () => {
  await testPrisma.$disconnect();
});

it('turns every old "unlimited" into null and keeps every cap (#881)', async () => {
  const rank = (level: number, limit: number) =>
    testPrisma.userRank.create({
      data: {
        level,
        name: `Rank ${level}`,
        permissions: {},
        personalCollageLimit: limit,
        authorStylesheetLimit: limit
      }
    });
  const zero = await rank(100, 0);
  const negative = await rank(200, -1);
  const capped = await rank(300, 3);

  const statements = dataStatements();
  expect(statements).toHaveLength(2);
  for (const statement of statements) {
    await testPrisma.$executeRawUnsafe(statement);
  }

  const limitsOf = (id: number) =>
    testPrisma.userRank.findUniqueOrThrow({
      where: { id },
      select: { personalCollageLimit: true, authorStylesheetLimit: true }
    });
  expect(await limitsOf(zero.id)).toEqual({
    personalCollageLimit: null,
    authorStylesheetLimit: null
  });
  expect(await limitsOf(negative.id)).toEqual({
    personalCollageLimit: null,
    authorStylesheetLimit: null
  });
  expect(await limitsOf(capped.id)).toEqual({
    personalCollageLimit: 3,
    authorStylesheetLimit: 3
  });
});

it('defaults a new rank to 0, none, for both limits (#881)', async () => {
  const rank = await testPrisma.userRank.create({
    data: { level: 100, name: 'New', permissions: {} }
  });
  expect(rank.personalCollageLimit).toBe(0);
  expect(rank.authorStylesheetLimit).toBe(0);
});

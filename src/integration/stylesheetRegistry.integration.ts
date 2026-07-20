/**
 * Registry ↔ /css delivery consistency (#286). Proves a site-registry row can
 * never ship pointing at a `/css` delivery target that doesn't resolve — the dead
 * theme-picker entry the issue is about. Seeds the System user + built-in fixtures
 * on the test DB (the harness truncates registry rows in `beforeEach`, so the test
 * seeds them itself) and asserts every `/css`-backed row maps to a real, non-empty
 * `AuthorStylesheet`. Also pins the seeders' idempotency and the System account's
 * non-interactive shape.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { seedSystemUser, SYSTEM_USERNAME } from '../modules/bootstrap';
import {
  seedStylesheetFixtures,
  readFixtureCss,
  BUILTIN_STYLESHEET_FIXTURES
} from '../modules/stylesheetFixtures';

const fixtureFileByName = new Map<string, string>(
  BUILTIN_STYLESHEET_FIXTURES.map((f) => [f.name, f.file])
);

// `seedDefaults()` creates the level-100 User rank that `seedSystemUser` takes.
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const CSS_ROUTE = /^\/api\/stylesheet\/author-stylesheet\/(\d+)\/css$/;

const cssBackedRows = async () => {
  const rows = await testPrisma.stylesheet.findMany();
  return rows.filter((r) => CSS_ROUTE.test(r.cssUrl));
};

const assertAllResolve = async () => {
  const rows = await cssBackedRows();
  expect(rows.length).toBe(BUILTIN_STYLESHEET_FIXTURES.length);
  for (const row of rows) {
    const id = Number(CSS_ROUTE.exec(row.cssUrl)![1]);
    const fixture = await testPrisma.authorStylesheet.findUnique({
      where: { id },
      select: { name: true, source: true }
    });
    expect(fixture).not.toBeNull();
    // Fidelity: what /css serves is byte-for-byte the authored file. Under
    // ADR-0031 §5 the boundary validates and never rewrites, so the disk file is
    // the expectation directly rather than the disk file put through a pass.
    const file = fixtureFileByName.get(row.name);
    expect(file).toBeDefined();
    expect(fixture!.source).toBe(readFixtureCss(file!));
  }
};

describe('stylesheet registry ↔ /css delivery consistency (#286)', () => {
  it('every /css-backed registry row resolves to a real, non-empty AuthorStylesheet', async () => {
    const systemUserId = await seedSystemUser(testPrisma);
    await seedStylesheetFixtures(testPrisma, systemUserId);
    await assertAllResolve();
  });

  it('re-seeding is idempotent — no duplicate fixtures, registry still resolves', async () => {
    const systemUserId = await seedSystemUser(testPrisma);
    await seedStylesheetFixtures(testPrisma, systemUserId);

    const again = await seedSystemUser(testPrisma);
    expect(again).toBe(systemUserId);
    await seedStylesheetFixtures(testPrisma, systemUserId);

    const fixtureCount = await testPrisma.authorStylesheet.count({
      where: { authorId: systemUserId }
    });
    expect(fixtureCount).toBe(BUILTIN_STYLESHEET_FIXTURES.length);
    await assertAllResolve();
  });

  it('seeds the reserved System user as non-interactive', async () => {
    const id = await seedSystemUser(testPrisma);
    const user = await testPrisma.user.findUniqueOrThrow({
      where: { id },
      select: { username: true, disabled: true, rankLocked: true }
    });
    expect(user.username).toBe(SYSTEM_USERNAME);
    expect(user.disabled).toBe(true);
    expect(user.rankLocked).toBe(true);
  });
});

/**
 * Registry ↔ /css delivery consistency (#286, extended by #371). Proves a
 * site-registry row can never ship pointing at a `/css` delivery target that
 * doesn't resolve — the dead theme-picker entry the issue is about. Seeds the
 * System user + built-in fixtures on the test DB (the harness truncates registry
 * rows in `beforeEach`, so the test seeds them itself) and asserts every
 * `/css`-backed row maps to a real, non-empty `AuthorStylesheet`.
 *
 * #371 adds the other direction: the delivery arms are now a TOTAL partition
 * (`/css`-backed XOR null `cssUrl`), so a row pointing outside the api fails here
 * instead of being invisible. Also pins the seeders' idempotency and the System
 * account's non-interactive shape.
 *
 * Scope limit worth knowing before trusting this file: `beforeEach` truncates,
 * so the partition is asserted over rows these tests SEED, never over the
 * registry a real `prisma migrate deploy` produces. A SQL data migration adding
 * a `/stylesheets/…` row still passes CI — `postmod` is exactly that today
 * (ADR-0024: "Live; gated on #343"). See modules/stylesheetRegistry.ts.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { seedSystemUser, SYSTEM_USERNAME } from '../modules/bootstrap';
import {
  seedStylesheetFixtures,
  readFixtureCss,
  BUILTIN_STYLESHEET_FIXTURES
} from '../modules/stylesheetFixtures';
import {
  seedAssetFixtures,
  BUILTIN_ASSET_FIXTURES
} from '../modules/assetFixtures';
import { getAssetByHash, hashAsset } from '../modules/assetStore';
import {
  authorStylesheetIdFromCssUrl,
  rowsOutsideDeliveryPartition
} from '../modules/stylesheetRegistry';

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

const cssBackedRows = async () => {
  const rows = await testPrisma.stylesheet.findMany();
  return rows.filter((r) => authorStylesheetIdFromCssUrl(r.cssUrl) !== null);
};

const assertAllResolve = async () => {
  const rows = await cssBackedRows();
  expect(rows.length).toBe(BUILTIN_STYLESHEET_FIXTURES.length);
  for (const row of rows) {
    const id = authorStylesheetIdFromCssUrl(row.cssUrl)!;
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

  /*
   * The partition is TOTAL (#371): every row is /css-backed or has a null
   * cssUrl. The old guard only asserted the forward direction — that /css-backed
   * rows resolve — so a row pointing outside the api was invisible to it. That
   * is precisely how `anorex`/`kuro`/`layer-cake` moved to api delivery while
   * their stellar-ui static files kept shipping to every user, referenced by
   * nothing.
   */
  describe('total delivery partition', () => {
    it('every seeded registry row is /css-backed or null — nothing else', async () => {
      const systemUserId = await seedSystemUser(testPrisma);
      await seedStylesheetFixtures(testPrisma, systemUserId);

      const rows = await testPrisma.stylesheet.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rowsOutsideDeliveryPartition(rows)).toEqual([]);
    });

    it('a null-cssUrl row is legal — Sublime is in the picker and renders nothing', async () => {
      // truncateAll() drops the row the 2026-05-24 data migration plants, so the
      // post-migration shape is reconstructed here rather than assumed.
      const systemUserId = await seedSystemUser(testPrisma);
      await seedStylesheetFixtures(testPrisma, systemUserId);
      await testPrisma.stylesheet.create({
        data: { name: 'sublime', description: 'Default', cssUrl: null }
      });

      const rows = await testPrisma.stylesheet.findMany();
      expect(rows.find((r) => r.name === 'sublime')!.cssUrl).toBeNull();
      expect(rowsOutsideDeliveryPartition(rows)).toEqual([]);
    });

    it('FAILS on a row pointing at the retired ui static tree', async () => {
      // The negative control. A guard never observed failing is not a guard —
      // and this is the exact shape that shipped undetected before #371.
      const systemUserId = await seedSystemUser(testPrisma);
      await seedStylesheetFixtures(testPrisma, systemUserId);
      await testPrisma.stylesheet.create({
        data: {
          name: 'foo',
          description: '',
          cssUrl: '/stylesheets/foo/style.css'
        }
      });

      const offenders = rowsOutsideDeliveryPartition(
        await testPrisma.stylesheet.findMany()
      );
      expect(offenders.map((r) => r.name)).toEqual(['foo']);
    });
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

  it('an asset-bearing fixture has every /api/asset target stored (#341)', async () => {
    // The end-to-end the drift guard cannot reach: the guard proves the CSS and
    // the shipped files agree on disk, this proves the seed actually put those
    // bytes where the served CSS points. Asset seeding runs first, exactly as
    // seedAll orders it.
    await seedAssetFixtures(testPrisma);
    const systemUserId = await seedSystemUser(testPrisma);
    await seedStylesheetFixtures(testPrisma, systemUserId);

    const proton = await testPrisma.authorStylesheet.findFirstOrThrow({
      where: { authorId: systemUserId, name: 'proton' },
      select: { source: true }
    });

    const hashes = Array.from(
      proton.source.matchAll(/\/api\/asset\/([0-9a-f]{64})/g)
    ).map((m) => m[1]);
    expect(hashes).toHaveLength(3);

    for (const hash of hashes) {
      const asset = await getAssetByHash(hash, testPrisma);
      expect(asset).not.toBeNull();
      // Content-addressed: the stored bytes must hash back to the address the
      // stylesheet names, or `Cache-Control: immutable` would be a lie.
      expect(hashAsset(Buffer.from(asset!.data))).toBe(hash);
    }
  });

  it('re-seeding assets is idempotent — no duplicate rows', async () => {
    await seedAssetFixtures(testPrisma);
    await seedAssetFixtures(testPrisma);
    expect(await testPrisma.asset.count()).toBe(BUILTIN_ASSET_FIXTURES.length);
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

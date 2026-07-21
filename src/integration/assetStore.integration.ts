/**
 * Asset store Phase 2 against a real DB (ADR-0026, #342). The unit specs mock
 * Prisma; this proves the pieces that only mean something against Postgres —
 * the quota count, the seeder/member collision that nulls ownership, and the
 * orphan sweep's actual delete predicate (owned, aged, unreferenced; referenced,
 * in-grace, and site-owned all spared).
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  putAsset,
  uploadAsset,
  getOwnedAssetCount,
  hashAsset
} from '../modules/assetStore';
import { sweepOrphanedAssets, GRACE_MS } from '../modules/assetSweep';

// A distinct valid PNG per test needs distinct bytes → a distinct hash.
const png = (tag: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(tag)
  ]);

let ownerId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const user = await testPrisma.user.create({
    data: {
      username: 'owner',
      email: 'owner@test.local',
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  ownerId = user.id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('uploadAsset quota (count)', () => {
  it('accumulates owned assets and rejects the upload past the cap', async () => {
    await uploadAsset(
      { data: png('one'), kind: 'ThemeImage', ownerId, assetLimit: 2 },
      testPrisma
    );
    await uploadAsset(
      { data: png('two'), kind: 'ThemeImage', ownerId, assetLimit: 2 },
      testPrisma
    );
    expect(await getOwnedAssetCount(ownerId, testPrisma)).toBe(2);

    // A third, distinct asset is over the cap of 2.
    await expect(
      uploadAsset(
        { data: png('three'), kind: 'ThemeImage', ownerId, assetLimit: 2 },
        testPrisma
      )
    ).rejects.toThrow(/limit reached/);
  });

  it('does not charge for re-uploading identical bytes', async () => {
    const bytes = png('same');
    await uploadAsset(
      { data: bytes, kind: 'ThemeImage', ownerId, assetLimit: 1 },
      testPrisma
    );
    // Same bytes, cap already reached at 1: content-addressed, so it stores
    // nothing new and the owned-check must short-circuit the quota.
    const again = await uploadAsset(
      { data: bytes, kind: 'ThemeImage', ownerId, assetLimit: 1 },
      testPrisma
    );

    expect(again.hash).toBe(hashAsset(bytes));
    expect(await getOwnedAssetCount(ownerId, testPrisma)).toBe(1);
  });

  it('rejects a rank that cannot upload (limit 0) before storing anything', async () => {
    await expect(
      uploadAsset(
        { data: png('none'), kind: 'ThemeImage', ownerId, assetLimit: 0 },
        testPrisma
      )
    ).rejects.toThrow(/cannot upload/);
    expect(await getOwnedAssetCount(ownerId, testPrisma)).toBe(0);
  });

  it('stores a member upload owned by the uploader (auth-gated tier)', async () => {
    const stored = await uploadAsset(
      { data: png('mine'), kind: 'ThemeImage', ownerId, assetLimit: null },
      testPrisma
    );
    expect(stored.ownerId).toBe(ownerId);
  });
});

describe('putAsset seeder/member collision', () => {
  it('promotes a member-owned row to site-owned when the seeder stores the same bytes', async () => {
    const bytes = png('collide');
    const uploaded = await uploadAsset(
      { data: bytes, kind: 'ThemeImage', ownerId, assetLimit: null },
      testPrisma
    );
    expect(uploaded.ownerId).toBe(ownerId);

    // The seeder path stores the identical bytes as a site fixture (no ownerId).
    const seeded = await putAsset(
      { data: bytes, kind: 'ThemeImage' },
      testPrisma
    );

    expect(seeded.ownerId).toBeNull();
    const row = await testPrisma.asset.findUniqueOrThrow({
      where: { hash: hashAsset(bytes) }
    });
    expect(row.ownerId).toBeNull();
    // And it drops off the member's quota.
    expect(await getOwnedAssetCount(ownerId, testPrisma)).toBe(0);
  });
});

describe('sweepOrphanedAssets', () => {
  const age = (hash: string) =>
    testPrisma.asset.update({
      where: { hash },
      data: { createdAt: new Date(Date.now() - GRACE_MS - 60_000) }
    });

  it('collects an aged, owned, unreferenced asset', async () => {
    const orphan = await uploadAsset(
      { data: png('orphan'), kind: 'ThemeImage', ownerId, assetLimit: null },
      testPrisma
    );
    await age(orphan.hash);

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(1);
    expect(
      await testPrisma.asset.findUnique({ where: { hash: orphan.hash } })
    ).toBeNull();
  });

  it('spares an asset still referenced by a stylesheet source', async () => {
    const kept = await uploadAsset(
      { data: png('used'), kind: 'ThemeImage', ownerId, assetLimit: null },
      testPrisma
    );
    await age(kept.hash);
    await testPrisma.authorStylesheet.create({
      data: {
        authorId: ownerId,
        name: 'themed',
        source: `body{background:url(/api/asset/${kept.hash})}`
      }
    });

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(0);
    expect(
      await testPrisma.asset.findUnique({ where: { hash: kept.hash } })
    ).not.toBeNull();
  });

  it('spares an asset inside the grace window', async () => {
    // Uploaded just now, no ageing — survives regardless of references.
    await uploadAsset(
      { data: png('fresh'), kind: 'ThemeImage', ownerId, assetLimit: null },
      testPrisma
    );

    expect(await sweepOrphanedAssets(testPrisma)).toBe(0);
  });

  it('never collects a site-owned asset even when unreferenced and aged', async () => {
    const fixture = await putAsset(
      { data: png('fixture'), kind: 'ThemeImage' },
      testPrisma
    );
    await age(fixture.hash);

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(0);
    expect(
      await testPrisma.asset.findUnique({ where: { hash: fixture.hash } })
    ).not.toBeNull();
  });
});

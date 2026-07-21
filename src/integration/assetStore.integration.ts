/**
 * Asset store Phase 2 against a real DB (ADR-0026, #342). The unit specs mock
 * Prisma; this proves the pieces that only mean something against Postgres —
 * the quota SUM, the dedup collision, the visibility default, and the orphan
 * sweep's actual delete predicate (owned, aged, unreferenced, site-owned spared).
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  putAsset,
  uploadAsset,
  getOwnedAssetBytes,
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

describe('uploadAsset quota', () => {
  it('accumulates owned bytes and rejects the upload that would exceed the budget', async () => {
    const first = png('one');
    await uploadAsset(
      {
        data: first,
        kind: 'Avatar',
        ownerId,
        assetByteLimit: first.length + 5
      },
      testPrisma
    );

    expect(await getOwnedAssetBytes(ownerId, testPrisma)).toBe(first.length);

    // A second, distinct asset pushes over the budget.
    await expect(
      uploadAsset(
        {
          data: png('two'),
          kind: 'Avatar',
          ownerId,
          assetByteLimit: first.length + 5
        },
        testPrisma
      )
    ).rejects.toThrow(/storage limit/);
  });

  it('does not charge twice for re-uploading identical bytes', async () => {
    const bytes = png('same');
    const budget = bytes.length + 1; // room for exactly one copy
    await uploadAsset(
      { data: bytes, kind: 'Avatar', ownerId, assetByteLimit: budget },
      testPrisma
    );
    // Same bytes again: content-addressed, so it stores nothing new and the
    // budget check must short-circuit rather than counting a phantom second copy.
    const again = await uploadAsset(
      { data: bytes, kind: 'Avatar', ownerId, assetByteLimit: budget },
      testPrisma
    );

    expect(again.hash).toBe(hashAsset(bytes));
    expect(await getOwnedAssetBytes(ownerId, testPrisma)).toBe(bytes.length);
  });

  it('stores an uploaded asset as Members, owned by the uploader', async () => {
    const stored = await uploadAsset(
      { data: png('vis'), kind: 'Avatar', ownerId, assetByteLimit: 0 },
      testPrisma
    );
    expect(stored.visibility).toBe('Members');
    expect(stored.ownerId).toBe(ownerId);
  });
});

describe('putAsset visibility on dedup collision', () => {
  it('widens a member row to Public when the seeder stores identical bytes', async () => {
    const bytes = png('collide');
    await uploadAsset(
      { data: bytes, kind: 'ThemeImage', ownerId, assetByteLimit: 0 },
      testPrisma
    );

    // The seeder path stores the same bytes as a site fixture.
    const seeded = await putAsset(
      { data: bytes, kind: 'ThemeImage', visibility: 'Public' },
      testPrisma
    );

    expect(seeded.visibility).toBe('Public');
    const row = await testPrisma.asset.findUniqueOrThrow({
      where: { hash: hashAsset(bytes) }
    });
    expect(row.visibility).toBe('Public');
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
      { data: png('orphan'), kind: 'Avatar', ownerId, assetByteLimit: 0 },
      testPrisma
    );
    await age(orphan.hash);

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(1);
    expect(
      await testPrisma.asset.findUnique({ where: { hash: orphan.hash } })
    ).toBeNull();
  });

  it('spares an asset still referenced by an avatar', async () => {
    const kept = await uploadAsset(
      { data: png('avatar'), kind: 'Avatar', ownerId, assetByteLimit: 0 },
      testPrisma
    );
    await age(kept.hash);
    await testPrisma.user.update({
      where: { id: ownerId },
      data: { avatar: `/api/asset/${kept.hash}` }
    });

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(0);
    expect(
      await testPrisma.asset.findUnique({ where: { hash: kept.hash } })
    ).not.toBeNull();
  });

  it('spares an asset inside the grace window', async () => {
    // Uploaded just now — no ageing — so it must survive regardless of refs.
    await uploadAsset(
      { data: png('fresh'), kind: 'Avatar', ownerId, assetByteLimit: 0 },
      testPrisma
    );

    const collected = await sweepOrphanedAssets(testPrisma);

    expect(collected).toBe(0);
  });

  it('never collects a site-owned (Public) asset even when unreferenced and aged', async () => {
    const fixture = await putAsset(
      { data: png('fixture'), kind: 'ThemeImage', visibility: 'Public' },
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

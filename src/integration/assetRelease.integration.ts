/**
 * Releasing an uploaded image when its field moves off it (#871), against real
 * rows. A replaced avatar used to count toward `assetLimit` until the orphan
 * sweep reclaimed it, up to 48 h later, so a 1-slot member could not change
 * theirs. Now the write releases it, the quota stops counting it at once, and
 * deletion stays with the sweep.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  assetUrl,
  getOwnedAssetCount,
  heldImageHashes,
  settlingImageAssets,
  uploadAsset
} from '../modules/assetStore';
import { sweepOrphanedAssets, GRACE_MS } from '../modules/assetSweep';
import { updateProfile } from '../modules/profile';
import { updateUserSettings } from '../modules/user';
import { updateDonorRewards } from '../modules/donor';

const png = (tag: string): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(tag)
  ]);

const viewer = { showMature: false };

const createUser = async (name: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: name,
      email: `${name}@test.local`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

/** Upload as the 1-slot member, optionally for an image field. */
const upload = (
  ownerId: number,
  tag: string,
  replacing: string[] = [],
  assetLimit: number | null = 1
) =>
  uploadAsset(
    { data: png(tag), kind: 'Avatar', ownerId, assetLimit, replacing },
    testPrisma
  );

/** Save the profile avatar the way `PUT /profile/me` does. */
const setAvatar = (userId: number, avatar: string) =>
  settlingImageAssets(
    userId,
    () => updateProfile(userId, { avatar }, viewer),
    testPrisma
  );

const releasedAt = async (hash: string) =>
  (await testPrisma.asset.findUniqueOrThrow({ where: { hash } })).releasedAt;

let userId: number;

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
  userId = (await createUser('member')).id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('replacing an avatar on a 1-slot rank (#871)', () => {
  it('uploads and saves the replacement, and releases the old one', async () => {
    const a = await upload(userId, 'a');
    await setAvatar(userId, assetUrl(a.hash));

    const held = await heldImageHashes(userId, testPrisma);
    const b = await upload(userId, 'b', held.avatar);
    await setAvatar(userId, assetUrl(b.hash));

    expect(await releasedAt(a.hash)).toBeInstanceOf(Date);
    expect(await releasedAt(b.hash)).toBeNull();
    expect(await getOwnedAssetCount(userId, testPrisma)).toBe(1);
  });

  it('refuses the replacement when the upload does not name its field', async () => {
    const a = await upload(userId, 'a');
    await setAvatar(userId, assetUrl(a.hash));

    await expect(upload(userId, 'b')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Asset limit reached (1).'
    });
  });

  it('does not free a slot for a field holding someone else’s asset', async () => {
    const other = await createUser('other');
    const theirs = await upload(other.id, 'theirs');
    const mine = await upload(userId, 'mine');
    await setAvatar(userId, assetUrl(theirs.hash));

    const held = await heldImageHashes(userId, testPrisma);
    await expect(upload(userId, 'next', held.avatar)).rejects.toMatchObject({
      message: 'Asset limit reached (1).'
    });
    expect(await releasedAt(mine.hash)).toBeNull();
  });
});

describe('settling the image fields (#871)', () => {
  it('releases on clear and un-releases on setting it again', async () => {
    const a = await upload(userId, 'a');
    const url = assetUrl(a.hash);
    // updateUserSettings settles on its own, as `PUT /users/settings` calls it.
    const save = (avatar: string) => updateUserSettings(userId, { avatar });

    await save(url);
    expect(await releasedAt(a.hash)).toBeNull();
    await save('');
    expect(await releasedAt(a.hash)).toBeInstanceOf(Date);
    expect(await getOwnedAssetCount(userId, testPrisma)).toBe(0);
    await save(url);
    expect(await releasedAt(a.hash)).toBeNull();
  });

  it('leaves the avatar and its asset alone on a save without one', async () => {
    const a = await upload(userId, 'a');
    await updateUserSettings(userId, { avatar: assetUrl(a.hash) });

    await updateUserSettings(userId, { showEmail: true });

    const user = await testPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatar: true, userSettings: { select: { showEmail: true } } }
    });
    expect(user).toEqual({
      avatar: assetUrl(a.hash),
      userSettings: { showEmail: true }
    });
    expect(await releasedAt(a.hash)).toBeNull();
  });

  it('keeps an asset another of the member’s fields still holds', async () => {
    const a = await upload(userId, 'a');
    const url = assetUrl(a.hash);
    await updateUserSettings(userId, { avatar: url });
    await setAvatar(userId, url);

    await setAvatar(userId, '');

    expect(await releasedAt(a.hash)).toBeNull();
  });

  it('never stamps an asset the member does not own', async () => {
    const other = await createUser('other');
    const theirs = await upload(other.id, 'theirs');
    await setAvatar(userId, assetUrl(theirs.hash));

    await setAvatar(userId, '');

    expect(await releasedAt(theirs.hash)).toBeNull();
  });

  it('releases a donor icon the donor rewards write moved off', async () => {
    const rank = await testPrisma.donorRank.create({
      data: { name: 'Donor', minDonation: 1, perks: { customIcon: true } }
    });
    await testPrisma.userDonorRank.create({
      data: { userId, donorRankId: rank.id }
    });
    const a = await upload(userId, 'a', [], 2);
    const b = await upload(userId, 'b', [], 2);

    await updateDonorRewards(userId, { customIcon: assetUrl(a.hash) });
    await updateDonorRewards(userId, { customIcon: assetUrl(b.hash) });

    expect(await releasedAt(a.hash)).toBeInstanceOf(Date);
    expect(await releasedAt(b.hash)).toBeNull();
  });
});

describe('the sweep still decides deletion (#871)', () => {
  const age = (hash: string) =>
    testPrisma.asset.update({
      where: { hash },
      data: { createdAt: new Date(Date.now() - GRACE_MS - 60_000) }
    });

  it('spares a released asset a stylesheet still embeds', async () => {
    const a = await upload(userId, 'a');
    await setAvatar(userId, assetUrl(a.hash));
    await testPrisma.authorStylesheet.create({
      data: {
        authorId: userId,
        name: 'themed',
        source: `body{background:url(${assetUrl(a.hash)})}`
      }
    });
    await setAvatar(userId, '');
    await age(a.hash);

    await sweepOrphanedAssets(testPrisma);

    expect(await releasedAt(a.hash)).toBeInstanceOf(Date);
    expect(await testPrisma.asset.count({ where: { hash: a.hash } })).toBe(1);
  });

  it('collects a released asset nothing references', async () => {
    const a = await upload(userId, 'a');
    await setAvatar(userId, assetUrl(a.hash));
    await setAvatar(userId, '');
    await age(a.hash);

    await sweepOrphanedAssets(testPrisma);

    expect(await testPrisma.asset.count({ where: { hash: a.hash } })).toBe(0);
  });
});

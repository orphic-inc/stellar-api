import {
  FileType,
  ReleaseType,
  CommunityType,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  grantDownloadAccess,
  reverseDownloadAccess
} from '../modules/downloads';
import { removeConsumedReleaseBookmarks } from '../modules/bookmark';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string, contributed = 0n) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `bm-${tag}-${Date.now()}-${Math.random()}`,
      email: `bm-${tag}-${Date.now()}-${Math.random()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed,
      consumed: 0n,
      canDownload: true
    }
  });
};

/** A release with one contribution; returns both ids. */
const createReleaseWithContribution = async (contributorUserId: number) => {
  const community = await testPrisma.community.create({
    data: {
      name: `BM-Community-${Date.now()}-${Math.random()}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const artist = await testPrisma.artist.create({
    data: { name: `BM-Artist-${Date.now()}-${Math.random()}` }
  });
  const release = await testPrisma.release.create({
    data: {
      title: `BM-Release-${Date.now()}-${Math.random()}`,
      description: 'desc',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020,
      credits: { create: { artistId: artist.id } }
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId: contributorUserId },
    update: {},
    create: { userId: contributorUserId, communityId: community.id }
  });
  const contribution = await testPrisma.contribution.create({
    data: {
      userId: contributorUserId,
      releaseId: release.id,
      contributorId: contributor.id,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: 1_000_000,
      approvedAccountingBytes: 1_000_000n,
      releaseDescription: 'test'
    }
  });
  return { releaseId: release.id, contributionId: contribution.id };
};

const bookmark = (userId: number, releaseId: number) =>
  testPrisma.bookmarkRelease.create({ data: { userId, releaseId } });

describe('removeConsumedReleaseBookmarks', () => {
  it('removes only bookmarks for releases the caller has a COMPLETED grant on', async () => {
    const COST = 1_000_000;
    const contributor = await createUser('contrib');
    const viewer = await createUser('viewer', BigInt(COST * 10));
    const other = await createUser('other', BigInt(COST * 10));

    // A: viewer consumed (COMPLETED grant) -> should be removed
    const a = await createReleaseWithContribution(contributor.id);
    await grantDownloadAccess(viewer.id, a.contributionId);

    // B: bookmarked, never consumed -> kept
    const b = await createReleaseWithContribution(contributor.id);

    // C: consumed by ANOTHER user, only bookmarked by viewer -> kept
    const c = await createReleaseWithContribution(contributor.id);
    await grantDownloadAccess(other.id, c.contributionId);

    // D: viewer's only grant was REVERSED -> kept
    const d = await createReleaseWithContribution(contributor.id);
    const dGrant = await grantDownloadAccess(viewer.id, d.contributionId);
    await reverseDownloadAccess(contributor.id, dGrant.grantId, 'test');

    await Promise.all([
      bookmark(viewer.id, a.releaseId),
      bookmark(viewer.id, b.releaseId),
      bookmark(viewer.id, c.releaseId),
      bookmark(viewer.id, d.releaseId)
    ]);

    const removed = await removeConsumedReleaseBookmarks(viewer.id);
    expect(removed).toBe(1);

    const surviving = await testPrisma.bookmarkRelease.findMany({
      where: { userId: viewer.id },
      select: { releaseId: true }
    });
    expect(surviving.map((r) => r.releaseId).sort()).toEqual(
      [b.releaseId, c.releaseId, d.releaseId].sort()
    );
  });

  it('returns 0 and removes nothing when the caller has consumed no bookmarks', async () => {
    const contributor = await createUser('contrib');
    const viewer = await createUser('viewer');
    const b = await createReleaseWithContribution(contributor.id);
    await bookmark(viewer.id, b.releaseId);

    const removed = await removeConsumedReleaseBookmarks(viewer.id);
    expect(removed).toBe(0);
    const count = await testPrisma.bookmarkRelease.count({
      where: { userId: viewer.id }
    });
    expect(count).toBe(1);
  });
});

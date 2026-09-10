/**
 * The recent-contributions block on a profile is scoped to the VIEWER
 * (#607, ADR-0036 §1).
 *
 * This surface is the most reachable of the seven #607 found: it needs no
 * crafted id, just a profile page. `getRecentContributions` ran with the
 * target's id and no viewer scope at all, so opening any member's profile
 * showed the title, cover and artist of their last five contributions —
 * including ones in communities the reader has no access to.
 *
 * Tested against a real database rather than with mocks, because the function
 * is private to the module and `buildProfileView` fans out across a dozen
 * queries; mocking that reliably would assert the mock, not the scope. The
 * other six surfaces are covered by unit specs asserting the where clause,
 * which is possible where the query is one call in a route.
 */

import {
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

const createUser = async (name: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = (registrationStatus: RegistrationStatus) =>
  testPrisma.community.create({
    data: {
      name: tag(`PRS-${registrationStatus}`),
      image: '',
      registrationStatus,
      type: CommunityType.Music
    }
  });

/** One contribution by `userId`, on a release in `communityId`. */
const contribute = async (opts: {
  userId: number;
  communityId: number;
  title: string;
}) => {
  const release = await testPrisma.release.create({
    data: {
      title: opts.title,
      description: 'desc',
      communityId: opts.communityId,
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 2020
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId: opts.userId },
    update: {},
    create: { userId: opts.userId, communityId: opts.communityId }
  });
  await testPrisma.contribution.create({
    data: {
      userId: opts.userId,
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
  return release;
};

const recentTitles = async (targetId: number, viewerId: number) => {
  const view = await getProfileById(targetId, viewerId, { showMature: false });
  return (
    view as unknown as { recentContributions: { release: { title: string } }[] }
  ).recentContributions
    .map((row) => row.release.title)
    .sort();
};

describe('GET /profile — recent contributions are viewer-scoped', () => {
  it('hides a private-community contribution from a non-member', async () => {
    const target = await createUser('prs-target');
    const stranger = await createUser('prs-stranger');
    const open = await createCommunity(RegistrationStatus.open);
    const closed = await createCommunity(RegistrationStatus.closed);

    await contribute({
      userId: target.id,
      communityId: open.id,
      title: 'Public Record'
    });
    await contribute({
      userId: target.id,
      communityId: closed.id,
      title: 'Private Record'
    });

    expect(await recentTitles(target.id, stranger.id)).toEqual([
      'Public Record'
    ]);
  });

  it('shows the same contribution to a member of that community', async () => {
    const target = await createUser('prs-target2');
    const member = await createUser('prs-member');
    const closed = await createCommunity(RegistrationStatus.closed);
    await testPrisma.community.update({
      where: { id: closed.id },
      data: { curators: { connect: { id: member.id } } }
    });

    await contribute({
      userId: target.id,
      communityId: closed.id,
      title: 'Private Record'
    });

    // The same row, the same profile, a different reader. This is what makes
    // the response viewer-dependent, which ADR-0036 §1 accepts deliberately.
    expect(await recentTitles(target.id, member.id)).toEqual([
      'Private Record'
    ]);
  });

  it('shows the owner their own private-community contribution', async () => {
    const target = await createUser('prs-owner');
    const closed = await createCommunity(RegistrationStatus.closed);
    await testPrisma.community.update({
      where: { id: closed.id },
      data: { curators: { connect: { id: target.id } } }
    });

    await contribute({
      userId: target.id,
      communityId: closed.id,
      title: 'Own Record'
    });

    expect(await recentTitles(target.id, target.id)).toEqual(['Own Record']);
  });
});

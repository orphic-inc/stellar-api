/**
 * The contribution reads that list a release's files carry `ratioExempt` (#728).
 *
 * Against a real database because the defect was a projection one: the
 * contract declared the field, and the `select` never asked for it. A mocked
 * Prisma returns whatever the fixture holds, whatever the select says.
 */

import {
  CommunityType,
  FileType,
  RatioExempt,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { listReleaseContributions } from '../modules/releaseWorkbench/contributions';
import { listCommunityReleases } from '../modules/releaseBrowse';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const username = uniqueName('rx');
  return testPrisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

/** An open community holding one release with a file under each exemption. */
const setup = async () => {
  const uploader = await createUser();
  const community = await testPrisma.community.create({
    data: {
      name: uniqueName('RX'),
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const release = await testPrisma.release.create({
    data: {
      title: 'Kind of Blue',
      description: 'A release',
      communityId: community.id,
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 1959
    }
  });
  const contributor = await testPrisma.contributor.create({
    data: {
      userId: uploader.id,
      communities: { connect: { id: community.id } }
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  for (const ratioExempt of Object.values(RatioExempt)) {
    await testPrisma.contribution.create({
      data: {
        userId: uploader.id,
        releaseId: release.id,
        editionId: edition.id,
        contributorId: contributor.id,
        type: FileType.flac,
        downloadUrl: 'https://example.com/x.torrent',
        ratioExempt
      }
    });
  }
  return { uploader, community, release };
};

const ALL_EXEMPTIONS = Object.values(RatioExempt).sort();

describe('ratioExempt on the release contribution reads (#728)', () => {
  it('is carried by the release-scoped read behind the edition stack', async () => {
    const { uploader, community, release } = await setup();

    const rows = await listReleaseContributions({
      actorId: uploader.id,
      communityId: community.id,
      releaseId: release.id
    });

    expect(rows.map((r) => r.ratioExempt).sort()).toEqual(ALL_EXEMPTIONS);
  });

  it('is carried by each contribution on the community browse', async () => {
    const { uploader, community } = await setup();

    const { data } = await listCommunityReleases({
      actorId: uploader.id,
      communityId: community.id,
      page: 1,
      limit: 25
    });

    expect(data).toHaveLength(1);
    expect(data[0].contributions.map((c) => c.ratioExempt).sort()).toEqual(
      ALL_EXEMPTIONS
    );
  });
});

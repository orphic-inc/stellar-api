/**
 * A ratio-exemption change writes a release history row (#732).
 *
 * Against a real database for the parts a mock cannot hold: the row lock that
 * keeps concurrent changes from recording a stale "was", the enum value the
 * migration adds, and the revert gate reading the stored action.
 */

import {
  CommunityType,
  FileType,
  RatioExempt,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseHistoryAction,
  ReleaseType
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { setContributionRatioExempt } from '../modules/contribution';
import { getReleaseWorkbenchHistoryPage } from '../modules/releaseWorkbench/load';
import { revertReleaseWorkbenchHistory } from '../modules/releaseWorkbench/history';

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
  const username = uniqueName('rxh');
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

/** A FLAC on a release in an open community, and a member of staff. */
const setup = async () => {
  const uploader = await createUser();
  const staff = await createUser();
  const community = await testPrisma.community.create({
    data: {
      name: uniqueName('RXH'),
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
  const contribution = await testPrisma.contribution.create({
    data: {
      userId: uploader.id,
      releaseId: release.id,
      editionId: edition.id,
      contributorId: contributor.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/x.torrent'
    }
  });
  const ref = {
    actorId: staff.id,
    communityId: community.id,
    releaseId: release.id,
    permissions: { communities_manage: true }
  };
  return { staff, release, contribution, ref };
};

const historyOf = (releaseId: number) =>
  testPrisma.releaseHistory.findMany({
    where: { releaseId, action: ReleaseHistoryAction.ratio_exempt_changed },
    orderBy: { id: 'asc' }
  });

describe('ratio-exemption history (#732)', () => {
  it('records who changed which file, from what to what', async () => {
    const { staff, release, contribution, ref } = await setup();

    await setContributionRatioExempt(
      staff.id,
      contribution.id,
      RatioExempt.FREEPASS
    );

    const [row, ...rest] = await historyOf(release.id);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      actorId: staff.id,
      summary: 'FLAC set to Freepass (was None)',
      changedFields: ['ratioExempt'],
      before: { contributionId: contribution.id, ratioExempt: 'NONE' },
      after: { contributionId: contribution.id, ratioExempt: 'FREEPASS' }
    });

    // The release page's history read returns it.
    const page = await getReleaseWorkbenchHistoryPage(ref, {});
    expect(page.data.map((e) => e.summary)).toContain(
      'FLAC set to Freepass (was None)'
    );
  });

  it('writes nothing when the value is unchanged', async () => {
    const { staff, release, contribution } = await setup();

    await setContributionRatioExempt(
      staff.id,
      contribution.id,
      RatioExempt.NONE
    );

    expect(await historyOf(release.id)).toHaveLength(0);
  });

  it('is a 404 for a missing contribution, and writes nothing', async () => {
    const { staff, release } = await setup();

    await expect(
      setContributionRatioExempt(staff.id, 999_999, RatioExempt.FREEPASS)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await historyOf(release.id)).toHaveLength(0);
  });

  it('cannot be reverted', async () => {
    const { staff, release, contribution, ref } = await setup();
    await setContributionRatioExempt(
      staff.id,
      contribution.id,
      RatioExempt.NEUTRALPASS
    );
    const [row] = await historyOf(release.id);

    await expect(
      revertReleaseWorkbenchHistory(ref, { historyId: row.id })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  // Six concurrent changes, not two: two rarely overlap, and a race test that
  // never races proves nothing. Without the row lock, several read the same
  // starting value and the chain breaks.
  it('keeps one unbroken chain under concurrent changes', async () => {
    const { staff, release, contribution } = await setup();
    const targets = [
      RatioExempt.FREEPASS,
      RatioExempt.NEUTRALPASS,
      RatioExempt.FREEPASS,
      RatioExempt.NONE,
      RatioExempt.NEUTRALPASS,
      RatioExempt.FREEPASS
    ];

    await Promise.all(
      targets.map((target) =>
        setContributionRatioExempt(staff.id, contribution.id, target)
      )
    );

    const rows = await historyOf(release.id);
    const values = rows.map((r) => ({
      from: (r.before as { ratioExempt: string }).ratioExempt,
      to: (r.after as { ratioExempt: string }).ratioExempt
    }));
    expect(values[0].from).toBe('NONE');
    for (let i = 1; i < values.length; i++) {
      expect(values[i].from).toBe(values[i - 1].to);
    }
    const final = await testPrisma.contribution.findUniqueOrThrow({
      where: { id: contribution.id }
    });
    expect(values[values.length - 1].to).toBe(final.ratioExempt);
  });
});

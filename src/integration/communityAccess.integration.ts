import {
  CommunityType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  communityRoleUnion,
  hasCommunityAccess
} from '../modules/communityAccess';
import { listCommunityReleases } from '../modules/releaseBrowse';
import { loadReleaseWorkbenchAuthority } from '../modules/releaseWorkbench/authority';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (tag: string) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `ca-${tag}-${Date.now()}`,
      email: `ca-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = (
  registrationStatus: RegistrationStatus,
  staffId?: number
) =>
  testPrisma.community.create({
    data: {
      name: `Community-${registrationStatus}-${Date.now()}`,
      image: '',
      registrationStatus,
      type: CommunityType.Music,
      ...(staffId !== undefined && { staff: { connect: { id: staffId } } })
    }
  });

const createRelease = (communityId: number) =>
  testPrisma.release.create({
    data: {
      title: 'Kind of Blue',
      description: 'A release',
      communityId,
      type: ReleaseType.Music,
      releaseType: ReleaseCategory.Album,
      year: 1959
    }
  });

describe('a staff-only member of a closed community (#419)', () => {
  it('reaches every surface gated by hasCommunityAccess', async () => {
    const staffer = await createUser('staff');
    const community = await createCommunity(
      RegistrationStatus.closed,
      staffer.id
    );
    const release = await createRelease(community.id);

    // The bug this fixes: POST /:id/staff connects a staff row and nothing
    // else, so a staff-only member holds no Consumer record.
    const consumer = await testPrisma.consumer.findUnique({
      where: { userId: staffer.id }
    });
    expect(consumer).toBeNull();

    await expect(
      hasCommunityAccess(community.id, staffer.id, community.registrationStatus)
    ).resolves.toBe(true);

    const browsed = await listCommunityReleases({
      actorId: staffer.id,
      communityId: community.id,
      page: 1,
      limit: 25
    });
    expect(browsed.total).toBe(1);
    expect(browsed.data[0].id).toBe(release.id);

    const authority = await loadReleaseWorkbenchAuthority({
      actorId: staffer.id,
      communityId: community.id,
      releaseId: release.id
    });
    expect(authority.releaseId).toBe(release.id);
  });

  it('appears in the browse filter for the communities they staff', async () => {
    const staffer = await createUser('browse');
    const staffed = await createCommunity(
      RegistrationStatus.closed,
      staffer.id
    );
    const unrelated = await createCommunity(RegistrationStatus.closed);

    const visible = await testPrisma.community.findMany({
      where: {
        OR: [
          { registrationStatus: RegistrationStatus.open },
          communityRoleUnion(staffer.id)
        ]
      },
      select: { id: true }
    });

    expect(visible.map((c) => c.id)).toEqual([staffed.id]);
    expect(visible.map((c) => c.id)).not.toContain(unrelated.id);
  });
});

describe('a non-member of a closed community', () => {
  it('is refused on every surface gated by hasCommunityAccess', async () => {
    const outsider = await createUser('outsider');
    const community = await createCommunity(RegistrationStatus.closed);
    const release = await createRelease(community.id);

    await expect(
      hasCommunityAccess(
        community.id,
        outsider.id,
        community.registrationStatus
      )
    ).resolves.toBe(false);

    await expect(
      listCommunityReleases({
        actorId: outsider.id,
        communityId: community.id,
        page: 1,
        limit: 25
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      loadReleaseWorkbenchAuthority({
        actorId: outsider.id,
        communityId: community.id,
        releaseId: release.id
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('registrationStatus is the only thing that opens a community', () => {
  // Half of ADR-0030's hard constraint: registration status alone decides
  // whether a non-member gets in. The PRIVATE + `open` case it also demands
  // cannot be expressed until `Community.announceVisibility` lands (slice 2) —
  // until then the standing guard is the structural one in
  // modules/communityAccess.spec.ts, which fails if a visibility arm is ever
  // added to the union (ADR-0015, Golden Rule 3).
  it('lets a non-member read an open community', async () => {
    const outsider = await createUser('open-outsider');
    const community = await createCommunity(RegistrationStatus.open);
    await createRelease(community.id);

    await expect(
      hasCommunityAccess(
        community.id,
        outsider.id,
        community.registrationStatus
      )
    ).resolves.toBe(true);

    const browsed = await listCommunityReleases({
      actorId: outsider.id,
      communityId: community.id,
      page: 1,
      limit: 25
    });
    expect(browsed.total).toBe(1);
  });
});

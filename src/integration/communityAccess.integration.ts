import {
  AnnounceVisibility,
  CommunityType,
  RegistrationStatus,
  ReleaseCategory,
  ReleaseType
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  communityRoleUnion,
  hasCommunityAccess,
  listCommunityMembers
} from '../modules/communityAccess';
import { seedDefaultCommunity } from '../modules/bootstrap';
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
  curatorId?: number,
  announceVisibility?: AnnounceVisibility
) =>
  testPrisma.community.create({
    data: {
      name: `Community-${registrationStatus}-${Date.now()}`,
      image: '',
      registrationStatus,
      type: CommunityType.Music,
      ...(announceVisibility !== undefined && { announceVisibility }),
      ...(curatorId !== undefined && {
        curators: { connect: { id: curatorId } }
      })
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

describe('a curator-only member of a closed community (#419)', () => {
  it('reaches every surface gated by hasCommunityAccess', async () => {
    const curator = await createUser('curator');
    const community = await createCommunity(
      RegistrationStatus.closed,
      curator.id
    );
    const release = await createRelease(community.id);

    // The bug this fixes: POST /:id/curators connects a curator row and
    // nothing else, so a curator-only member holds no Consumer record.
    const consumer = await testPrisma.consumer.findUnique({
      where: { userId: curator.id }
    });
    expect(consumer).toBeNull();

    await expect(
      hasCommunityAccess(community.id, curator.id, community.registrationStatus)
    ).resolves.toBe(true);

    const browsed = await listCommunityReleases({
      actorId: curator.id,
      communityId: community.id,
      page: 1,
      limit: 25
    });
    expect(browsed.total).toBe(1);
    expect(browsed.data[0].id).toBe(release.id);

    const authority = await loadReleaseWorkbenchAuthority({
      actorId: curator.id,
      communityId: community.id,
      releaseId: release.id
    });
    expect(authority.releaseId).toBe(release.id);
  });

  it('appears in the browse filter for the communities they curate', async () => {
    const curator = await createUser('browse');
    const curated = await createCommunity(
      RegistrationStatus.closed,
      curator.id
    );
    const unrelated = await createCommunity(RegistrationStatus.closed);

    const visible = await testPrisma.community.findMany({
      where: {
        OR: [
          { registrationStatus: RegistrationStatus.open },
          communityRoleUnion(curator.id)
        ]
      },
      select: { id: true }
    });

    expect(visible.map((c) => c.id)).toEqual([curated.id]);
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
  // ADR-0030's hard constraint: registration status alone decides whether a
  // non-member gets in, and `announceVisibility` never does (ADR-0015, Golden
  // Rule 3). Paired with the structural guard in modules/communityAccess.spec.ts,
  // which fails if a visibility arm is ever added to the union.
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

  it('keeps a PRIVATE-announce community readable when registration is open', async () => {
    const outsider = await createUser('private-announce-outsider');
    const community = await createCommunity(
      RegistrationStatus.open,
      undefined,
      AnnounceVisibility.PRIVATE
    );
    await createRelease(community.id);

    expect(community.announceVisibility).toBe(AnnounceVisibility.PRIVATE);

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

  it('does not let PRIVATE announce visibility open a closed community', async () => {
    const outsider = await createUser('private-announce-closed');
    const community = await createCommunity(
      RegistrationStatus.closed,
      undefined,
      AnnounceVisibility.PRIVATE
    );
    await createRelease(community.id);

    await expect(
      hasCommunityAccess(
        community.id,
        outsider.id,
        community.registrationStatus
      )
    ).resolves.toBe(false);
  });
});

describe('the member roster is the role union (ADR-0033)', () => {
  it('lists a curator who holds no Consumer row', async () => {
    const curator = await createUser('roster-curator');
    const consumer = await createUser('roster-consumer');
    const community = await createCommunity(
      RegistrationStatus.closed,
      curator.id
    );
    await testPrisma.consumer.create({
      data: {
        userId: consumer.id,
        communities: { connect: { id: community.id } }
      }
    });

    // The bug ADR-0033 fixes for display: this user is absent from a
    // consumers-only roster despite administering the community.
    await expect(
      testPrisma.consumer.findUnique({ where: { userId: curator.id } })
    ).resolves.toBeNull();

    const members = await listCommunityMembers(community.id);
    expect(members).toEqual(
      expect.arrayContaining([
        { id: curator.id, username: curator.username, roles: ['curator'] },
        { id: consumer.id, username: consumer.username, roles: ['consumer'] }
      ])
    );
    expect(members).toHaveLength(2);
  });

  it('lists a leader created through POST /communities, who has no Consumer row', async () => {
    const leader = await createUser('roster-leader');
    const community = await testPrisma.community.create({
      data: {
        name: `Community-led-${Date.now()}`,
        image: '',
        registrationStatus: RegistrationStatus.closed,
        type: CommunityType.Music,
        leader: { connect: { id: leader.id } },
        curators: { connect: { id: leader.id } }
      }
    });

    await expect(
      testPrisma.consumer.findUnique({ where: { userId: leader.id } })
    ).resolves.toBeNull();

    await expect(listCommunityMembers(community.id)).resolves.toEqual([
      { id: leader.id, username: leader.username, roles: ['curator', 'leader'] }
    ]);
    // And the union agrees — the roster is not a second opinion on membership.
    await expect(
      hasCommunityAccess(community.id, leader.id, community.registrationStatus)
    ).resolves.toBe(true);
  });
});

describe('seedDefaultCommunity survives the curator rename (#422)', () => {
  it('is idempotent and leaves the SysOp a curator and leader, not a consumer', async () => {
    const sysop = await createUser('seed-sysop');

    await seedDefaultCommunity(testPrisma, sysop.id);
    await seedDefaultCommunity(testPrisma, sysop.id);

    const communities = await testPrisma.community.findMany({
      where: { curators: { some: { id: sysop.id } } },
      include: { curators: { select: { id: true } } }
    });
    expect(communities).toHaveLength(1);
    expect(communities[0].curators.map((c) => c.id)).toEqual([sysop.id]);
    expect(communities[0].leaderId).toBe(sysop.id);

    // The rename migrated the relation rather than dropping and recreating it,
    // and the seed no longer synthesises consumption (ADR-0033 §3).
    await expect(
      testPrisma.consumer.findUnique({ where: { userId: sysop.id } })
    ).resolves.toBeNull();
  });
});

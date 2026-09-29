import {
  CommunityType,
  FileType,
  RegistrationStatus,
  ReleaseType
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  addBounty,
  createRequest,
  deleteRequest,
  fillRequest,
  getBountyHistory,
  MINIMUM_BOUNTY,
  toggleVote,
  unfillRequest,
  updateRequest
} from '../modules/requestLifecycle';

/**
 * Community access on every id-addressed request surface (#755, #771), against
 * the real database: the relation filter is only proved by real rows.
 *
 * A caller outside a closed community must get, on every surface, exactly the
 * answer an id that does not exist gets, and change nothing. A member must
 * still succeed, so the gate is a gate and not a blanket refusal.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const MISSING = 2_000_000_000;

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `ra-${tag}`,
      email: `ra-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed: MINIMUM_BOUNTY * 10n
    }
  });
};

/** A closed community whose only member is `memberId`. */
const closedCommunity = (memberId: number) =>
  testPrisma.community.create({
    data: {
      name: `RA-${randomUUID().slice(0, 8)}`,
      image: '',
      registrationStatus: RegistrationStatus.closed,
      type: CommunityType.Music,
      consumers: { create: { userId: memberId } }
    }
  });

/** A contribution owned by `userId`, in an open community of their own. */
const ownContribution = async (userId: number) => {
  const community = await testPrisma.community.create({
    data: {
      name: `RA-open-${randomUUID().slice(0, 8)}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const release = await testPrisma.release.create({
    data: {
      title: `RA-${randomUUID().slice(0, 8)}`,
      description: 'd',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020,
      communityId: community.id
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.create({
    data: { userId, communities: { connect: { id: community.id } } }
  });
  return testPrisma.contribution.create({
    data: {
      userId,
      releaseId: release.id,
      contributorId: contributor.id,
      editionId: edition.id,
      type: FileType.flac,
      downloadUrl: 'https://example.com/file.torrent',
      sizeInBytes: 1_000_000,
      releaseDescription: 'd'
    }
  });
};

/** The rejection a call ends in, as status and message. */
const refusal = async (call: () => Promise<unknown>) => {
  const err = (await call().catch((e: unknown) => e)) as {
    statusCode?: number;
    message?: string;
  };
  return { statusCode: err.statusCode, message: err.message };
};

const setup = async () => {
  const member = await createUser();
  const outsider = await createUser();
  const community = await closedCommunity(member.id);
  const request = await createRequest(member.id, {
    communityId: community.id,
    type: ReleaseType.Music,
    title: 'secret-request',
    description: 'd',
    image: undefined,
    bounty: MINIMUM_BOUNTY
  });
  return { member, outsider, community, request };
};

describe('request surfaces for a caller outside the community (#755)', () => {
  it('answers every surface exactly as for a missing id, and changes nothing', async () => {
    const { outsider, request } = await setup();
    const surfaces: Array<[string, (id: number) => Promise<unknown>]> = [
      ['bounty history', (id) => getBountyHistory(id, outsider.id)],
      ['vote', (id) => toggleVote(id, outsider.id)],
      ['bounty', (id) => addBounty(outsider.id, id, MINIMUM_BOUNTY)],
      [
        'update',
        (id) =>
          updateRequest({
            requestId: id,
            actorId: outsider.id,
            canModerateRequests: true,
            input: { title: 'hijacked', image: undefined }
          })
      ],
      [
        'delete',
        (id) =>
          deleteRequest({
            requestId: id,
            actorId: outsider.id,
            canModerateRequests: true
          })
      ]
    ];

    for (const [name, call] of surfaces) {
      const hidden = await refusal(() => call(request.id));
      const missing = await refusal(() => call(MISSING));
      expect({ name, ...hidden }).toEqual({ name, ...missing });
      expect(hidden.statusCode).toBe(404);
    }

    const after = await testPrisma.request.findUniqueOrThrow({
      where: { id: request.id },
      include: { bounties: true, votes: true }
    });
    expect(after.title).toBe('secret-request');
    expect(after.deletedAt).toBeNull();
    expect(after.bounties).toHaveLength(1);
    expect(after.votes).toHaveLength(0);
    const { consumed } = await testPrisma.user.findUniqueOrThrow({
      where: { id: outsider.id }
    });
    expect(consumed).toBe(0n);
  });

  it('refuses fill and unfill as for a missing id', async () => {
    const { outsider, request } = await setup();
    // The outsider's own contribution, so the fill gets past its contribution
    // lookup and reaches the request read.
    const contribution = await ownContribution(outsider.id);
    const fill = (id: number) => fillRequest(outsider.id, id, contribution.id);
    const unfill = (id: number) =>
      unfillRequest({
        requestId: id,
        actorId: outsider.id,
        canModerateRequests: true
      });

    expect(await refusal(() => unfill(request.id))).toEqual(
      await refusal(() => unfill(MISSING))
    );
    const hiddenFill = await refusal(() => fill(request.id));
    expect(hiddenFill).toEqual(await refusal(() => fill(MISSING)));
    expect(hiddenFill.statusCode).toBe(404);
  });

  it('refuses a fill naming a hidden contribution as for a missing one (#774)', async () => {
    const { member, outsider, community } = await setup();
    // The member's contribution in the closed community, invisible to the
    // outsider: before #774 its ownership check answered 403, not 404.
    const release = await testPrisma.release.create({
      data: {
        title: `RA-${randomUUID().slice(0, 8)}`,
        description: 'd',
        type: ReleaseType.Music,
        releaseType: 'Album',
        year: 2020,
        communityId: community.id
      }
    });
    const edition = await testPrisma.edition.create({
      data: { releaseId: release.id }
    });
    const contributor = await testPrisma.contributor.create({
      data: { userId: member.id }
    });
    const hidden = await testPrisma.contribution.create({
      data: {
        userId: member.id,
        releaseId: release.id,
        contributorId: contributor.id,
        editionId: edition.id,
        type: FileType.flac,
        downloadUrl: 'https://example.com/file.torrent',
        sizeInBytes: 1_000_000,
        releaseDescription: 'd'
      }
    });
    const fill = (contributionId: number) =>
      fillRequest(outsider.id, MISSING, contributionId);

    const refused = await refusal(() => fill(hidden.id));
    expect(refused).toEqual(await refusal(() => fill(MISSING)));
    expect(refused).toEqual({
      statusCode: 404,
      message: 'Contribution not found'
    });
  });

  it('refuses to create a request in the community as for an unknown one', async () => {
    const { outsider, community } = await setup();
    const create = (communityId: number) =>
      createRequest(outsider.id, {
        communityId,
        type: ReleaseType.Music,
        title: 'T',
        description: 'D',
        image: undefined,
        bounty: MINIMUM_BOUNTY
      });

    const hidden = await refusal(() => create(community.id));
    expect(hidden).toEqual(await refusal(() => create(MISSING)));
    expect(hidden.statusCode).toBe(400);
    expect(
      await testPrisma.request.count({ where: { userId: outsider.id } })
    ).toBe(0);
  });

  it('still lets a member use the same surfaces', async () => {
    const { member, request } = await setup();
    await expect(toggleVote(request.id, member.id)).resolves.toEqual({
      voted: true
    });
    const history = await getBountyHistory(request.id, member.id);
    expect(history.bounties).toHaveLength(1);
  });
});

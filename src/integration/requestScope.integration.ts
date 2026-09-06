import { CommunityType, RegistrationStatus, ReleaseType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { listRequests, getRequestDetail } from '../modules/requestLifecycle';

/**
 * Requests are scoped to communities the caller can reach (#547).
 *
 * `GET /requests` had no session requirement at all, and `communityId` was a
 * caller-supplied FILTER rather than a restriction — the same defect #509 F2
 * fixed for `/search/requests`, left live on the browse path. The projection
 * carries the community's NAME, so private community names leaked too.
 *
 * Driven against the real database because a unit test with a mocked Prisma
 * asserts the `where` shape, not that the rows are actually excluded.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

// randomUUID, not Date.now(): two fixtures created in the same millisecond
// collided on the unique name and produced a flake (#499).
const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `rs-${tag}`,
      email: `rs-${tag}@example.com`,
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
  consumerId?: number
) =>
  testPrisma.community.create({
    data: {
      name: `RS-${randomUUID().slice(0, 8)}`,
      image: '',
      registrationStatus,
      type: CommunityType.Music,
      ...(consumerId !== undefined && {
        consumers: { create: { userId: consumerId } }
      })
    }
  });

const createRequest = (communityId: number, userId: number, title: string) =>
  testPrisma.request.create({
    data: {
      communityId,
      userId,
      title,
      description: 'd',
      type: ReleaseType.Music
    }
  });

describe('request community scoping', () => {
  it('hides requests in a private community the caller is not in', async () => {
    const outsider = await createUser();
    const member = await createUser();
    const priv = await createCommunity(RegistrationStatus.closed, member.id);
    await createRequest(priv.id, member.id, 'secret-request');

    const asOutsider = await listRequests({ viewerId: outsider.id });
    expect(asOutsider.data).toHaveLength(0);

    const asMember = await listRequests({ viewerId: member.id });
    expect(asMember.data.map((r) => r.title)).toContain('secret-request');
  });

  it('shows requests in an open community to anyone', async () => {
    const anyone = await createUser();
    const author = await createUser();
    const open = await createCommunity(RegistrationStatus.open);
    await createRequest(open.id, author.id, 'open-request');

    const result = await listRequests({ viewerId: anyone.id });
    expect(result.data.map((r) => r.title)).toContain('open-request');
  });

  it('does not let a caller-supplied communityId widen the scope', async () => {
    // The heart of it: `?communityId=N` used to be the only thing that decided
    // which community's requests came back.
    const outsider = await createUser();
    const member = await createUser();
    const priv = await createCommunity(RegistrationStatus.closed, member.id);
    await createRequest(priv.id, member.id, 'secret-request');

    const targeted = await listRequests({
      viewerId: outsider.id,
      communityId: priv.id
    });
    expect(targeted.data).toHaveLength(0);
  });

  it('answers 404, not 403, for a request the caller cannot reach', async () => {
    // A distinguishable 403 would confirm a private community holds a request
    // with this id — the existence oracle #509 reasoned about.
    const outsider = await createUser();
    const member = await createUser();
    const priv = await createCommunity(RegistrationStatus.closed, member.id);
    const req = await createRequest(priv.id, member.id, 'secret-request');

    await expect(getRequestDetail(req.id, outsider.id)).rejects.toMatchObject({
      statusCode: 404
    });

    const seen = await getRequestDetail(req.id, member.id);
    expect(seen.title).toBe('secret-request');
  });
});

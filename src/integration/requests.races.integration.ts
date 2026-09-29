import {
  CommunityType,
  EconomyTransactionReason,
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
  MINIMUM_BOUNTY,
  unfillRequest
} from '../modules/requestLifecycle';

/**
 * Balance races in the request lifecycle (#767, an instance of #766), against
 * the real database. Each test runs two calls at once and asserts the money
 * balances whichever wins. Interleaving is not deterministic, so these are
 * evidence rather than negative controls; requestLifecycle.races.spec.ts pins
 * the structure.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const START = MINIMUM_BOUNTY * 10n;

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `rr-${tag}`,
      email: `rr-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      contributed: START
    }
  });
};

const createCommunity = () =>
  testPrisma.community.create({
    data: {
      name: `RR-${randomUUID().slice(0, 8)}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });

const createContribution = async (userId: number, communityId: number) => {
  const release = await testPrisma.release.create({
    data: {
      title: `RR-${randomUUID().slice(0, 8)}`,
      description: 'd',
      type: ReleaseType.Music,
      releaseType: 'Album',
      year: 2020,
      communityId
    }
  });
  const edition = await testPrisma.edition.create({
    data: { releaseId: release.id }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId },
    update: { communities: { connect: { id: communityId } } },
    create: { userId, communities: { connect: { id: communityId } } }
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

const openRequest = (userId: number, communityId: number) =>
  createRequest(userId, {
    communityId,
    type: ReleaseType.Music,
    title: 'T',
    description: 'D',
    image: undefined,
    bounty: MINIMUM_BOUNTY
  });

const balanceOf = async (id: number) =>
  testPrisma.user.findUniqueOrThrow({
    where: { id },
    select: { contributed: true, consumed: true }
  });

const ledger = (requestId: number, reason: EconomyTransactionReason) =>
  testPrisma.economyTransaction.findMany({
    where: { contextId: requestId, contextType: 'request', reason }
  });

const settle = async (...calls: Promise<unknown>[]) => {
  const results = await Promise.allSettled(calls);
  return {
    ok: results.filter((r) => r.status === 'fulfilled').length,
    errors: results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as { statusCode?: number })
  };
};

describe('request balance races (#767)', () => {
  it('a concurrent double unfill claws back once', async () => {
    const [owner, filler] = [await createUser(), await createUser()];
    const community = await createCommunity();
    const request = await openRequest(owner.id, community.id);
    const contribution = await createContribution(filler.id, community.id);
    await fillRequest(filler.id, request.id, contribution.id);
    const unfill = () =>
      unfillRequest({
        requestId: request.id,
        actorId: owner.id,
        canModerateRequests: true
      });

    const { ok, errors } = await settle(unfill(), unfill());

    expect(ok).toBe(1);
    expect(errors).toEqual([expect.objectContaining({ statusCode: 422 })]);
    expect((await balanceOf(filler.id)).contributed).toBe(START);
    expect(await ledger(request.id, 'REQUEST_UNFILL')).toHaveLength(1);
  });

  it('a concurrent double delete refunds each bounty once', async () => {
    const [owner, backer] = [await createUser(), await createUser()];
    const community = await createCommunity();
    const request = await openRequest(owner.id, community.id);
    await addBounty(backer.id, request.id, MINIMUM_BOUNTY);
    const del = () =>
      deleteRequest({
        requestId: request.id,
        actorId: owner.id,
        canModerateRequests: false
      });

    const { ok, errors } = await settle(del(), del());

    expect(ok).toBe(1);
    expect(errors).toEqual([expect.objectContaining({ statusCode: 404 })]);
    expect((await balanceOf(owner.id)).consumed).toBe(0n);
    expect((await balanceOf(backer.id)).consumed).toBe(0n);
    expect(await ledger(request.id, 'REQUEST_REFUND')).toHaveLength(2);
  });

  it('a bounty racing a fill is either paid to the filler or never debited', async () => {
    const [owner, backer, filler] = [
      await createUser(),
      await createUser(),
      await createUser()
    ];
    const community = await createCommunity();
    const request = await openRequest(owner.id, community.id);
    const contribution = await createContribution(filler.id, community.id);

    const { ok } = await settle(
      addBounty(backer.id, request.id, MINIMUM_BOUNTY),
      fillRequest(filler.id, request.id, contribution.id)
    );

    expect(ok).toBeGreaterThanOrEqual(1);
    const backed = (await balanceOf(backer.id)).consumed;
    const fill = await testPrisma.requestFill.findFirstOrThrow({
      where: { requestId: request.id }
    });
    // Whatever was debited for bounties is exactly what the fill paid.
    expect(fill.awardedAmount).toBe(MINIMUM_BOUNTY + backed);
    expect((await balanceOf(filler.id)).contributed).toBe(
      START + fill.awardedAmount
    );
  });

  it('a bounty racing a delete is refunded or never debited', async () => {
    const [owner, backer] = [await createUser(), await createUser()];
    const community = await createCommunity();
    const request = await openRequest(owner.id, community.id);

    await settle(
      addBounty(backer.id, request.id, MINIMUM_BOUNTY),
      deleteRequest({
        requestId: request.id,
        actorId: owner.id,
        canModerateRequests: false
      })
    );

    expect((await balanceOf(backer.id)).consumed).toBe(0n);
    expect((await balanceOf(owner.id)).consumed).toBe(0n);
  });
});

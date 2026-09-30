import { randomUUID } from 'node:crypto';
import { CommunityType, RegistrationStatus } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { seedE2eRelease } from '../modules/e2eFixtures';
import { addReleaseWorkbenchTag } from '../modules/releaseWorkbench/tags';

/**
 * Adding a tag that a concurrent add just attached (#809), against real rows.
 * The workbench checks "already has this tag" before its transaction, so the
 * loser passes that check and meets the `(releaseId, tagId)` key instead. That
 * must answer the check's own 409 and roll back the occurrence count, not 500.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

/** A release whose contributor, and so community member, is the actor. */
const releaseWithActor = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  const user = await testPrisma.user.create({
    data: {
      username: `rt-${tag}`,
      email: `rt-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
  await testPrisma.community.create({
    data: {
      name: `Community-${tag}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const { communityId, releaseId } = await seedE2eRelease(testPrisma, user.id);
  return {
    actorId: user.id,
    communityId,
    releaseId,
    permissions: { communities_manage: true }
  };
};

describe('adding a tag a concurrent add just attached (#809)', () => {
  it('answers 409 and leaves the occurrence count alone', async () => {
    const ref = await releaseWithActor();
    // The winner's add: the tag counted once, and attached.
    const jazz = await testPrisma.tag.create({
      data: { name: 'jazz', occurrences: 1 }
    });
    await testPrisma.releaseTag.create({
      data: { releaseId: ref.releaseId, tagId: jazz.id, userId: ref.actorId }
    });
    // The loser read the release before that landed.
    const staleRead = { id: ref.releaseId, releaseTags: [] };
    jest
      .spyOn(prisma.release, 'findFirst')
      .mockImplementationOnce((() => Promise.resolve(staleRead)) as never);

    await expect(
      addReleaseWorkbenchTag(ref, { name: 'jazz' })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Release already has this tag'
    });

    const after = await testPrisma.tag.findUniqueOrThrow({
      where: { id: jazz.id }
    });
    expect(after.occurrences).toBe(1);
    expect(
      await testPrisma.releaseTag.count({ where: { releaseId: ref.releaseId } })
    ).toBe(1);
  });

  it('still adds a tag the release does not have', async () => {
    const ref = await releaseWithActor();

    await addReleaseWorkbenchTag(ref, { name: 'jazz' });

    const tags = await testPrisma.releaseTag.findMany({
      where: { releaseId: ref.releaseId },
      include: { tag: true }
    });
    expect(tags.map((t) => t.tag.name)).toEqual(['jazz']);
  });
});

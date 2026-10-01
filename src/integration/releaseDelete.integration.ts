import { randomUUID } from 'node:crypto';
import {
  CommunityType,
  FileType,
  Prisma,
  RegistrationStatus
} from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { addContributionToRelease } from '../modules/contribution';
import {
  createCommunityRelease,
  deleteCommunityRelease
} from '../modules/releaseLifecycle';

/**
 * Deleting a release (#793), against real rows. Only a release with no
 * contributions can go, and it takes the rows that would block it with a
 * Restrict (editions, credits, comments, bookmarks) with it. Every release
 * keeps an edition, so before #793 this answered 409 for every release.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

const makeUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  return testPrisma.user.create({
    data: {
      username: `rd-${tag}`,
      email: `rd-${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

/**
 * A release created as the api creates one, so with its default edition,
 * credit and history, plus one of each row that hangs off it.
 */
const ghostRelease = async () => {
  const user = await makeUser();
  const community = await testPrisma.community.create({
    data: {
      name: `Community-${randomUUID().slice(0, 8)}`,
      image: '',
      registrationStatus: RegistrationStatus.open,
      type: CommunityType.Music
    }
  });
  const artist = await testPrisma.artist.create({
    data: { name: `Artist-${randomUUID().slice(0, 8)}` }
  });
  const jazz = await testPrisma.tag.create({
    data: { name: `jazz-${randomUUID().slice(0, 8)}` }
  });
  const release = await createCommunityRelease({
    actorId: user.id,
    communityId: community.id,
    data: {
      credits: [{ artistId: artist.id }],
      title: 'Kind of Blue',
      description: 'Classic',
      type: 'Music',
      releaseType: 'Album',
      year: 1959,
      tagIds: [jazz.id]
    }
  });
  const group = await testPrisma.releaseGroup.create({
    data: { title: 'Kind of Blue', identityKey: `kob-${randomUUID()}` }
  });
  await testPrisma.release.update({
    where: { id: release.id },
    data: { releaseGroupId: group.id }
  });
  const comment = await testPrisma.comment.create({
    data: {
      page: 'release',
      releaseId: release.id,
      authorId: user.id,
      body: 'Nice'
    }
  });
  await testPrisma.bookmarkRelease.create({
    data: { userId: user.id, releaseId: release.id }
  });
  await testPrisma.releaseVote.create({
    data: { userId: user.id, releaseId: release.id, positive: true }
  });
  const collage = await testPrisma.collage.create({
    data: {
      name: `Collage-${randomUUID().slice(0, 8)}`,
      description: 'd',
      userId: user.id,
      numEntries: 1,
      entries: { create: { releaseId: release.id, userId: user.id } }
    }
  });
  return {
    actorId: user.id,
    communityId: community.id,
    releaseId: release.id,
    tagId: jazz.id,
    groupId: group.id,
    collageId: collage.id,
    commentId: comment.id
  };
};

/** A contribution on the release's default edition, as an upload writes it. */
const contributeTo = async (ref: { actorId: number; releaseId: number }) => {
  const edition = await testPrisma.edition.findFirstOrThrow({
    where: { releaseId: ref.releaseId }
  });
  const contributor = await testPrisma.contributor.upsert({
    where: { userId: ref.actorId },
    create: { userId: ref.actorId },
    update: {},
    select: { id: true }
  });
  return testPrisma.contribution.create({
    data: {
      userId: ref.actorId,
      releaseId: ref.releaseId,
      editionId: edition.id,
      contributorId: contributor.id,
      downloadUrl: 'https://files.test/a.torrent',
      type: FileType.flac
    }
  });
};

/**
 * Every row that hangs off the release, counted. The comment is counted by its
 * id: Comment → Release is optional, so SetNull, and a comment the delete
 * missed would survive with a null release rather than block it.
 */
const dependents = ({
  releaseId,
  commentId
}: {
  releaseId: number;
  commentId: number;
}) =>
  Promise.all([
    testPrisma.release.count({ where: { id: releaseId } }),
    testPrisma.edition.count({ where: { releaseId } }),
    testPrisma.releaseArtist.count({ where: { releaseId } }),
    testPrisma.comment.count({ where: { id: commentId } }),
    testPrisma.bookmarkRelease.count({ where: { releaseId } }),
    testPrisma.releaseVote.count({ where: { releaseId } }),
    testPrisma.releaseTag.count({ where: { releaseId } }),
    testPrisma.collageEntry.count({ where: { releaseId } }),
    testPrisma.releaseHistory.count({ where: { releaseId } })
  ]);

/**
 * Run the next `prisma.$transaction` with `before` called just ahead of the
 * first `<model>.<method>` its callback makes, from outside the transaction.
 */
const interruptNextTransaction = (
  model: 'edition' | 'contribution',
  method: 'deleteMany' | 'create',
  before: () => Promise<unknown>
) => {
  const original = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementationOnce(((
    cb: (tx: Prisma.TransactionClient) => Promise<unknown>
  ) =>
    original((tx) => {
      let fired = false;
      const delegate = tx[model] as unknown as Record<string, unknown>;
      const wrapped = new Proxy(delegate, {
        get(target, prop) {
          const value = Reflect.get(target, prop) as unknown;
          if (prop !== method || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (...args: unknown[]) => {
            if (!fired) {
              fired = true;
              await before();
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
      });
      const client = new Proxy(tx, {
        get: (target, prop) =>
          prop === model ? wrapped : Reflect.get(target, prop)
      });
      return cb(client);
    })) as never);
};

describe('deleting a release (#793)', () => {
  it('deletes a release with no contributions, and every row off it', async () => {
    const ref = await ghostRelease();
    expect(await dependents(ref)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);

    await deleteCommunityRelease(ref);

    expect(await dependents(ref)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const [tag, collage] = await Promise.all([
      testPrisma.tag.findUniqueOrThrow({ where: { id: ref.tagId } }),
      testPrisma.collage.findUniqueOrThrow({ where: { id: ref.collageId } })
    ]);
    expect(tag.occurrences).toBe(0);
    expect(collage.numEntries).toBe(0);
  });

  it('leaves an audit row and a line on the group, which stays', async () => {
    const ref = await ghostRelease();

    await deleteCommunityRelease(ref);

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'release.delete', targetId: ref.releaseId }
    });
    expect(audit).toMatchObject({
      actorId: ref.actorId,
      targetType: 'Release',
      metadata: {
        communityId: ref.communityId,
        title: 'Kind of Blue',
        releaseGroupId: ref.groupId
      }
    });
    const logs = await testPrisma.groupLog.findMany({
      where: { releaseGroupId: ref.groupId }
    });
    expect(logs.map((l) => l.info)).toEqual([
      `Deleted release "Kind of Blue" (#${ref.releaseId}).`
    ]);
  });

  it('answers 404 for a release in another community', async () => {
    const ref = await ghostRelease();

    await expect(
      deleteCommunityRelease({ ...ref, communityId: ref.communityId + 1 })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Release not found' });
    expect(await dependents(ref)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('refuses a release with a contribution, and changes nothing', async () => {
    const ref = await ghostRelease();
    await contributeTo(ref);

    await expect(deleteCommunityRelease(ref)).rejects.toMatchObject({
      statusCode: 409,
      message: 'A release with contributions cannot be deleted'
    });
    expect(await dependents(ref)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const tag = await testPrisma.tag.findUniqueOrThrow({
      where: { id: ref.tagId }
    });
    expect(tag.occurrences).toBe(1);
  });

  it('answers 409 and rolls back when a contribution lands after the claim', async () => {
    const ref = await ghostRelease();
    interruptNextTransaction('edition', 'deleteMany', () => contributeTo(ref));

    await expect(deleteCommunityRelease(ref)).rejects.toMatchObject({
      statusCode: 409,
      message: 'A release with contributions cannot be deleted'
    });
    expect(await dependents(ref)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(
      await testPrisma.auditLog.count({ where: { action: 'release.delete' } })
    ).toBe(0);
  });
});

describe('uploading to a release deleted under it (#793)', () => {
  it('answers 404 when the release went after the edition was read', async () => {
    const ref = await ghostRelease();
    const uploader = await makeUser();
    interruptNextTransaction('contribution', 'create', () =>
      deleteCommunityRelease(ref)
    );

    await expect(
      addContributionToRelease({
        userId: uploader.id,
        communityId: ref.communityId,
        releaseId: ref.releaseId,
        input: {
          fileType: FileType.flac,
          downloadUrl: 'https://files.test/b.torrent',
          releaseDescription: 'd'
        } as never
      })
    ).rejects.toMatchObject({ statusCode: 404, message: 'Release not found' });
    expect(
      await testPrisma.release.count({ where: { id: ref.releaseId } })
    ).toBe(0);
  });
});

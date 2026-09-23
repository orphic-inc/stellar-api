import {
  CommentPage,
  CommunityType,
  FileType,
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
import {
  canSeeCommentThread,
  canSeeThreadOf,
  deleteComment
} from '../modules/comment';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createAuthor = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `commenter-${Date.now()}-${Math.random()}`,
      email: `commenter-${Date.now()}-${Math.random()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('deleteComment', () => {
  const createComment = (authorId: number) =>
    testPrisma.comment.create({
      data: { page: CommentPage.communities, authorId, body: 'test comment' }
    });

  it('soft-deletes the comment (sets deletedAt)', async () => {
    const author = await createAuthor();
    const comment = await createComment(author.id);
    await deleteComment(comment.id, author.id, false);

    const dbComment = await testPrisma.comment.findUniqueOrThrow({
      where: { id: comment.id }
    });
    expect(dbComment.deletedAt).not.toBeNull();
  });

  it('writes a comment.delete audit log for owner deletion', async () => {
    const author = await createAuthor();
    const comment = await createComment(author.id);
    await deleteComment(comment.id, author.id, false);

    const log = await testPrisma.auditLog.findFirst({
      where: { targetType: 'Comment', targetId: comment.id }
    });
    expect(log).not.toBeNull();
    expect(log!.action).toBe('comment.delete');
    expect(log!.actorId).toBe(author.id);
  });

  it('writes a comment.mod_delete audit log for moderator deletion', async () => {
    const author = await createAuthor();
    const comment = await createComment(author.id);
    await deleteComment(comment.id, author.id, true);

    const log = await testPrisma.auditLog.findFirst({
      where: { targetType: 'Comment', targetId: comment.id }
    });
    expect(log!.action).toBe('comment.mod_delete');
  });

  // #703: the second of two deletes must not re-stamp `deletedAt` or write a
  // second audit row. It throws P2025, and the batch takes the audit row back.
  it('refuses to delete a comment twice', async () => {
    const author = await createAuthor();
    const comment = await createComment(author.id);
    await deleteComment(comment.id, author.id, false);
    const { deletedAt } = await testPrisma.comment.findUniqueOrThrow({
      where: { id: comment.id }
    });

    await expect(deleteComment(comment.id, author.id, true)).rejects.toThrow(
      expect.objectContaining({ code: 'P2025' })
    );

    const dbComment = await testPrisma.comment.findUniqueOrThrow({
      where: { id: comment.id }
    });
    expect(dbComment.deletedAt).toEqual(deletedAt);
    expect(
      await testPrisma.auditLog.count({
        where: { targetType: 'Comment', targetId: comment.id }
      })
    ).toBe(1);
  });

  it('executes the soft-delete and audit log in a single transaction', async () => {
    const author = await createAuthor();
    const comment = await createComment(author.id);
    const countBefore = await testPrisma.auditLog.count();

    await deleteComment(comment.id, author.id, false);

    const dbComment = await testPrisma.comment.findUniqueOrThrow({
      where: { id: comment.id }
    });
    const countAfter = await testPrisma.auditLog.count();

    expect(dbComment.deletedAt).not.toBeNull();
    expect(countAfter).toBe(countBefore + 1);
  });
});

describe('canSeeCommentThread (#697)', () => {
  const createCommunity = (registrationStatus: RegistrationStatus) =>
    testPrisma.community.create({
      data: {
        name: uniqueName('Thread-Community'),
        image: '',
        registrationStatus,
        type: CommunityType.Music
      }
    });

  const createRelease = (communityId: number) =>
    testPrisma.release.create({
      data: {
        communityId,
        title: uniqueName('Release'),
        description: 'd',
        type: ReleaseType.Music,
        releaseType: ReleaseCategory.Album,
        year: 2020
      }
    });

  const joinAsConsumer = (userId: number, communityId: number) =>
    testPrisma.consumer.create({
      data: { userId, communities: { connect: { id: communityId } } }
    });

  it('opens a release thread in a closed community to its members only', async () => {
    const member = await createAuthor();
    const outsider = await createAuthor();
    const closed = await createCommunity(RegistrationStatus.closed);
    await joinAsConsumer(member.id, closed.id);
    const release = await createRelease(closed.id);

    await expect(
      canSeeCommentThread(CommentPage.release, release.id, member.id)
    ).resolves.toBe(true);
    await expect(
      canSeeCommentThread(CommentPage.release, release.id, outsider.id)
    ).resolves.toBe(false);
  });

  it('opens a release thread in an open community to anyone', async () => {
    const outsider = await createAuthor();
    const open = await createCommunity(RegistrationStatus.open);
    const release = await createRelease(open.id);

    await expect(
      canSeeCommentThread(CommentPage.release, release.id, outsider.id)
    ).resolves.toBe(true);
  });

  it('follows a contribution to its release', async () => {
    const member = await createAuthor();
    const outsider = await createAuthor();
    const closed = await createCommunity(RegistrationStatus.closed);
    await joinAsConsumer(member.id, closed.id);
    const release = await createRelease(closed.id);
    const home = await createCommunity(RegistrationStatus.open);
    const contributor = await testPrisma.contributor.create({
      data: { userId: outsider.id, communityId: home.id }
    });
    const edition = await testPrisma.edition.create({
      data: { releaseId: release.id }
    });
    const contribution = await testPrisma.contribution.create({
      data: {
        userId: outsider.id,
        releaseId: release.id,
        editionId: edition.id,
        contributorId: contributor.id,
        type: FileType.flac,
        downloadUrl: 'https://example.com/x.torrent'
      }
    });

    await expect(
      canSeeCommentThread(CommentPage.contributions, contribution.id, member.id)
    ).resolves.toBe(true);
    // The uploader holds no role in the closed community, and the fragment has
    // no owner arm (decided on #697), so their own contribution's thread is shut.
    await expect(
      canSeeCommentThread(
        CommentPage.contributions,
        contribution.id,
        outsider.id
      )
    ).resolves.toBe(false);
  });

  it('follows a request to its community', async () => {
    const member = await createAuthor();
    const outsider = await createAuthor();
    const closed = await createCommunity(RegistrationStatus.closed);
    await joinAsConsumer(member.id, closed.id);
    const request = await testPrisma.request.create({
      data: {
        communityId: closed.id,
        userId: member.id,
        title: 'wanted',
        description: 'd',
        type: ReleaseType.Music
      }
    });

    await expect(
      canSeeCommentThread(CommentPage.requests, request.id, member.id)
    ).resolves.toBe(true);
    await expect(
      canSeeCommentThread(CommentPage.requests, request.id, outsider.id)
    ).resolves.toBe(false);
  });

  it("opens a closed community's own thread to its members only", async () => {
    const member = await createAuthor();
    const outsider = await createAuthor();
    const closed = await createCommunity(RegistrationStatus.closed);
    await joinAsConsumer(member.id, closed.id);

    await expect(
      canSeeCommentThread(CommentPage.communities, closed.id, member.id)
    ).resolves.toBe(true);
    await expect(
      canSeeCommentThread(CommentPage.communities, closed.id, outsider.id)
    ).resolves.toBe(false);
  });

  it('opens artist and collage threads to anyone, when the page exists', async () => {
    const viewer = await createAuthor();
    const artist = await testPrisma.artist.create({
      data: { name: uniqueName('Artist') }
    });
    const collage = await testPrisma.collage.create({
      data: {
        name: uniqueName('Collage'),
        description: 'd',
        userId: viewer.id
      }
    });

    await expect(
      canSeeCommentThread(CommentPage.artist, artist.id, viewer.id)
    ).resolves.toBe(true);
    await expect(
      canSeeCommentThread(CommentPage.collages, collage.id, viewer.id)
    ).resolves.toBe(true);
  });

  it('shuts the thread of a page that does not exist, on every page', async () => {
    const viewer = await createAuthor();
    const missing = 2_000_000_000;

    for (const page of Object.values(CommentPage)) {
      await expect(canSeeCommentThread(page, missing, viewer.id)).resolves.toBe(
        false
      );
    }
  });
});

// #701: a thread on a soft-deleted page is the same `false` as a missing page's,
// for everyone. Nobody can see or restore a deleted artist or request, and a
// deleted collage's staff view does not extend to its thread.
describe('canSeeCommentThread on a soft-deleted page (#701)', () => {
  it('shuts the thread of a deleted artist', async () => {
    const viewer = await createAuthor();
    const artist = await testPrisma.artist.create({
      data: { name: uniqueName('Artist') }
    });
    await expect(
      canSeeCommentThread(CommentPage.artist, artist.id, viewer.id)
    ).resolves.toBe(true);

    await testPrisma.artist.update({
      where: { id: artist.id },
      data: { deletedAt: new Date() }
    });

    await expect(
      canSeeCommentThread(CommentPage.artist, artist.id, viewer.id)
    ).resolves.toBe(false);
  });

  it('shuts the thread of a deleted request', async () => {
    const viewer = await createAuthor();
    const open = await testPrisma.community.create({
      data: {
        name: uniqueName('Deleted-Request-Community'),
        image: '',
        registrationStatus: RegistrationStatus.open,
        type: CommunityType.Music
      }
    });
    const request = await testPrisma.request.create({
      data: {
        communityId: open.id,
        userId: viewer.id,
        title: 'wanted',
        description: 'd',
        type: ReleaseType.Music
      }
    });
    await expect(
      canSeeCommentThread(CommentPage.requests, request.id, viewer.id)
    ).resolves.toBe(true);

    await testPrisma.request.update({
      where: { id: request.id },
      data: { deletedAt: new Date() }
    });

    await expect(
      canSeeCommentThread(CommentPage.requests, request.id, viewer.id)
    ).resolves.toBe(false);
  });

  it('shuts the thread of a deleted public collage, and restoring it reopens the thread', async () => {
    // Staff can still view and restore the collage itself; the thread follows
    // the page's lifecycle, not that staff exception, so the gate stays free
    // of permission checks. The owner here is the collage's creator.
    const owner = await createAuthor();
    const collage = await testPrisma.collage.create({
      data: {
        name: uniqueName('Collage'),
        description: 'd',
        userId: owner.id,
        categoryId: 1
      }
    });
    const setDeleted = (isDeleted: boolean) =>
      testPrisma.collage.update({
        where: { id: collage.id },
        data: { isDeleted, deletedAt: isDeleted ? new Date() : null }
      });

    await setDeleted(true);
    await expect(
      canSeeCommentThread(CommentPage.collages, collage.id, owner.id)
    ).resolves.toBe(false);

    await setDeleted(false);
    await expect(
      canSeeCommentThread(CommentPage.collages, collage.id, owner.id)
    ).resolves.toBe(true);
  });
});

describe('canSeeThreadOf (#697)', () => {
  it('reads the thread off a stored comment', async () => {
    const member = await createAuthor();
    const outsider = await createAuthor();
    const closed = await testPrisma.community.create({
      data: {
        name: uniqueName('Thread-Of'),
        image: '',
        registrationStatus: RegistrationStatus.closed,
        type: CommunityType.Music
      }
    });
    await testPrisma.consumer.create({
      data: { userId: member.id, communities: { connect: { id: closed.id } } }
    });
    const comment = await testPrisma.comment.create({
      data: {
        page: CommentPage.communities,
        communityId: closed.id,
        authorId: member.id,
        body: 'inside'
      }
    });

    await expect(canSeeThreadOf(comment, member.id)).resolves.toBe(true);
    await expect(canSeeThreadOf(comment, outsider.id)).resolves.toBe(false);
  });

  it('shuts a comment whose page id is missing', async () => {
    const author = await createAuthor();
    const orphan = await testPrisma.comment.create({
      data: { page: CommentPage.communities, authorId: author.id, body: 'x' }
    });

    await expect(canSeeThreadOf(orphan, author.id)).resolves.toBe(false);
  });
});

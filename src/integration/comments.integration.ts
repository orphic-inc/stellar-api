import { CommentPage } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { deleteComment } from '../modules/comment';

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

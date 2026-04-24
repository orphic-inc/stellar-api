import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { createTopic, createPost, deletePost } from '../modules/forum';

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
      username: `forumuser-${Date.now()}-${Math.random()}`,
      email: `forum-${Date.now()}-${Math.random()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createForum = async () => {
  const category = await testPrisma.forumCategory.create({
    data: { name: 'General', sort: 0 }
  });
  return testPrisma.forum.create({
    data: {
      forumCategoryId: category.id,
      sort: 0,
      name: 'Test Forum',
      isTrash: false
    }
  });
};

describe('createTopic', () => {
  it('creates a topic and its first post atomically', async () => {
    const author = await createAuthor();
    const forum = await createForum();
    const topic = await createTopic(forum.id, author.id, {
      title: 'Hello World',
      body: '<p>First post</p>'
    });

    expect(topic.id).toBeGreaterThan(0);
    expect(topic.title).toBe('Hello World');

    const dbTopic = await testPrisma.forumTopic.findUniqueOrThrow({
      where: { id: topic.id }
    });
    expect(dbTopic.numPosts).toBe(1);
    expect(dbTopic.lastPostId).not.toBeNull();

    const dbForum = await testPrisma.forum.findUniqueOrThrow({
      where: { id: forum.id }
    });
    expect(dbForum.numTopics).toBe(1);
    expect(dbForum.numPosts).toBe(1);
  });
});

describe('createPost + deletePost', () => {
  it('increments and decrements counters correctly', async () => {
    const author = await createAuthor();
    const forum = await createForum();
    const topic = await createTopic(forum.id, author.id, {
      title: 'Counter test',
      body: '<p>opener</p>'
    });

    const forumBefore = await testPrisma.forum.findUniqueOrThrow({
      where: { id: forum.id }
    });
    const topicBefore = await testPrisma.forumTopic.findUniqueOrThrow({
      where: { id: topic.id }
    });

    const reply = await createPost(
      forum.id,
      topic.id,
      author.id,
      '<p>reply</p>'
    );

    const topicAfterCreate = await testPrisma.forumTopic.findUniqueOrThrow({
      where: { id: topic.id }
    });
    expect(topicAfterCreate.numPosts).toBe(topicBefore.numPosts + 1);

    const forumAfterCreate = await testPrisma.forum.findUniqueOrThrow({
      where: { id: forum.id }
    });
    expect(forumAfterCreate.numPosts).toBe(forumBefore.numPosts + 1);

    await deletePost(reply.id, topic.id, forum.id, author.id, false);

    const topicAfterDelete = await testPrisma.forumTopic.findUniqueOrThrow({
      where: { id: topic.id }
    });
    expect(topicAfterDelete.numPosts).toBe(topicBefore.numPosts);

    const forumAfterDelete = await testPrisma.forum.findUniqueOrThrow({
      where: { id: forum.id }
    });
    expect(forumAfterDelete.numPosts).toBe(forumBefore.numPosts);
  });

  it('soft-deletes the post and writes an audit log entry', async () => {
    const author = await createAuthor();
    const forum = await createForum();
    const topic = await createTopic(forum.id, author.id, {
      title: 'Soft delete test',
      body: '<p>opener</p>'
    });
    const post = await createPost(
      forum.id,
      topic.id,
      author.id,
      '<p>to delete</p>'
    );

    await deletePost(post.id, topic.id, forum.id, author.id, true);

    const dbPost = await testPrisma.forumPost.findUniqueOrThrow({
      where: { id: post.id }
    });
    expect(dbPost.deletedAt).not.toBeNull();

    const auditEntry = await testPrisma.auditLog.findFirst({
      where: { targetType: 'ForumPost', targetId: post.id }
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry!.action).toBe('post.mod_delete');
  });
});

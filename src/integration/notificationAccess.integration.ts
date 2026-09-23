/**
 * Integration coverage for emit-time notification access (#695).
 *
 * The rule: a notification is written only for a recipient who can see its
 * target when it is sent. The claims are about the database, because the rules
 * are the canonical where-fragments — `releaseVisibleTo`,
 * `communityReadableWhere`, `forumReadableWhere` — so each page type is driven
 * through `emitNotifications` against real rows.
 */
import {
  CommunityType,
  RegistrationStatus,
  ReleaseType,
  FileType,
  SubscriptionPage
} from '@prisma/client';
import {
  truncateAll,
  seedDefaults,
  testPrisma,
  uniqueName
} from '../test/dbHelpers';
import { emitNotifications } from '../lib/notifications';
import { createPost, createTopic } from '../modules/forum';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (level?: number) => {
  const rank =
    level === undefined
      ? await testPrisma.userRank.findFirstOrThrow({
          orderBy: { level: 'asc' }
        })
      : await testPrisma.userRank.upsert({
          where: { level },
          create: { level, name: uniqueName('rank'), permissions: {} },
          update: {}
        });
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const name = uniqueName('na');
  return testPrisma.user.create({
    data: {
      username: name,
      email: `${name}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

const createCommunity = (registrationStatus: RegistrationStatus) =>
  testPrisma.community.create({
    data: {
      name: uniqueName('NA-Community'),
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
      releaseType: 'Album',
      year: 2020
    }
  });

const join = (userId: number, communityId: number) =>
  testPrisma.contributor.create({
    data: { userId, communities: { connect: { id: communityId } } }
  });

const emit = (page: SubscriptionPage, pageId: number, userIds: number[]) =>
  testPrisma.$transaction((tx) =>
    emitNotifications(tx, {
      userIds,
      type: 'artist_release',
      page,
      pageId
    })
  );

const recipients = async () =>
  (
    await testPrisma.notification.findMany({
      select: { userId: true },
      orderBy: [{ userId: 'asc' }]
    })
  ).map((n) => n.userId);

describe('a release in a private community', () => {
  it('reaches its members and no one else', async () => {
    const member = await createUser();
    const stranger = await createUser();
    const closed = await createCommunity(RegistrationStatus.closed);
    await join(member.id, closed.id);
    const release = await createRelease(closed.id);

    await emit('release', release.id, [member.id, stranger.id]);

    expect(await recipients()).toEqual([member.id]);
  });

  it('is checked through the contribution’s release on the contributions page', async () => {
    const member = await createUser();
    const stranger = await createUser();
    const closed = await createCommunity(RegistrationStatus.closed);
    await join(member.id, closed.id);
    const release = await createRelease(closed.id);
    const edition = await testPrisma.edition.create({
      data: { releaseId: release.id }
    });
    const contributor = await testPrisma.contributor.findFirstOrThrow({
      where: { userId: member.id }
    });
    const contribution = await testPrisma.contribution.create({
      data: {
        userId: member.id,
        releaseId: release.id,
        editionId: edition.id,
        contributorId: contributor.id,
        type: FileType.flac,
        downloadUrl: 'https://example.com/x.torrent'
      }
    });

    await emit('contributions', contribution.id, [member.id, stranger.id]);

    expect(await recipients()).toEqual([member.id]);
  });
});

describe('a release in an open community', () => {
  it('reaches everyone', async () => {
    const a = await createUser();
    const b = await createUser();
    const open = await createCommunity(RegistrationStatus.open);
    const release = await createRelease(open.id);

    await emit('release', release.id, [a.id, b.id]);

    expect(await recipients()).toEqual([a.id, b.id]);
  });
});

describe('community-scoped pages', () => {
  it('a request follows its community', async () => {
    const member = await createUser();
    const stranger = await createUser();
    const closed = await createCommunity(RegistrationStatus.closed);
    await join(member.id, closed.id);
    const request = await testPrisma.request.create({
      data: {
        communityId: closed.id,
        userId: member.id,
        title: 'wanted',
        description: 'd',
        type: ReleaseType.Music
      }
    });

    await emit('requests', request.id, [member.id, stranger.id]);

    expect(await recipients()).toEqual([member.id]);
  });

  it('a community page follows the community', async () => {
    const member = await createUser();
    const stranger = await createUser();
    const closed = await createCommunity(RegistrationStatus.closed);
    await join(member.id, closed.id);

    await emit('communities', closed.id, [member.id, stranger.id]);

    expect(await recipients()).toEqual([member.id]);
  });
});

describe('forum topics', () => {
  const createForum = async (minClassRead: number) => {
    const category = await testPrisma.forumCategory.create({
      data: { name: uniqueName('cat'), sort: 0 }
    });
    return testPrisma.forum.create({
      data: {
        forumCategoryId: category.id,
        sort: 0,
        name: uniqueName('forum'),
        isTrash: false,
        minClassRead
      }
    });
  };

  it('reach only those whose rank can read the forum', async () => {
    const staff = await createUser(900);
    const member = await createUser(100);
    const forum = await createForum(800);
    const topic = await createTopic(forum.id, staff.id, {
      title: 'Staff only',
      body: 'first'
    });
    await testPrisma.notification.deleteMany();

    await emit('forums', topic.id, [staff.id, member.id]);

    expect(await recipients()).toEqual([staff.id]);
  });

  it('honour a rank’s permitted forums below its level', async () => {
    const author = await createUser(900);
    const forum = await createForum(800);
    const permitted = await testPrisma.userRank.create({
      data: {
        level: 101,
        name: uniqueName('permitted'),
        permissions: {},
        permittedForumIds: [forum.id]
      }
    });
    const reader = await createUser(100);
    await testPrisma.user.update({
      where: { id: reader.id },
      data: { userRankId: permitted.id }
    });
    const topic = await createTopic(forum.id, author.id, {
      title: 'Permitted',
      body: 'first'
    });
    await testPrisma.notification.deleteMany();

    await emit('forums', topic.id, [reader.id]);

    expect(await recipients()).toEqual([reader.id]);
  });

  // Each reply below comes from someone other than the topic's author:
  // `createPost` merges an author's consecutive posts and sends nothing, so a
  // same-author reply would pass these tests whether or not access is checked.

  it('a quote reaches a reader of the forum and not a member below its class', async () => {
    const staff = await createUser(900);
    const colleague = await createUser(900);
    const member = await createUser(100);
    const forum = await createForum(800);
    const topic = await createTopic(forum.id, staff.id, {
      title: 'Staff only',
      body: 'first'
    });

    await createPost(
      forum.id,
      topic.id,
      colleague.id,
      `[quote=${member.username}]hi[/quote] [quote=${staff.username}]yo[/quote]`
    );

    expect(
      await testPrisma.notification.findMany({
        where: { type: 'forum_quote' },
        select: { userId: true }
      })
    ).toEqual([{ userId: staff.id }]);
  });

  it('a subscriber who cannot read the forum gets no forum_sub', async () => {
    const staff = await createUser(900);
    const reader = await createUser(900);
    const member = await createUser(100);
    const forum = await createForum(800);
    const topic = await createTopic(forum.id, staff.id, {
      title: 'Staff only',
      body: 'first'
    });
    await testPrisma.subscription.createMany({
      data: [
        { userId: reader.id, topicId: topic.id },
        { userId: member.id, topicId: topic.id }
      ]
    });

    const replier = await createUser(900);
    await createPost(forum.id, topic.id, replier.id, 'reply');

    expect(
      await testPrisma.notification.findMany({
        where: { type: 'forum_sub' },
        select: { userId: true }
      })
    ).toEqual([{ userId: reader.id }]);
  });
});

describe('global pages and recipient hygiene', () => {
  it('an artist page reaches everyone', async () => {
    const a = await createUser();
    const b = await createUser();
    const artist = await testPrisma.artist.create({
      data: { name: uniqueName('artist') }
    });

    await emit('artist', artist.id, [a.id, b.id]);

    expect(await recipients()).toEqual([a.id, b.id]);
  });

  it('a recipient named twice gets one notification', async () => {
    const a = await createUser();
    const artist = await testPrisma.artist.create({
      data: { name: uniqueName('artist') }
    });

    await emit('artist', artist.id, [a.id, a.id]);

    expect(await recipients()).toEqual([a.id]);
  });

  it('a target that does not exist reaches no one', async () => {
    const a = await createUser();

    await emit('release', 999_999, [a.id]);

    expect(await recipients()).toEqual([]);
  });
});

import { CommunityType, RegistrationStatus, ReleaseType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { fileReport, listMyReports, listReports } from '../modules/reports';

/**
 * A reporter's own links resolve as the reporter (#773, #771), against real
 * rows: the visibility fragments and the forum rank rule are only proved by a
 * real database. An outsider's report on a hidden target links nowhere; the
 * member's and the staff queue's do.
 */
beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async () => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  const tag = randomUUID().slice(0, 8);
  const user = await testPrisma.user.create({
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
  return {
    ...user,
    userRankLevel: rank.level,
    permittedForumIds: [] as number[]
  };
};

const report = (
  reporterId: number,
  targetType: 'Release' | 'ForumTopic',
  targetId: number
) =>
  fileReport(reporterId, {
    targetType,
    targetId,
    category: 'other',
    reason: 'test'
  });

const linkIn = async (viewer: Awaited<ReturnType<typeof createUser>>) =>
  (await listMyReports(viewer, 1)).reports.map((r) => r.sourceUrl);

describe('report source urls resolve as the reporter (#773)', () => {
  it('hides a release in a closed community from an outsider only', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const community = await testPrisma.community.create({
      data: {
        name: `RS-${randomUUID().slice(0, 8)}`,
        image: '',
        registrationStatus: RegistrationStatus.closed,
        type: CommunityType.Music,
        consumers: { create: { userId: member.id } }
      }
    });
    const release = await testPrisma.release.create({
      data: {
        title: 'secret',
        description: 'd',
        type: ReleaseType.Music,
        releaseType: 'Album',
        year: 2020,
        communityId: community.id
      }
    });
    const path = `/communities/${community.id}/releases/${release.id}`;

    await report(outsider.id, 'Release', release.id);
    await report(member.id, 'Release', release.id);

    expect(await linkIn(outsider)).toEqual([null]);
    expect(await linkIn(member)).toEqual([path]);
    const queue = await listReports({
      page: 1,
      status: 'all',
      targetType: 'all',
      claimedByMe: false,
      staffUserId: member.id
    });
    expect(queue.reports.map((r) => r.sourceUrl)).toEqual([path, path]);
  });

  it('hides a topic in a forum above the reporter rank', async () => {
    const reporter = await createUser();
    const category = await testPrisma.forumCategory.create({
      data: { name: 'General', sort: 0 }
    });
    const forum = await testPrisma.forum.create({
      data: {
        forumCategoryId: category.id,
        sort: 0,
        name: `RS-${randomUUID().slice(0, 8)}`,
        isTrash: false,
        minClassRead: reporter.userRankLevel + 1
      }
    });
    const topic = await testPrisma.forumTopic.create({
      data: { title: 'staff-only', forumId: forum.id, authorId: reporter.id }
    });

    await report(reporter.id, 'ForumTopic', topic.id);

    expect(await linkIn(reporter)).toEqual([null]);
    expect(
      await linkIn({ ...reporter, permittedForumIds: [forum.id] })
    ).toEqual([`/forums/${forum.id}/topics/${topic.id}`]);
  });
});

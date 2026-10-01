/**
 * The profile carries no invite tree (#856).
 *
 * `PublicProfile.inviteTree` went to the owner and to staff, and every node
 * carried the invitee's contributed, consumed and ratio figures whatever the
 * invitee's privacy settings said. Nothing read it: stellar-ui's invite tree
 * reads `GET /users/{id}/invite-tree`, which applies those settings. So the
 * field is gone, and so is the second recursive subtree read behind it. The
 * one left feeds the community block's invite summary (`community.invites`).
 *
 * Against a real database, because `buildProfileView` fans out across a dozen
 * queries.
 */

import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';
import * as userModule from '../modules/user';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

const createUser = async (
  name: string,
  inviterId: number | null = null,
  settings: { showContributedStats?: boolean; showConsumedStats?: boolean } = {}
) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const userSettings = await testPrisma.userSettings.create({ data: settings });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: userSettings.id,
      profileId: profile.id,
      contributed: 5n * 1024n ** 3n,
      consumed: 1024n ** 3n,
      inviteTree: { create: { inviterId } }
    }
  });
};

/** A viewer holding `staff` on a secondary rank, so `isStaff` is true. */
const createStaffViewer = async () => {
  const viewer = await createUser('staff');
  const rank = await testPrisma.userRank.create({
    data: {
      level: 700 + seq++,
      name: tag('Rank'),
      permissions: { staff: true }
    }
  });
  await testPrisma.userSecondaryRank.create({
    data: { userId: viewer.id, userRankId: rank.id }
  });
  return viewer;
};

const view = { showMature: true };

describe('the profile carries no invite tree (#856)', () => {
  // An inviter whose invitee hides both byte stats: what the field leaked.
  const inviterWithPrivateInvitee = async () => {
    const inviter = await createUser('inviter');
    await createUser('invitee', inviter.id, {
      showContributedStats: false,
      showConsumedStats: false
    });
    return inviter;
  };

  it.each([
    ['the owner', async (inviterId: number) => inviterId],
    ['a staff viewer', async () => (await createStaffViewer()).id]
  ])('omits it for %s, reading the subtree once', async (_who, viewerOf) => {
    const inviter = await inviterWithPrivateInvitee();
    const viewerId = await viewerOf(inviter.id);
    const subtree = jest.spyOn(userModule, 'getInviteSubtreeRows');

    const profile = await getProfileById(inviter.id, viewerId, view);

    expect(profile).not.toBeNull();
    expect(profile).not.toHaveProperty('inviteTree');
    // Once, for `community.invites`; the tree's own read doubled it.
    expect(subtree).toHaveBeenCalledTimes(1);
  });
});

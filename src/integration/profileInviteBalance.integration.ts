/**
 * `inviteCount` and `canInvite` on another member's profile (#655).
 *
 * A rank holding only an invite permission reads both, since `invites_edit`
 * compares against the balance and `invites_manage` is the read side (#636).
 * It gains nothing else `isStaff` discloses.
 *
 * Against a real database, because `buildProfileView` fans out across a dozen
 * queries.
 */

import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now()}-${seq++}`;

const createRank = (permissions: Record<string, boolean>) =>
  testPrisma.userRank.create({
    data: { level: 700 + seq++, name: tag('Rank'), permissions }
  });

const createUser = async (
  name: string,
  permissions?: Record<string, boolean>
) => {
  const rank = permissions
    ? await createRank(permissions)
    : await testPrisma.userRank.findFirstOrThrow();
  // Every stat hidden, so only an isStaff viewer would see them.
  const userSettings = await testPrisma.userSettings.create({
    data: {
      showEmail: false,
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    }
  });
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
      inviteCount: 3,
      canInvite: false,
      inviteTree: { create: { inviterId: null } }
    }
  });
};

const view = { showMature: true };

describe('profile invite balance (#655)', () => {
  it.each([['invites_manage'], ['invites_edit']])(
    '%s alone reads the balance and nothing else isStaff discloses',
    async (permission) => {
      const member = await createUser('member');
      const viewer = await createUser('viewer', { [permission]: true });

      const profile = await getProfileById(member.id, viewer.id, view);

      expect(profile?.inviteCount).toBe(3);
      expect(profile?.canInvite).toBe(false);
      expect(profile?.email).toBeNull();
      expect(profile?.stats.contributed).toBeNull();
      expect(profile?.staffPmOverview).toBeNull();
    }
  );

  it('still shows staff the balance', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { users_edit: true });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.inviteCount).toBe(3);
    expect(profile?.canInvite).toBe(false);
  });

  it('hides the balance from a member with neither', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { forums_read: true });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.inviteCount).toBeNull();
    expect(profile?.canInvite).toBeNull();
  });

  it('still shows the owner their own balance', async () => {
    const member = await createUser('member');

    const profile = await getProfileById(member.id, member.id, view);

    expect(profile?.inviteCount).toBe(3);
    expect(profile?.canInvite).toBe(false);
  });
});

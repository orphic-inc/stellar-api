/**
 * "Invited by" on the member profile (#849, grilled on #638).
 *
 * Only a viewer holding `invites_manage` sees it, the owner included.
 * `invitedBy` is null for anyone else; an inner null inviter is "Nobody".
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
    data: { level: 100 + seq++, name: tag('Rank'), permissions }
  });

const createUser = async (
  name: string,
  opts: { inviterId?: number; userRankId?: number } = {}
) => {
  const rankId =
    opts.userRankId ?? (await testPrisma.userRank.findFirstOrThrow()).id;
  const userSettings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rankId,
      userSettingsId: userSettings.id,
      profileId: profile.id,
      inviteTree: { create: { inviterId: opts.inviterId ?? null } }
    }
  });
};

const view = { showMature: true };

describe('profile invitedBy (#849)', () => {
  it('shows the inviter to a viewer with invites_manage', async () => {
    const inviter = await createUser('inviter');
    const invitee = await createUser('invitee', { inviterId: inviter.id });
    const manager = await createUser('manager', {
      userRankId: (await createRank({ invites_manage: true })).id
    });

    const profile = await getProfileById(invitee.id, manager.id, view);

    expect(profile?.invitedBy).toEqual({
      inviter: { id: inviter.id, username: inviter.username }
    });
  });

  it('answers a null inviter for a member nobody invited', async () => {
    const member = await createUser('member');
    const manager = await createUser('manager', {
      userRankId: (await createRank({ invites_manage: true })).id
    });

    const profile = await getProfileById(member.id, manager.id, view);

    expect(profile?.invitedBy).toEqual({ inviter: null });
  });

  it('hides the inviter from staff without invites_manage', async () => {
    const inviter = await createUser('inviter');
    const invitee = await createUser('invitee', { inviterId: inviter.id });
    const moderator = await createUser('moderator', {
      userRankId: (await createRank({ staff: true, users_edit: true })).id
    });

    const profile = await getProfileById(invitee.id, moderator.id, view);

    expect(profile?.invitedBy).toBeNull();
  });

  it('hides the inviter from the owner and from an anonymous viewer', async () => {
    const inviter = await createUser('inviter');
    const invitee = await createUser('invitee', { inviterId: inviter.id });

    const own = await getProfileById(invitee.id, invitee.id, view);
    const anonymous = await getProfileById(invitee.id, undefined, view);

    expect(own?.invitedBy).toBeNull();
    expect(anonymous?.invitedBy).toBeNull();
  });

  it('shows an owner holding invites_manage their own inviter', async () => {
    const inviter = await createUser('inviter');
    const staffer = await createUser('staffer', {
      inviterId: inviter.id,
      userRankId: (await createRank({ invites_manage: true })).id
    });

    const profile = await getProfileById(staffer.id, staffer.id, view);

    expect(profile?.invitedBy).toEqual({
      inviter: { id: inviter.id, username: inviter.username }
    });
  });
});

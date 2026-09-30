/**
 * The profile's viewer check resolves every rank the viewer holds (#855).
 *
 * It read the primary rank alone, so a moderator whose powers came from a
 * secondary rank passed `requirePermission` on the user routes and was still
 * served the profile as an ordinary member.
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

const createUser = async (name: string, inviterId: number | null = null) => {
  const rank = await testPrisma.userRank.findFirstOrThrow();
  const userSettings = await testPrisma.userSettings.create({
    data: { showEmail: false }
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
      inviteTree: { create: { inviterId } }
    }
  });
};

/** A viewer whose primary rank grants nothing, holding `permissions` on a secondary rank. */
const createSecondaryViewer = async (permissions: Record<string, boolean>) => {
  const viewer = await createUser('viewer');
  const rank = await createRank(permissions);
  await testPrisma.userSecondaryRank.create({
    data: { userId: viewer.id, userRankId: rank.id }
  });
  return viewer;
};

const view = { showMature: true };

describe('profile viewer check across secondary ranks (#855)', () => {
  it('shows the inviter to invites_manage held on a secondary rank', async () => {
    const inviter = await createUser('inviter');
    const member = await createUser('member', inviter.id);
    const viewer = await createSecondaryViewer({ invites_manage: true });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.invitedBy).toEqual({
      inviter: { id: inviter.id, username: inviter.username }
    });
  });

  it('treats users_edit held on a secondary rank as staff', async () => {
    const member = await createUser('member');
    const viewer = await createSecondaryViewer({ users_edit: true });

    const profile = await getProfileById(member.id, viewer.id, view);

    // Hidden by the member's showEmail, so only a staff viewer sees it.
    expect(profile?.email).toBe(member.email);
  });

  it('leaves a viewer with no staff permission on any rank a member', async () => {
    const inviter = await createUser('inviter');
    const member = await createUser('member', inviter.id);
    const viewer = await createSecondaryViewer({ forums_read: true });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.email).toBeNull();
    expect(profile?.invitedBy).toBeNull();
  });
});

/**
 * Permission-loading integration tests.
 *
 * Tests that getUserRankAccess correctly reads UserRank.permissions from the
 * DB, merges secondary ranks, and that hasPermission evaluates the merged set.
 * This covers the DB-level half of the permission system; the HTTP enforcement
 * layer (requireAuth / requirePermission returning 401/403) is covered by the
 * unit test suite via the mocked harness.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getUserRankAccess } from '../lib/userRankAccess';
import { hasPermission } from '../lib/rankPermissions';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const createUser = async (
  tag: string,
  permissions: Record<string, boolean> = {}
) => {
  const rank = await testPrisma.userRank.create({
    data: {
      level: Math.floor(Math.random() * 800) + 101, // avoid collision with seedDefaults level 100
      name: `rank-${tag}-${Date.now()}`,
      permissions
    }
  });
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `perm-${tag}-${Date.now()}`,
      email: `perm-${tag}-${Date.now()}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id
    }
  });
};

describe('getUserRankAccess — primary rank permissions', () => {
  it('returns empty permissions for a user with no permission flags set', async () => {
    const user = await createUser('none', {});
    const access = await getUserRankAccess(user.id);
    expect(hasPermission(access?.permissions, 'reports_manage')).toBe(false);
    expect(hasPermission(access?.permissions, 'admin')).toBe(false);
  });

  it('returns the correct permission when the primary rank grants it', async () => {
    const user = await createUser('staff', { reports_manage: true });
    const access = await getUserRankAccess(user.id);
    expect(hasPermission(access?.permissions, 'reports_manage')).toBe(true);
  });

  it('admin permission grants access to all checks via hasPermission override', async () => {
    const user = await createUser('admin', { admin: true });
    const access = await getUserRankAccess(user.id);
    expect(hasPermission(access?.permissions, 'admin')).toBe(true);
    expect(hasPermission(access?.permissions, 'reports_manage')).toBe(true);
    expect(hasPermission(access?.permissions, 'forums_moderate')).toBe(true);
  });

  it('returns null for a non-existent user', async () => {
    const access = await getUserRankAccess(999_999);
    expect(access).toBeNull();
  });
});

describe('getUserRankAccess — secondary rank merging', () => {
  it('grants a permission from a secondary rank even when the primary has none', async () => {
    // Primary rank: no permissions
    const primaryRank = await testPrisma.userRank.create({
      data: { level: 150, name: `primary-${Date.now()}`, permissions: {} }
    });
    // Secondary rank: has reports_manage
    const secondaryRank = await testPrisma.userRank.create({
      data: {
        level: 200,
        name: `secondary-${Date.now()}`,
        permissions: { reports_manage: true }
      }
    });

    const settings = await testPrisma.userSettings.create({ data: {} });
    const profile = await testPrisma.profile.create({ data: {} });
    const user = await testPrisma.user.create({
      data: {
        username: `sec-user-${Date.now()}`,
        email: `sec-user-${Date.now()}@example.com`,
        password: 'x',
        avatar: '',
        userRankId: primaryRank.id,
        userSettingsId: settings.id,
        profileId: profile.id
      }
    });
    await testPrisma.userSecondaryRank.create({
      data: { userId: user.id, userRankId: secondaryRank.id }
    });

    const access = await getUserRankAccess(user.id);
    expect(hasPermission(access?.permissions, 'reports_manage')).toBe(true);
  });

  it('merges permissions from both primary and secondary ranks', async () => {
    const primaryRank = await testPrisma.userRank.create({
      data: {
        level: 151,
        name: `p2-${Date.now()}`,
        permissions: { forums_moderate: true }
      }
    });
    const secondaryRank = await testPrisma.userRank.create({
      data: {
        level: 201,
        name: `s2-${Date.now()}`,
        permissions: { reports_manage: true }
      }
    });

    const settings = await testPrisma.userSettings.create({ data: {} });
    const profile = await testPrisma.profile.create({ data: {} });
    const user = await testPrisma.user.create({
      data: {
        username: `merge-${Date.now()}`,
        email: `merge-${Date.now()}@example.com`,
        password: 'x',
        avatar: '',
        userRankId: primaryRank.id,
        userSettingsId: settings.id,
        profileId: profile.id
      }
    });
    await testPrisma.userSecondaryRank.create({
      data: { userId: user.id, userRankId: secondaryRank.id }
    });

    const access = await getUserRankAccess(user.id);
    expect(hasPermission(access?.permissions, 'forums_moderate')).toBe(true);
    expect(hasPermission(access?.permissions, 'reports_manage')).toBe(true);
  });
});

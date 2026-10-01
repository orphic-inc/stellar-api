/**
 * Ratio policy on another member's profile (#658, ADR-0052).
 *
 * Privacy is a privilege: an active watch shows to every viewer, even with
 * every stat hidden. The status, `DOWNLOAD_DISABLED` included, is for
 * `ratio_policy_manage` alone.
 */

import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { getProfileById } from '../modules/profile';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const GiB = BigInt(1024 ** 3);
const DAY_MS = 24 * 60 * 60 * 1000;

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
  // Every stat hidden: the watch shows through them.
  const userSettings = await testPrisma.userSettings.create({
    data: {
      showContributedStats: false,
      showConsumedStats: false,
      showRatioStats: false
    }
  });
  const profile = await testPrisma.profile.create({ data: {} });
  // 200 GiB consumed, no coverage: 0.6 required, so 20 GiB short.
  return testPrisma.user.create({
    data: {
      username: tag(name),
      email: `${tag(name)}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: userSettings.id,
      profileId: profile.id,
      contributed: 100n * GiB,
      consumed: 200n * GiB
    }
  });
};

const putOnWatch = (userId: number, expiresInMs = 7 * DAY_MS) =>
  testPrisma.ratioPolicyState.create({
    data: {
      userId,
      status: RatioPolicyStatus.WATCH,
      watchStartedAt: new Date(),
      watchExpiresAt: new Date(Date.now() + expiresInMs),
      consumedAtWatchStart: 190n * GiB
    }
  });

const view = { showMature: true };

describe('ratio watch on the profile (#658)', () => {
  it('shows an active watch to any member, through hidden stats', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { forums_read: true });
    await putOnWatch(member.id);

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.stats.ratio).toBeNull();
    expect(profile?.ratioWatch).toEqual({
      expiresAt: expect.any(String),
      deficit: (20n * GiB).toString(),
      consumedSinceWatch: (10n * GiB).toString()
    });
    expect(profile?.ratioPolicy).toBeNull();
  });

  it('hides an expired watch', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { forums_read: true });
    await putOnWatch(member.id, -DAY_MS);

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.ratioWatch).toBeNull();
  });

  it('hides a download disable from a member', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { forums_read: true });
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        downloadDisabledAt: new Date(),
        disabledCause: RatioDisableCause.RATIO
      }
    });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.ratioWatch).toBeNull();
    expect(profile?.ratioPolicy).toBeNull();
  });

  it('shows ratio_policy_manage a download disable and its cause', async () => {
    const member = await createUser('member');
    const viewer = await createUser('viewer', { ratio_policy_manage: true });
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: RatioPolicyStatus.DOWNLOAD_DISABLED,
        downloadDisabledAt: new Date(),
        disabledCause: RatioDisableCause.STAFF
      }
    });

    const profile = await getProfileById(member.id, viewer.id, view);

    expect(profile?.ratioPolicy).toEqual({
      status: RatioPolicyStatus.DOWNLOAD_DISABLED,
      disabledCause: RatioDisableCause.STAFF
    });
    // The permission reveals the status and no more.
    expect(profile?.stats.ratio).toBeNull();
  });

  it('gives the owner the watch but not the status', async () => {
    const member = await createUser('member');
    await putOnWatch(member.id);

    const profile = await getProfileById(member.id, member.id, view);

    expect(profile?.ratioWatch).not.toBeNull();
    expect(profile?.ratioPolicy).toBeNull();
  });
});

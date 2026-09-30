/**
 * The inactivity sweep against a real database (#825). The unit spec pins the
 * wiring; this pins the claim itself: the SQL each write sends must still find
 * the member only while they are exactly as the sweep read them.
 *
 * The race is made deterministic with a stale read: the member's current state
 * is written through testPrisma, and loadBatch is handed the row as it was
 * before, the way a batch read minutes earlier would hold it.
 */
import { truncateAll, testPrisma } from '../test/dbHelpers';
import { prisma } from '../lib/prisma';
import { seedRanks } from '../modules/bootstrap';
import { inactivity as inactivityConfig } from '../modules/config';
import { runInactivityCycle } from '../modules/inactivityJob';
import { DAY_MS } from '../modules/inactivity';

// The notices are not what is under test, and the PM needs a System user.
jest.mock('../modules/pm', () => ({
  sendSystemMessage: () => Promise.resolve({ ok: true })
}));
jest.mock('../lib/mailer', () => ({
  sendInactivityWarningEmail: () => Promise.resolve(true),
  sendInactivityDisabledEmail: () => Promise.resolve(true)
}));

const mutableConfig = inactivityConfig as { mode: 'off' | 'dryRun' | 'on' };
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);

beforeEach(async () => {
  await truncateAll();
  await seedRanks(testPrisma);
  mutableConfig.mode = 'on';
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  mutableConfig.mode = 'off';
  await testPrisma.$disconnect();
});

let userSeq = 0;
const createUserAt = async (
  level: number,
  data: { lastLogin?: Date; inactivityWarnedAt?: Date | null } = {}
) => {
  userSeq += 1;
  const tag = `inact-${userSeq}-${Date.now()}`;
  const [rank, settings, profile] = await Promise.all([
    testPrisma.userRank.findFirstOrThrow({ where: { level } }),
    testPrisma.userSettings.create({ data: {} }),
    testPrisma.profile.create({ data: {} })
  ]);
  return testPrisma.user.create({
    data: {
      username: tag,
      email: `${tag}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      dateRegistered: daysAgo(800),
      ...data
    }
  });
};

type Member = Awaited<ReturnType<typeof createUserAt>>;

/** Hand loadBatch this member as the sweep would have read them. */
const readAs = (member: Member, fields: Partial<Member>) => {
  const row = {
    id: member.id,
    email: member.email,
    lastLogin: member.lastLogin,
    dateRegistered: member.dateRegistered,
    reactivatedAt: member.reactivatedAt,
    inactivityWarnedAt: member.inactivityWarnedAt,
    disabled: false,
    isDonor: false,
    rankLocked: false,
    userRank: { level: 100 },
    ...fields
  };
  jest
    .spyOn(prisma.user, 'findMany')
    .mockImplementationOnce((() => Promise.resolve([row])) as never);
};

const reload = (id: number) =>
  testPrisma.user.findUniqueOrThrow({ where: { id } });

describe('runInactivityCycle — the disable claim', () => {
  const dormant = { lastLogin: daysAgo(200), inactivityWarnedAt: daysAgo(30) };

  it('disables a dormant member and revokes their sessions', async () => {
    await createUserAt(1000);
    const member = await createUserAt(100, dormant);
    await testPrisma.userSession.create({
      data: { userId: member.id, ipAddress: '127.0.0.1' }
    });

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ disabled: 1, stale: 0, failed: 0 });
    expect((await reload(member.id)).disabled).toBe(true);
    expect(
      await testPrisma.userSession.count({
        where: { userId: member.id, revokedAt: null }
      })
    ).toBe(0);
  });

  it('leaves a member who signed in after the read, session and all', async () => {
    await createUserAt(1000);
    // Signing in stamps lastLogin and clears the warning (loginUser).
    const member = await createUserAt(100, {
      lastLogin: new Date(),
      inactivityWarnedAt: null
    });
    await testPrisma.userSession.create({
      data: { userId: member.id, ipAddress: '127.0.0.1' }
    });
    readAs(member, dormant);

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ disabled: 0, stale: 1, failed: 0 });
    expect((await reload(member.id)).disabled).toBe(false);
    expect(
      await testPrisma.userSession.count({
        where: { userId: member.id, revokedAt: null }
      })
    ).toBe(1);
    expect(
      await testPrisma.auditLog.count({ where: { action: 'user.disabled' } })
    ).toBe(0);
  });

  it.each([
    ['made a donor', { isDonor: true }],
    ['rank-locked', { rankLocked: true }],
    ['disabled by staff', { disabled: true }]
  ])('leaves a member %s after the read', async (_label, change) => {
    await createUserAt(1000);
    const member = await createUserAt(100, dormant);
    await testPrisma.user.update({ where: { id: member.id }, data: change });
    readAs(member, {});

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ disabled: 0, stale: 1 });
    expect(
      await testPrisma.auditLog.count({ where: { action: 'user.disabled' } })
    ).toBe(0);
  });

  it('leaves a member promoted to staff after the read', async () => {
    await createUserAt(1000);
    const member = await createUserAt(100, dormant);
    const staff = await testPrisma.userRank.findFirstOrThrow({
      where: { level: 500 }
    });
    await testPrisma.user.update({
      where: { id: member.id },
      data: { userRankId: staff.id }
    });
    readAs(member, {});

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ disabled: 0, stale: 1 });
    expect((await reload(member.id)).disabled).toBe(false);
  });

  it('leaves a member staff reinstated after the read', async () => {
    await createUserAt(1000);
    const member = await createUserAt(100, dormant);
    await testPrisma.user.update({
      where: { id: member.id },
      data: { reactivatedAt: new Date() }
    });
    readAs(member, {});

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ disabled: 0, stale: 1 });
    expect((await reload(member.id)).disabled).toBe(false);
  });
});

describe('runInactivityCycle — the warn claim', () => {
  it('stamps a member idle past the warn threshold', async () => {
    await createUserAt(1000);
    const member = await createUserAt(100, { lastLogin: daysAgo(115) });

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ warned: 1, stale: 0 });
    expect((await reload(member.id)).inactivityWarnedAt).not.toBeNull();
  });

  it('does not stamp a member who signed in after the read', async () => {
    // The stamp a sign-in cleared would otherwise come back, and a later
    // dormancy would disable them with no fresh warning.
    await createUserAt(1000);
    const member = await createUserAt(100, { lastLogin: new Date() });
    readAs(member, { lastLogin: daysAgo(115) });

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ warned: 0, stale: 1 });
    expect((await reload(member.id)).inactivityWarnedAt).toBeNull();
  });

  it('does not warn a member another sweep stamped after the read', async () => {
    // Two sweeps at once (two api replicas) would otherwise both warn.
    await createUserAt(1000);
    const stamped = daysAgo(0);
    const member = await createUserAt(100, {
      lastLogin: daysAgo(115),
      inactivityWarnedAt: stamped
    });
    readAs(member, { inactivityWarnedAt: null });

    const result = await runInactivityCycle();

    expect(result).toMatchObject({ warned: 0, stale: 1 });
    expect((await reload(member.id)).inactivityWarnedAt).toEqual(stamped);
  });
});

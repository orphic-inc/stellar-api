/**
 * Integration coverage for the ratio rules applied through their claim (#646,
 * ADR-0044 §4, §6, §7).
 *
 * The claims here are about the database: that a transition moves the row,
 * `canDownload`, an audit row and a PM together; that a staff disable is never
 * lifted; and that the claim itself — apart from the evaluation that reads
 * first and would otherwise hide it — refuses a row that moved after the read.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  applyRatioRules,
  overridePolicyStatus,
  ratioClaimWhere
} from '../modules/ratioPolicy';

beforeEach(async () => {
  await truncateAll();
  await seedDefaults();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

const GiB = BigInt(1024 ** 3);
const DAY_MS = 86_400_000;

let seq = 0;
const mkUser = async (
  opts: { consumed?: bigint; contributed?: bigint; level?: number } = {}
) => {
  const n = (seq += 1);
  const level = opts.level ?? 100;
  const rank =
    (await testPrisma.userRank.findFirst({ where: { level } })) ??
    (await testPrisma.userRank.create({
      data: { level, name: `rank-${level}`, permissions: {} }
    }));
  const settings = await testPrisma.userSettings.create({ data: {} });
  const profile = await testPrisma.profile.create({ data: {} });
  return testPrisma.user.create({
    data: {
      username: `it-rules-${n}`,
      email: `it-rules-${n}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      consumed: opts.consumed ?? 0n,
      contributed: opts.contributed ?? 0n
    }
  });
};

/** Short of ratio: 20 GiB consumed, nothing contributed. */
const shortMember = () => mkUser({ consumed: 20n * GiB });
/** Meets ratio: 20 GiB consumed, 40 GiB contributed. */
const recoveredMember = () =>
  mkUser({ consumed: 20n * GiB, contributed: 40n * GiB });

const stateOf = (userId: number) =>
  testPrisma.ratioPolicyState.findUniqueOrThrow({ where: { userId } });
const canDownload = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).canDownload;
const auditsFor = (userId: number) =>
  testPrisma.auditLog.findMany({
    where: { targetId: userId, action: { startsWith: 'ratioPolicy.' } },
    orderBy: { id: 'asc' }
  });
const pmsTo = (userId: number) =>
  testPrisma.privateConversationParticipant.count({ where: { userId } });

const ratioDisable = (userId: number) =>
  testPrisma.ratioPolicyState.create({
    data: {
      userId,
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'RATIO',
      watchStartedAt: new Date(Date.now() - 20 * DAY_MS),
      downloadDisabledAt: new Date(Date.now() - 6 * DAY_MS)
    }
  });

describe('a transition, applied', () => {
  it('starts a watch after a download: row, audit as the SysOp, and a PM together', async () => {
    const sysop = await mkUser({ level: 1000 });
    const member = await shortMember();

    expect(await applyRatioRules(member.id, 'download')).toEqual({
      kind: 'watch_started'
    });

    expect(await stateOf(member.id)).toMatchObject({
      status: 'WATCH',
      consumedAtWatchStart: 20n * GiB
    });
    const [row] = await auditsFor(member.id);
    expect(row).toMatchObject({
      actorId: sysop.id,
      action: 'ratioPolicy.watch_started',
      metadata: expect.objectContaining({
        from: 'OK',
        to: 'WATCH',
        by: 'download'
      })
    });
    expect(await pmsTo(member.id)).toBe(1);
  });

  it('lifts a RATIO disable once the ratio has recovered', async () => {
    await mkUser({ level: 1000 });
    const member = await recoveredMember();
    await ratioDisable(member.id);
    await testPrisma.user.update({
      where: { id: member.id },
      data: { canDownload: false }
    });

    expect(await applyRatioRules(member.id, 'sweep')).toEqual({
      kind: 'download_restored'
    });

    expect(await stateOf(member.id)).toMatchObject({
      status: 'OK',
      disabledCause: null,
      watchStartedAt: null,
      downloadDisabledAt: null
    });
    expect(await canDownload(member.id)).toBe(true);
    expect((await auditsFor(member.id)).map((a) => a.action)).toEqual([
      'ratioPolicy.download_restored'
    ]);
  });

  it('never lifts a STAFF disable, and only refreshes lastEvaluatedAt', async () => {
    const sysop = await mkUser({ level: 1000 });
    const member = await recoveredMember();
    await overridePolicyStatus(sysop.id, member.id, {
      status: 'DOWNLOAD_DISABLED',
      reason: 'Account sharing'
    });
    const before = await stateOf(member.id);

    expect(await applyRatioRules(member.id, 'sweep')).toBeNull();

    const after = await stateOf(member.id);
    expect(after).toMatchObject({
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'STAFF'
    });
    expect(after.lastEvaluatedAt.getTime()).toBeGreaterThanOrEqual(
      before.lastEvaluatedAt.getTime()
    );
    expect(await canDownload(member.id)).toBe(false);
  });

  it('does not start a watch from the sweep', async () => {
    const member = await shortMember();
    await testPrisma.ratioPolicyState.create({
      data: { userId: member.id, status: 'OK' }
    });

    expect(await applyRatioRules(member.id, 'sweep')).toBeNull();
    expect((await stateOf(member.id)).status).toBe('OK');
  });
});

describe('the claim, on its own', () => {
  const claim = (userId: number, row: Parameters<typeof ratioClaimWhere>[1]) =>
    testPrisma.ratioPolicyState.updateMany({
      where: ratioClaimWhere(userId, row),
      data: { status: 'OK', disabledCause: null }
    });

  it('refuses to lift a RATIO disable that staff turned into a STAFF disable after the read', async () => {
    const sysop = await mkUser({ level: 1000 });
    const member = await recoveredMember();
    await ratioDisable(member.id);
    const read = await stateOf(member.id);

    await overridePolicyStatus(sysop.id, member.id, {
      status: 'DOWNLOAD_DISABLED',
      reason: 'Account sharing'
    });

    expect((await claim(member.id, read)).count).toBe(0);
    expect((await stateOf(member.id)).disabledCause).toBe('STAFF');
  });

  it('refuses on the cause alone, when status and watch start still match', async () => {
    // Held apart from the case above: there the STAFF override also nulls
    // watchStartedAt, so that predicate alone would refuse and hide this one.
    const member = await recoveredMember();
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: 'DOWNLOAD_DISABLED',
        disabledCause: 'RATIO'
      }
    });
    const read = await stateOf(member.id);
    await testPrisma.ratioPolicyState.update({
      where: { userId: member.id },
      data: { disabledCause: 'STAFF' }
    });

    expect((await claim(member.id, read)).count).toBe(0);
  });

  it('refuses to act on an expired watch that staff re-set after the read', async () => {
    const sysop = await mkUser({ level: 1000 });
    const member = await shortMember();
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: 'WATCH',
        watchStartedAt: new Date(Date.now() - 15 * DAY_MS),
        watchExpiresAt: new Date(Date.now() - DAY_MS),
        consumedAtWatchStart: 20n * GiB
      }
    });
    const read = await stateOf(member.id);

    await overridePolicyStatus(sysop.id, member.id, {
      status: 'WATCH',
      reason: 'Fresh start'
    });

    expect((await claim(member.id, read)).count).toBe(0);
  });

  it('moves the row once for two evaluations that read the same state', async () => {
    const member = await shortMember();
    await testPrisma.ratioPolicyState.create({
      data: { userId: member.id, status: 'OK' }
    });
    const read = await stateOf(member.id);
    const toWatch = () =>
      testPrisma.ratioPolicyState.updateMany({
        where: ratioClaimWhere(member.id, read),
        data: { status: 'WATCH', watchStartedAt: new Date() }
      });

    expect((await toWatch()).count).toBe(1);
    expect((await toWatch()).count).toBe(0);
  });
});

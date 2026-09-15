/**
 * Integration coverage for the ratio policy sweep (#646, ADR-0044 §4–5).
 *
 * What only a database can vouch for: that the sweep's where set reaches the
 * right rows — a recovered RATIO disable lifts, a recovered STAFF disable and a
 * short OK member are left alone — and that each move it makes is the full
 * transition, row, `canDownload` and audit row together.
 */
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import { runRatioPolicyCycle } from '../modules/ratioPolicyJob';

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
  opts: {
    consumed?: bigint;
    contributed?: bigint;
    level?: number;
    canDownload?: boolean;
  } = {}
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
      username: `it-sweep-${n}`,
      email: `it-sweep-${n}@example.com`,
      password: 'x',
      avatar: '',
      userRankId: rank.id,
      userSettingsId: settings.id,
      profileId: profile.id,
      consumed: opts.consumed ?? 0n,
      contributed: opts.contributed ?? 0n,
      canDownload: opts.canDownload ?? true
    }
  });
};

const recovered = { consumed: 20n * GiB, contributed: 40n * GiB };
const short = { consumed: 20n * GiB };

const stateOf = (userId: number) =>
  testPrisma.ratioPolicyState.findUniqueOrThrow({ where: { userId } });
const canDownload = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).canDownload;

const disabledRow = (userId: number, disabledCause: 'RATIO' | 'STAFF') =>
  testPrisma.ratioPolicyState.create({
    data: {
      userId,
      status: 'DOWNLOAD_DISABLED',
      disabledCause,
      watchStartedAt:
        disabledCause === 'RATIO' ? new Date(Date.now() - 20 * DAY_MS) : null,
      downloadDisabledAt: new Date(Date.now() - 6 * DAY_MS)
    }
  });

const watchRow = (userId: number, expiresInMs: number) =>
  testPrisma.ratioPolicyState.create({
    data: {
      userId,
      status: 'WATCH',
      watchStartedAt: new Date(Date.now() - 10 * DAY_MS),
      watchExpiresAt: new Date(Date.now() + expiresInMs),
      consumedAtWatchStart: 20n * GiB
    }
  });

it('lifts a recovered RATIO disable, clears a recovered watch, and disables an expired short one', async () => {
  const sysop = await mkUser({ level: 1000 });
  const lifted = await mkUser({ ...recovered, canDownload: false });
  await disabledRow(lifted.id, 'RATIO');
  const cleared = await mkUser(recovered);
  await watchRow(cleared.id, DAY_MS);
  const expired = await mkUser(short);
  await watchRow(expired.id, -DAY_MS);

  expect(await runRatioPolicyCycle()).toEqual({
    evaluated: 3,
    watch_started: 0,
    watch_cleared: 1,
    download_disabled: 1,
    download_restored: 1,
    failed: 0
  });

  expect(await stateOf(lifted.id)).toMatchObject({
    status: 'OK',
    disabledCause: null
  });
  expect(await canDownload(lifted.id)).toBe(true);
  expect((await stateOf(cleared.id)).status).toBe('OK');
  expect(await stateOf(expired.id)).toMatchObject({
    status: 'DOWNLOAD_DISABLED',
    disabledCause: 'RATIO'
  });
  expect(await canDownload(expired.id)).toBe(false);

  const audits = await testPrisma.auditLog.findMany({
    where: { action: { startsWith: 'ratioPolicy.' } }
  });
  expect(audits).toHaveLength(3);
  expect(audits.every((a) => a.actorId === sysop.id)).toBe(true);
  expect(
    audits.every((a) => (a.metadata as { by: string }).by === 'sweep')
  ).toBe(true);
});

it('leaves a recovered STAFF disable and a short OK member untouched', async () => {
  const staffDisabled = await mkUser({ ...recovered, canDownload: false });
  await disabledRow(staffDisabled.id, 'STAFF');
  const okShort = await mkUser(short);
  await testPrisma.ratioPolicyState.create({
    data: { userId: okShort.id, status: 'OK' }
  });
  const before = await stateOf(staffDisabled.id);

  expect(await runRatioPolicyCycle()).toMatchObject({ evaluated: 0 });

  expect(await stateOf(staffDisabled.id)).toEqual(before);
  expect(await canDownload(staffDisabled.id)).toBe(false);
  expect((await stateOf(okShort.id)).status).toBe('OK');
});

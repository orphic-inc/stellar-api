/**
 * Integration coverage for the ratio disable cause and the audited staff
 * override (#646).
 *
 * The claims here are about the database: that the backfill migration's own SQL
 * labels pre-#646 rows by the watch field the two writers always left
 * differently, that the automatic disable records `RATIO` and the override
 * `STAFF`, that the override's audit row lands, and that a staff watch now
 * reaches the 10 GiB rule through the real evaluator.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { truncateAll, seedDefaults, testPrisma } from '../test/dbHelpers';
import {
  evaluateRatioPolicy,
  overridePolicyStatus
} from '../modules/ratioPolicy';

const BACKFILL_SQL = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260915200100_ratio_disable_cause_backfill/migration.sql'
  ),
  'utf8'
);

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
      username: `it-ratio-${n}`,
      email: `it-ratio-${n}@example.com`,
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

const stateOf = (userId: number) =>
  testPrisma.ratioPolicyState.findUniqueOrThrow({ where: { userId } });
const canDownload = async (id: number) =>
  (await testPrisma.user.findUniqueOrThrow({ where: { id } })).canDownload;

describe('the disabledCause backfill', () => {
  const backfill = () => testPrisma.$executeRawUnsafe(BACKFILL_SQL);

  it('labels a disable that kept its watch RATIO, one without STAFF, and leaves other rows alone', async () => {
    const ratio = await mkUser();
    const staff = await mkUser();
    const watching = await mkUser();
    const ok = await mkUser();
    const now = new Date();
    await testPrisma.ratioPolicyState.createMany({
      data: [
        {
          userId: ratio.id,
          status: 'DOWNLOAD_DISABLED',
          watchStartedAt: new Date(now.getTime() - 20 * DAY_MS),
          downloadDisabledAt: now
        },
        {
          userId: staff.id,
          status: 'DOWNLOAD_DISABLED',
          downloadDisabledAt: now
        },
        { userId: watching.id, status: 'WATCH', watchStartedAt: now },
        { userId: ok.id, status: 'OK' }
      ]
    });

    await backfill();

    expect((await stateOf(ratio.id)).disabledCause).toBe('RATIO');
    expect((await stateOf(staff.id)).disabledCause).toBe('STAFF');
    expect((await stateOf(watching.id)).disabledCause).toBeNull();
    expect((await stateOf(ok.id)).disabledCause).toBeNull();
  });

  it('does not relabel a row that already has a cause', async () => {
    const member = await mkUser();
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: 'DOWNLOAD_DISABLED',
        disabledCause: 'STAFF',
        watchStartedAt: new Date()
      }
    });

    await backfill();

    expect((await stateOf(member.id)).disabledCause).toBe('STAFF');
  });
});

describe('the cause each writer records', () => {
  it('records RATIO when a watch expires still short', async () => {
    const member = await mkUser({ consumed: 20n * GiB });
    await testPrisma.ratioPolicyState.create({
      data: {
        userId: member.id,
        status: 'WATCH',
        watchStartedAt: new Date(Date.now() - 15 * DAY_MS),
        watchExpiresAt: new Date(Date.now() - DAY_MS),
        consumedAtWatchStart: 20n * GiB
      }
    });

    await evaluateRatioPolicy(member.id);

    expect(await stateOf(member.id)).toMatchObject({
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'RATIO'
    });
    expect(await canDownload(member.id)).toBe(false);
  });

  it('records STAFF for an override, audited with the reason, and clears it on restore', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser();

    await overridePolicyStatus(staff.id, member.id, {
      status: 'DOWNLOAD_DISABLED',
      reason: 'Account sharing'
    });
    expect(await stateOf(member.id)).toMatchObject({
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'STAFF'
    });
    expect(await canDownload(member.id)).toBe(false);

    await overridePolicyStatus(staff.id, member.id, {
      status: 'OK',
      reason: 'Appeal upheld'
    });
    expect((await stateOf(member.id)).disabledCause).toBeNull();
    expect(await canDownload(member.id)).toBe(true);

    const rows = await testPrisma.auditLog.findMany({
      where: { action: 'ratioPolicy.override', targetId: member.id },
      orderBy: { id: 'asc' }
    });
    expect(rows.map((r) => [r.actorId, r.metadata])).toEqual([
      [
        staff.id,
        expect.objectContaining({
          from: 'OK',
          to: 'DOWNLOAD_DISABLED',
          toCause: 'STAFF',
          reason: 'Account sharing'
        })
      ],
      [
        staff.id,
        expect.objectContaining({
          from: 'DOWNLOAD_DISABLED',
          fromCause: 'STAFF',
          to: 'OK',
          toCause: null,
          reason: 'Appeal upheld'
        })
      ]
    ]);
  });
});

describe('a staff watch', () => {
  it('reaches the 10 GiB rule through the evaluator', async () => {
    const staff = await mkUser({ level: 1000 });
    const member = await mkUser({ consumed: 20n * GiB });

    await overridePolicyStatus(staff.id, member.id, {
      status: 'WATCH',
      reason: 'Suspicious consumption'
    });
    expect((await stateOf(member.id)).consumedAtWatchStart).toBe(20n * GiB);

    await testPrisma.user.update({
      where: { id: member.id },
      data: { consumed: 30n * GiB }
    });
    await evaluateRatioPolicy(member.id);

    expect(await stateOf(member.id)).toMatchObject({
      status: 'DOWNLOAD_DISABLED',
      disabledCause: 'RATIO'
    });
  });
});

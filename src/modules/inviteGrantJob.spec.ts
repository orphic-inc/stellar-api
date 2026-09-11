/**
 * Unit tests for the invite-handout sweep wiring (#282, ADR-0039). The decision
 * logic belongs to the pure evaluator (inviteGrant.spec.ts); what is pinned here
 * is the DB-bound shell — the mode gate, the system-actor gate, the shape of the
 * two writes, and the cycle audit row.
 *
 * The write shape is the part worth guarding. It must stay a CONDITIONAL
 * increment: an absolute value computed from the balance we read would clobber a
 * member who spends an invite mid-pass, and the `lte: cap - amount` predicate is
 * the only thing stopping it.
 */
import { prismaMock, resetApiTestState } from '../test/apiTestHarness';

jest.mock('./logging', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const mockResolveSystemActorId = jest.fn();
jest.mock('./rankProgressionJob', () => ({
  ...jest.requireActual('./rankProgressionJob'),
  resolveSystemActorId: () => mockResolveSystemActorId()
}));

const mockAudit = jest.fn();
jest.mock('../lib/audit', () => ({
  audit: (...args: unknown[]) => mockAudit(...args)
}));

import { inviteGrant as mockConfig } from './config';

import { runInviteGrantCycle } from './inviteGrantJob';
import { DAY_MS, PERIOD_DAYS } from './inviteGrant';

interface UpdateManyCall {
  where: { id: unknown; inviteCount?: unknown };
  data: { inviteCount?: unknown; lastInviteGrantAt?: unknown };
}

/** Nth `user.updateMany` call, narrowed — the mock tuple is loosely typed. */
const grantCall = (n: number): UpdateManyCall =>
  prismaMock.user.updateMany.mock.calls[n]?.[0] as unknown as UpdateManyCall;

const NOW = new Date('2026-09-11T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

interface RowOver {
  id?: number;
  inviteCount?: number;
  lastInviteGrantAt?: Date | null;
  dateRegistered?: Date;
  banDate?: Date | null;
  warnings?: Array<{ expiresAt: Date | null }>;
  rank?: { id: number; level: number; perPeriod: number; cap: number };
}

const row = (over: RowOver = {}) => ({
  id: over.id ?? 1,
  inviteCount: over.inviteCount ?? 0,
  lastInviteGrantAt:
    over.lastInviteGrantAt === undefined
      ? daysAgo(PERIOD_DAYS)
      : over.lastInviteGrantAt,
  dateRegistered: over.dateRegistered ?? daysAgo(400),
  disabled: false,
  banDate: over.banDate ?? null,
  userRank: {
    id: over.rank?.id ?? 2,
    level: over.rank?.level ?? 150,
    inviteGrantPerPeriod: over.rank?.perPeriod ?? 2,
    inviteCap: over.rank?.cap ?? 6
  },
  warnings: over.warnings ?? []
});

/** One page of members, then an empty page to end the cursor loop. */
const mockPages = (rows: ReturnType<typeof row>[]) => {
  prismaMock.user.findMany
    .mockResolvedValueOnce(rows as never)
    .mockResolvedValue([] as never);
};

beforeEach(() => {
  resetApiTestState();
  mockConfig.mode = 'on';
  mockResolveSystemActorId.mockReset().mockResolvedValue(9);
  mockAudit.mockReset();
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe('runInviteGrantCycle — gates', () => {
  it('does nothing at all when the mode is off', async () => {
    mockConfig.mode = 'off';
    const tally = await runInviteGrantCycle(NOW);
    expect(tally.granted).toBe(0);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    // The actor lookup is a query too — the off switch precedes it.
    expect(mockResolveSystemActorId).not.toHaveBeenCalled();
  });

  it('skips the sweep when no SysOp exists to attribute the cycle to', async () => {
    mockResolveSystemActorId.mockResolvedValue(null);
    const tally = await runInviteGrantCycle(NOW);
    expect(tally.granted).toBe(0);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('pre-filters on a nonzero rank rate so ranks that earn nothing are never paged', async () => {
    mockPages([]);
    await runInviteGrantCycle(NOW);
    const where = prismaMock.user.findMany.mock.calls[0]?.[0]?.where as {
      disabled: boolean;
      userRank: { level: unknown; inviteGrantPerPeriod: unknown };
    };
    expect(where.disabled).toBe(false);
    expect(where.userRank.inviteGrantPerPeriod).toEqual({ gt: 0 });
    expect(where.userRank.level).toEqual({ lt: 500 });
  });
});

describe('runInviteGrantCycle — writes', () => {
  it('grants with a conditional increment, never an absolute value', async () => {
    mockPages([row({ id: 1, inviteCount: 0 })]);
    const tally = await runInviteGrantCycle(NOW);

    expect(tally.granted).toBe(1);
    expect(tally.invites).toBe(2);

    const call = grantCall(0);
    expect(call.where.id).toEqual({ in: [1] });
    // cap 6 - amount 2: a member who spends between our read and this write
    // simply falls out of the predicate instead of being overwritten.
    expect(call.where.inviteCount).toEqual({ lte: 4 });
    expect(call.data.inviteCount).toEqual({ increment: 2 });
    expect(call.data.lastInviteGrantAt).toBe(NOW);
  });

  it('batches one write per rank rather than one per member', async () => {
    mockPages([
      row({ id: 1, rank: { id: 2, level: 150, perPeriod: 2, cap: 6 } }),
      row({ id: 2, rank: { id: 2, level: 150, perPeriod: 2, cap: 6 } }),
      row({ id: 3, rank: { id: 3, level: 200, perPeriod: 5, cap: 10 } })
    ]);
    const tally = await runInviteGrantCycle(NOW);

    expect(tally.granted).toBe(3);
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(2);
    expect(tally.byRank).toEqual({ 2: 2, 3: 1 });
  });

  it('advances the clock of a clamped member without granting them anything', async () => {
    mockPages([row({ id: 7, inviteCount: 6 })]);
    const tally = await runInviteGrantCycle(NOW);

    expect(tally.atCap).toBe(1);
    expect(tally.granted).toBe(0);

    const call = grantCall(0);
    expect(call.where).toEqual({ id: { in: [7] } });
    expect(call.data).toEqual({ lastInviteGrantAt: NOW });
  });

  it('withholds from poor standing and counts it separately from a quiet skip', async () => {
    mockPages([
      row({ id: 1, warnings: [{ expiresAt: null }, { expiresAt: null }] })
    ]);
    const tally = await runInviteGrantCycle(NOW);

    expect(tally.withheld).toBe(1);
    expect(tally.granted).toBe(0);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('ignores an expired warning when computing standing', async () => {
    mockPages([
      row({
        id: 1,
        warnings: [{ expiresAt: daysAgo(5) }, { expiresAt: daysAgo(9) }]
      })
    ]);
    const tally = await runInviteGrantCycle(NOW);
    expect(tally.withheld).toBe(0);
    expect(tally.granted).toBe(1);
  });

  it('treats a banned member as hammer standing', async () => {
    mockPages([row({ id: 1, banDate: daysAgo(2) })]);
    const tally = await runInviteGrantCycle(NOW);
    expect(tally.withheld).toBe(1);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('runInviteGrantCycle — dryRun', () => {
  it('evaluates everything and writes nothing', async () => {
    mockConfig.mode = 'dryRun';
    mockPages([row({ id: 1 }), row({ id: 2, inviteCount: 6 })]);

    const tally = await runInviteGrantCycle(NOW);

    // The counts are real — that is the entire point of the mode.
    expect(tally.granted).toBe(1);
    expect(tally.invites).toBe(2);
    expect(tally.atCap).toBe(1);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe('runInviteGrantCycle — audit', () => {
  it('writes one cycle row carrying the tally, not one row per member', async () => {
    mockPages([row({ id: 1 }), row({ id: 2 }), row({ id: 3, inviteCount: 6 })]);
    await runInviteGrantCycle(NOW);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const [, actorId, action, targetType, , meta] = mockAudit.mock.calls[0];
    expect(actorId).toBe(9);
    expect(action).toBe('invites.granted');
    expect(targetType).toBe('SiteSettings');
    expect(meta).toMatchObject({
      by: 'inviteGrantJob',
      granted: 2,
      invites: 4,
      atCap: 1
    });
  });

  it('writes no row on a pass that changed nothing', async () => {
    mockPages([row({ id: 1, lastInviteGrantAt: daysAgo(1) })]);
    await runInviteGrantCycle(NOW);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

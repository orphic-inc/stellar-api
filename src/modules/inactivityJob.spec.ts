/**
 * Unit tests for the inactivity sweep wiring. The decision logic belongs to the
 * pure evaluator (inactivity.spec.ts); this pins the DB-bound shell — the mode
 * gate, the per-cycle cap, the claims that keep a stale read from acting (#825),
 * the ordering that makes the notices deliverable, and the admin-created lookup.
 *
 * Mode is re-read from the config module per test rather than set once, because
 * the whole point of `off` being the default is that it is load-bearing.
 */
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@prisma/client';

// A per-file Prisma mock, not the route harness: the harness imports app.ts,
// which calls createApp() at module scope and starts every background job —
// including this one, before the spec has had a chance to set its mode.
const prismaMock = mockDeep<PrismaClient>();
jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));

jest.mock('./pm', () => ({ sendSystemMessage: jest.fn() }));
jest.mock('../lib/mailer', () => ({
  sendInactivityWarningEmail: jest.fn(),
  sendInactivityDisabledEmail: jest.fn()
}));
jest.mock('../lib/audit', () => ({ audit: jest.fn() }));

import { inactivity as inactivityConfig } from './config';
import { sendSystemMessage } from './pm';
import {
  sendInactivityWarningEmail,
  sendInactivityDisabledEmail
} from '../lib/mailer';
import { audit } from '../lib/audit';
import { runInactivityCycle } from './inactivityJob';
import { DAY_MS } from './inactivity';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY_MS);

// The config export is a plain object, so each test sets the dial directly.
// Mocking the module instead breaks import: apiTestHarness pulls in app.ts,
// which calls createApp() at module scope and starts the jobs.
const mutableConfig = inactivityConfig as {
  mode: 'off' | 'dryRun' | 'on';
  maxDisablesPerCycle: number;
  intervalMs: number;
};

/** A row as loadBatch selects it — idle long enough to disable, already warned. */
const disableRow = (id: number) => ({
  id,
  email: `u${id}@example.com`,
  lastLogin: daysAgo(200),
  dateRegistered: daysAgo(800),
  reactivatedAt: null,
  inactivityWarnedAt: daysAgo(30),
  disabled: false,
  isDonor: false,
  rankLocked: false,
  userRank: { level: 100 }
});

/** Idle past the warn threshold, never warned. */
const warnRow = (id: number) => ({
  ...disableRow(id),
  lastLogin: daysAgo(115),
  inactivityWarnedAt: null
});

beforeEach(() => {
  mockReset(prismaMock);
  mutableConfig.mode = 'on';
  mutableConfig.maxDisablesPerCycle = 50;
  (sendSystemMessage as jest.Mock).mockResolvedValue({ ok: true });
  (sendInactivityWarningEmail as jest.Mock).mockResolvedValue(true);
  (sendInactivityDisabledEmail as jest.Mock).mockResolvedValue(true);
  (audit as jest.Mock).mockResolvedValue(undefined);
  // resolveSystemActorId's lookup, then the candidate batches.
  prismaMock.user.findFirst.mockResolvedValue({ id: 1 } as never);
  prismaMock.auditLog.findMany.mockResolvedValue([] as never);
  // Every claim lands unless a test says otherwise; the disable's interactive
  // transaction runs its callback against the same mock.
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.userSession.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn(prismaMock)) as never);
});

const givenBatch = (...rows: unknown[]) => {
  // Partial rows: loadBatch selects a narrow slice, but the deep mock is typed
  // against the whole model, so the fixture is cast at the mock boundary rather
  // than padded with thirty fields the code never reads.
  prismaMock.user.findMany
    .mockResolvedValueOnce(rows as never)
    .mockResolvedValue([] as never);
};

describe('runInactivityCycle — the mode gate', () => {
  it('does nothing at all when off, not even a query', async () => {
    mutableConfig.mode = 'off';
    givenBatch(disableRow(2));

    const result = await runInactivityCycle(NOW);

    expect(result).toEqual({
      warned: 0,
      disabled: 0,
      deferred: 0,
      failed: 0,
      stale: 0
    });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('counts but writes nothing in dryRun', async () => {
    mutableConfig.mode = 'dryRun';
    givenBatch(disableRow(2), warnRow(3));

    const result = await runInactivityCycle(NOW);

    // The counts are the point — this number against real data is what makes
    // turning it on a decision rather than a hope.
    expect(result.disabled).toBe(1);
    expect(result.warned).toBe(1);
    // THE ASSERTION THAT CARRIES THE MODE. Without it the test passes whether
    // or not dryRun wrote to the database.
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(sendInactivityDisabledEmail).not.toHaveBeenCalled();
    expect(sendSystemMessage).not.toHaveBeenCalled();
  });

  it('skips the sweep entirely when no SysOp exists to attribute it to', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    givenBatch(disableRow(2));

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

/** The claim filter for a row as loadBatch read it (#825). */
const claimOn = (
  row: Omit<ReturnType<typeof disableRow>, 'inactivityWarnedAt'> & {
    inactivityWarnedAt: Date | null;
  }
) => ({
  id: row.id,
  disabled: false,
  isDonor: false,
  rankLocked: false,
  userRank: { level: { lt: 500 } },
  lastLogin: row.lastLogin,
  reactivatedAt: row.reactivatedAt,
  inactivityWarnedAt: row.inactivityWarnedAt
});

describe('runInactivityCycle — applying a warn', () => {
  it('claims the stamp, then sends the PM and the email', async () => {
    givenBatch(warnRow(3));

    const result = await runInactivityCycle(NOW);

    expect(result.warned).toBe(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: claimOn(warnRow(3)),
      data: { inactivityWarnedAt: expect.any(Date) }
    });
    expect(sendSystemMessage).toHaveBeenCalledWith(
      3,
      expect.any(String),
      expect.any(String)
    );
    expect(sendInactivityWarningEmail).toHaveBeenCalledWith(
      'u3@example.com',
      10
    );
    // Stamped first, so a stamp can never land on a member whose sign-in
    // cleared it after the notices went out (#825).
    const stampOrder = prismaMock.user.updateMany.mock.invocationCallOrder[0];
    const pmOrder = (sendSystemMessage as jest.Mock).mock
      .invocationCallOrder[0];
    expect(stampOrder).toBeLessThan(pmOrder);
  });

  it('stamps even when the email could not be sent', async () => {
    // Deliberate (#279): the System PM is the notice of record, and the member
    // is not disabled yet so it is actually deliverable.
    (sendInactivityWarningEmail as jest.Mock).mockResolvedValue(false);
    givenBatch(warnRow(3));

    const result = await runInactivityCycle(NOW);

    expect(result.warned).toBe(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the member changed after the read', async () => {
    // The claim missed: they signed in, or staff exempted them, meanwhile.
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as never);
    givenBatch(warnRow(3));

    const result = await runInactivityCycle(NOW);

    expect(result).toMatchObject({ warned: 0, stale: 1, failed: 0 });
    expect(sendSystemMessage).not.toHaveBeenCalled();
    expect(sendInactivityWarningEmail).not.toHaveBeenCalled();
  });
});

describe('runInactivityCycle — applying a disable', () => {
  it('disables and revokes sessions BEFORE emailing, and audits as the engine', async () => {
    givenBatch(disableRow(2));

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: claimOn(disableRow(2)),
      data: { disabled: true }
    });
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 2, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    // Claimed first, so only a member the sweep actually disabled is told it
    // did (#825). The mailer never reads `disabled`, so the email still arrives.
    const writeOrder = prismaMock.user.updateMany.mock.invocationCallOrder[0];
    const emailOrder = (sendInactivityDisabledEmail as jest.Mock).mock
      .invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(emailOrder);

    // Asserted positionally past the client argument: the deep Prisma mock is a
    // proxy, and matching it is not what this test is about. The actor is the
    // resolved SysOp, the action matches a staff disable so the trail stays
    // uniform, and the metadata is what says the engine did it.
    const [, actorId, action, targetType, targetId, meta] = (audit as jest.Mock)
      .mock.calls[0];
    expect(actorId).toBe(1);
    expect(action).toBe('user.disabled');
    expect(targetType).toBe('User');
    expect(targetId).toBe(2);
    expect(meta).toMatchObject({ by: 'inactivityJob' });
  });

  it('leaves the member alone when they changed after the read', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as never);
    givenBatch(disableRow(2));

    const result = await runInactivityCycle(NOW);

    expect(result).toMatchObject({ disabled: 0, stale: 1, failed: 0 });
    // A member who signed in meanwhile keeps the session they just made.
    expect(prismaMock.userSession.updateMany).not.toHaveBeenCalled();
    expect(sendInactivityDisabledEmail).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('does not spend the cap on a claim that missed', async () => {
    mutableConfig.maxDisablesPerCycle = 1;
    prismaMock.user.updateMany
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValue({ count: 1 } as never);
    givenBatch(disableRow(2), disableRow(3));

    const result = await runInactivityCycle(NOW);

    expect(result).toMatchObject({ disabled: 1, stale: 1, deferred: 0 });
  });
});

// One account's failure used to abandon the cycle, so every account later in
// the cursor went unevaluated until the next day's run (#596). Each account is
// independent, so the sweep contains the failure and moves on.
describe('runInactivityCycle — a failing account', () => {
  it('keeps going past a user whose warn write throws', async () => {
    givenBatch(warnRow(2), warnRow(3));
    prismaMock.user.updateMany
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue({ count: 1 } as never);

    const result = await runInactivityCycle(NOW);

    expect(result).toEqual({
      warned: 1,
      disabled: 0,
      deferred: 0,
      failed: 1,
      stale: 0
    });
    expect(prismaMock.user.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: claimOn(warnRow(3)) })
    );
  });

  it('keeps going past a user whose disable throws', async () => {
    givenBatch(disableRow(2), disableRow(3));
    prismaMock.$transaction
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockImplementation(((fn: (tx: unknown) => unknown) =>
        fn(prismaMock)) as never);

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(1);
    expect(result.failed).toBe(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('runInactivityCycle — the per-cycle cap', () => {
  it('stops disabling at the cap and reports the remainder as deferred', async () => {
    mutableConfig.maxDisablesPerCycle = 2;
    givenBatch(disableRow(2), disableRow(3), disableRow(4), disableRow(5));

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(2);
    expect(result.deferred).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not cap warnings — only the disable needs staff to undo', async () => {
    mutableConfig.maxDisablesPerCycle = 1;
    givenBatch(warnRow(3), warnRow(4), warnRow(5));

    const result = await runInactivityCycle(NOW);

    expect(result.warned).toBe(3);
    expect(result.deferred).toBe(0);
  });
});

describe('runInactivityCycle — admin-created lookup', () => {
  it('exempts an account whose user.create audit row exists', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([{ targetId: 7 }] as never);
    givenBatch({
      ...disableRow(7),
      lastLogin: null,
      inactivityWarnedAt: null,
      dateRegistered: daysAgo(400)
    });

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('sweeps the same account when no such audit row exists', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    givenBatch({
      ...disableRow(7),
      lastLogin: null,
      inactivityWarnedAt: null,
      dateRegistered: daysAgo(400)
    });

    const result = await runInactivityCycle(NOW);

    expect(result.disabled).toBe(1);
  });
});

/**
 * Unit tests for link-health: the WARN->FAIL sweep + transition stamping, and
 * the community pulse (aggregate heartbeat over per-contribution linkStatus).
 * DB + fetch are mocked.
 */

import { LinkHealthStatus } from '@prisma/client';

const mockPrismaContribution = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  groupBy: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: { contribution: mockPrismaContribution }
}));

jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

jest.mock('./pm', () => ({
  sendSystemMessage: jest.fn().mockResolvedValue({ ok: true })
}));

import {
  sweepStaleWarnLinks,
  checkContributionLink,
  getCommunityHealthPulse,
  computePulse,
  applyHealthAccrual
} from './linkHealth';
import { sendSystemMessage } from './pm';

const mockSendSystemMessage = sendSystemMessage as jest.Mock;

// ─── sweepStaleWarnLinks ──────────────────────────────────────────────────────

describe('sweepStaleWarnLinks', () => {
  beforeEach(() => jest.clearAllMocks());

  const warn = (id: number, userId: number, title: string) => ({
    id,
    userId,
    release: { title }
  });

  it('promotes the stuck WARN links it found to FAIL', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([
      warn(1, 10, 'A'),
      warn(2, 11, 'B')
    ]);
    mockPrismaContribution.updateMany.mockResolvedValue({ count: 2 });

    await sweepStaleWarnLinks();

    expect(mockPrismaContribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1, 2] } },
        data: expect.objectContaining({ linkStatus: 'FAIL' })
      })
    );
  });

  it('selects WARN links stuck since a cutoff ~72h in the past', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([]);
    await sweepStaleWarnLinks();
    const arg = mockPrismaContribution.findMany.mock.calls[0][0];
    expect(arg.where.linkStatus).toBe('WARN');
    const ageHours =
      (Date.now() - arg.where.linkStatusChangedAt.lt.getTime()) / 3_600_000;
    expect(ageHours).toBeGreaterThan(71);
    expect(ageHours).toBeLessThan(73);
  });

  it('no-ops (no update, no PM) when nothing is stale', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([]);
    await sweepStaleWarnLinks();
    expect(mockPrismaContribution.updateMany).not.toHaveBeenCalled();
    expect(mockSendSystemMessage).not.toHaveBeenCalled();
  });

  it('sends one System PM per affected contributor, batching their dead links', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([
      warn(1, 10, 'Album One'),
      warn(2, 10, 'Album Two'),
      warn(3, 20, 'Album Three')
    ]);
    mockPrismaContribution.updateMany.mockResolvedValue({ count: 3 });

    await sweepStaleWarnLinks();

    // One PM to user 10 (covering both their links), one to user 20.
    expect(mockSendSystemMessage).toHaveBeenCalledTimes(2);
    const recipients = mockSendSystemMessage.mock.calls.map((c) => c[0]);
    expect(recipients.sort()).toEqual([10, 20]);

    const user10Body = mockSendSystemMessage.mock.calls.find(
      (c) => c[0] === 10
    )![2];
    expect(user10Body).toContain('Album One');
    expect(user10Body).toContain('Album Two');
  });

  it('does not let a PM failure block the sweep', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([warn(1, 10, 'A')]);
    mockPrismaContribution.updateMany.mockResolvedValue({ count: 1 });
    mockSendSystemMessage.mockRejectedValueOnce(new Error('pm down'));

    await expect(sweepStaleWarnLinks()).resolves.toBeUndefined();
    expect(mockPrismaContribution.updateMany).toHaveBeenCalled();
  });
});

// ─── checkContributionLink — transition stamping ──────────────────────────────

describe('checkContributionLink stamps linkStatusChangedAt on transition', () => {
  const fetchMock = jest.fn();
  beforeAll(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });
  beforeEach(() => jest.clearAllMocks());

  it('stamps the change when status flips (WARN → PASS)', async () => {
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'WARN',
      linkStatusChangedAt: new Date('2020-01-01'),
      healthyMs: 0n,
      healthySince: null
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatus).toBe('PASS');
    expect(data.linkStatusChangedAt).toBeInstanceOf(Date);
    // Entering PASS opens the uptime segment (#95 / ADR-0019).
    expect(data.healthySince).toBeInstanceOf(Date);
  });

  it('does not re-stamp when status is unchanged and already stamped', async () => {
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'PASS',
      linkStatusChangedAt: new Date('2020-01-01'),
      healthyMs: 0n,
      healthySince: new Date('2020-01-01')
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatus).toBe('PASS');
    expect(data.linkStatusChangedAt).toBeUndefined();
    // Still accruing: the open segment is left untouched (no re-open, no bank).
    expect(data.healthySince).toEqual(new Date('2020-01-01'));
  });

  it('initializes the clock when it has never been stamped (backfill case)', async () => {
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'PASS',
      linkStatusChangedAt: null,
      healthyMs: 0n,
      healthySince: null
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatusChangedAt).toBeInstanceOf(Date);
    // Self-heal: a backfilled PASS that never opened a segment opens one now.
    expect(data.healthySince).toBeInstanceOf(Date);
  });

  it('banks the open PASS segment when a link goes PASS → FAIL', async () => {
    const since = new Date('2020-01-01T00:00:00Z');
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'PASS',
      linkStatusChangedAt: since,
      healthyMs: 1000n,
      healthySince: since
    });
    // 404 → FAIL.
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatus).toBe('FAIL');
    expect(data.healthySince).toBeNull();
    // Banked = prior 1000ms + the elapsed open segment (> 0).
    expect(data.healthyMs).toBeGreaterThan(1000n);
  });
});

// ─── applyHealthAccrual (pure) ────────────────────────────────────────────────

describe('applyHealthAccrual', () => {
  const now = new Date('2026-06-21T00:00:00Z');
  const earlier = new Date('2026-06-20T00:00:00Z'); // 24h before `now`
  const DAY_MS = 86_400_000n;

  it('opens a segment when entering PASS from a closed state', () => {
    expect(
      applyHealthAccrual(
        LinkHealthStatus.PASS,
        { healthyMs: 500n, healthySince: null },
        now
      )
    ).toEqual({ healthyMs: 500n, healthySince: now });
  });

  it('self-heals: opens a segment for a PASS that never opened one', () => {
    // Same path as "entering PASS" — healthySince is the only flag that matters.
    expect(
      applyHealthAccrual(
        LinkHealthStatus.PASS,
        { healthyMs: 0n, healthySince: null },
        now
      ).healthySince
    ).toEqual(now);
  });

  it('is a no-op while already accruing (PASS with an open segment)', () => {
    const current = { healthyMs: 10n, healthySince: earlier };
    expect(applyHealthAccrual(LinkHealthStatus.PASS, current, now)).toEqual(
      current
    );
  });

  it('banks and closes the segment when leaving PASS', () => {
    expect(
      applyHealthAccrual(
        LinkHealthStatus.FAIL,
        { healthyMs: 100n, healthySince: earlier },
        now
      )
    ).toEqual({ healthyMs: 100n + DAY_MS, healthySince: null });
  });

  it('does the same for WARN (only PASS accrues)', () => {
    expect(
      applyHealthAccrual(
        LinkHealthStatus.WARN,
        { healthyMs: 0n, healthySince: earlier },
        now
      )
    ).toEqual({ healthyMs: DAY_MS, healthySince: null });
  });

  it('is a no-op for a non-PASS status with no open segment', () => {
    const current = { healthyMs: 7n, healthySince: null };
    expect(applyHealthAccrual(LinkHealthStatus.UNKNOWN, current, now)).toEqual(
      current
    );
    expect(applyHealthAccrual(LinkHealthStatus.FAIL, current, now)).toEqual(
      current
    );
  });

  it('banks exactly the PASS interval across a PASS → WARN → PASS round-trip', () => {
    const t0 = new Date('2026-06-01T00:00:00Z');
    const t1 = new Date('2026-06-03T00:00:00Z'); // +2 days PASS → WARN: bank 2d
    const t2 = new Date('2026-06-05T00:00:00Z'); // WARN → PASS: reopen (no accrual for WARN)
    const opened = applyHealthAccrual(
      LinkHealthStatus.PASS,
      { healthyMs: 0n, healthySince: null },
      t0
    );
    const banked = applyHealthAccrual(LinkHealthStatus.WARN, opened, t1);
    expect(banked).toEqual({ healthyMs: 2n * DAY_MS, healthySince: null });
    const reopened = applyHealthAccrual(LinkHealthStatus.PASS, banked, t2);
    // The 2-day WARN window is NOT credited; only the new open segment carries on.
    expect(reopened).toEqual({ healthyMs: 2n * DAY_MS, healthySince: t2 });
  });
});

// ─── getCommunityHealthPulse ──────────────────────────────────────────────────

// Shape rows the way prisma.contribution.groupBy(by: ['linkStatus']) returns them.
const groupRows = (counts: Partial<Record<LinkHealthStatus, number>>) =>
  Object.entries(counts).map(([linkStatus, n]) => ({
    linkStatus: linkStatus as LinkHealthStatus,
    _count: { _all: n }
  }));

describe('getCommunityHealthPulse', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads Unknown with a null pulse when nothing has been checked yet', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(groupRows({ UNKNOWN: 5 }));

    const r = await getCommunityHealthPulse(1);

    expect(r).toMatchObject({
      pass: 0,
      unknown: 5,
      checked: 0,
      total: 5,
      pulse: null,
      status: 'Unknown'
    });
  });

  it('reads a full heartbeat when every checked link passes', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 8, UNKNOWN: 2 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBe(1);
    expect(r.status).toBe('Healthy');
    expect(r.checked).toBe(8);
    expect(r.total).toBe(10);
  });

  it('computes the pass ratio over definitive links, excluding WARN and UNKNOWN', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 6, WARN: 2, FAIL: 2 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBe(0.75); // 6 PASS / (6 PASS + 2 FAIL); WARN is indeterminate
    expect(r.status).toBe('Ailing'); // >= 0.6
  });

  it('reads Unknown — not Critical — for a transient-only (WARN) community', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(groupRows({ WARN: 5 }));

    const r = await getCommunityHealthPulse(1);

    expect(r.checked).toBe(0); // WARN is not definitive
    expect(r.pulse).toBeNull();
    expect(r.status).toBe('Unknown');
  });

  it('withholds a confident band until coverage clears the floor', async () => {
    // One PASS among 99 unprobed: pulse is technically 1.0, but only 1% probed.
    mockPrismaContribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 1, UNKNOWN: 99 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBe(1);
    expect(r.coverage).toBeCloseTo(0.01);
    expect(r.status).toBe('Unknown'); // below PULSE_MIN_COVERAGE — not Healthy
  });

  it('scopes the aggregation to the community via the release relation', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(groupRows({ PASS: 1 }));

    await getCommunityHealthPulse(42);

    expect(mockPrismaContribution.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['linkStatus'],
        where: { release: { communityId: 42 } }
      })
    );
  });

  it('reads Critical when failures dominate', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 1, FAIL: 9 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBeCloseTo(0.1);
    expect(r.status).toBe('Critical');
  });

  it('returns a null pulse for a community with no contributions', async () => {
    mockPrismaContribution.groupBy.mockResolvedValue([]);

    const r = await getCommunityHealthPulse(1);

    expect(r).toMatchObject({
      total: 0,
      checked: 0,
      pulse: null,
      status: 'Unknown'
    });
  });
});

// ─── computePulse (pure) ──────────────────────────────────────────────────────
// The banding/coverage logic shared by the read-time pulse and the snapshot
// capture (#75). getCommunityHealthPulse exercises it above; these lock the
// pure contract directly.

describe('computePulse', () => {
  it('bands Healthy at/above the healthy threshold', () => {
    expect(
      computePulse({ pass: 9, warn: 0, fail: 1, unknown: 0 })
    ).toMatchObject({
      checked: 10,
      total: 10,
      coverage: 1,
      pulse: 0.9,
      status: 'Healthy'
    });
  });

  it('bands Critical when failures dominate', () => {
    const r = computePulse({ pass: 1, warn: 0, fail: 9, unknown: 0 });
    expect(r.pulse).toBeCloseTo(0.1);
    expect(r.status).toBe('Critical');
  });

  it('withholds a band as Unknown below the coverage floor', () => {
    const r = computePulse({ pass: 1, warn: 0, fail: 0, unknown: 99 });
    expect(r.pulse).toBe(1);
    expect(r.coverage).toBeCloseTo(0.01);
    expect(r.status).toBe('Unknown');
  });

  it('returns null pulse/coverage for empty counts', () => {
    expect(
      computePulse({ pass: 0, warn: 0, fail: 0, unknown: 0 })
    ).toMatchObject({
      total: 0,
      checked: 0,
      coverage: null,
      pulse: null,
      status: 'Unknown'
    });
  });
});

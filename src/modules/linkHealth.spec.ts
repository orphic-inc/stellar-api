/**
 * Unit tests for link-health: the WARN->FAIL sweep + transition stamping, and
 * the community pulse (aggregate heartbeat over per-contribution linkStatus).
 * DB + fetch are mocked.
 */

import { LinkHealthStatus } from '@prisma/client';

const mockPrismaContribution = {
  findUnique: jest.fn(),
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

import {
  sweepStaleWarnLinks,
  checkContributionLink,
  getCommunityHealthPulse
} from './linkHealth';

// ─── sweepStaleWarnLinks ──────────────────────────────────────────────────────

describe('sweepStaleWarnLinks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('promotes WARN links stuck past the 72h window to FAIL', async () => {
    mockPrismaContribution.updateMany.mockResolvedValue({ count: 2 });
    await sweepStaleWarnLinks();
    expect(mockPrismaContribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          linkStatus: 'WARN',
          linkStatusChangedAt: expect.objectContaining({ lt: expect.any(Date) })
        }),
        data: expect.objectContaining({ linkStatus: 'FAIL' })
      })
    );
  });

  it('uses a cutoff ~72h in the past (not last-checked, but stuck-since)', async () => {
    mockPrismaContribution.updateMany.mockResolvedValue({ count: 0 });
    await sweepStaleWarnLinks();
    const arg = mockPrismaContribution.updateMany.mock.calls[0][0];
    const cutoff: Date = arg.where.linkStatusChangedAt.lt;
    const ageHours = (Date.now() - cutoff.getTime()) / 3_600_000;
    expect(ageHours).toBeGreaterThan(71);
    expect(ageHours).toBeLessThan(73);
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
      linkStatusChangedAt: new Date('2020-01-01')
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatus).toBe('PASS');
    expect(data.linkStatusChangedAt).toBeInstanceOf(Date);
  });

  it('does not re-stamp when status is unchanged and already stamped', async () => {
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'PASS',
      linkStatusChangedAt: new Date('2020-01-01')
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatus).toBe('PASS');
    expect(data.linkStatusChangedAt).toBeUndefined();
  });

  it('initializes the clock when it has never been stamped (backfill case)', async () => {
    mockPrismaContribution.findUnique.mockResolvedValue({
      downloadUrl: 'http://example.test/x',
      linkStatus: 'PASS',
      linkStatusChangedAt: null
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await checkContributionLink(5);
    const { data } = mockPrismaContribution.update.mock.calls[0][0];
    expect(data.linkStatusChangedAt).toBeInstanceOf(Date);
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

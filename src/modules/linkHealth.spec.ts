/**
 * Unit tests for the link-health WARN->FAIL sweep and transition stamping.
 * DB + fetch are mocked.
 */

const mockPrismaContribution = {
  findUnique: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn()
};

jest.mock('../lib/prisma', () => ({
  prisma: { contribution: mockPrismaContribution }
}));

jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

import { sweepStaleWarnLinks, checkContributionLink } from './linkHealth';

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

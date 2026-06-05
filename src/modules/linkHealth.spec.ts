/**
 * Unit tests for the LinkHealth community pulse — the aggregate "heartbeat"
 * that rolls per-contribution linkStatus up to a community-level health signal.
 */

import { LinkHealthStatus } from '@prisma/client';

const prismaMock = {
  contribution: {
    groupBy: jest.fn()
  }
};

jest.mock('../lib/prisma', () => ({ prisma: prismaMock }));
jest.mock('./logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

import { getCommunityHealthPulse } from './linkHealth';

// Shape rows the way prisma.contribution.groupBy(by: ['linkStatus']) returns them.
const groupRows = (counts: Partial<Record<LinkHealthStatus, number>>) =>
  Object.entries(counts).map(([linkStatus, n]) => ({
    linkStatus: linkStatus as LinkHealthStatus,
    _count: { _all: n }
  }));

describe('getCommunityHealthPulse', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads Unknown with a null pulse when nothing has been checked yet', async () => {
    prismaMock.contribution.groupBy.mockResolvedValue(groupRows({ UNKNOWN: 5 }));

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
    prismaMock.contribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 8, UNKNOWN: 2 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBe(1);
    expect(r.status).toBe('Healthy');
    expect(r.checked).toBe(8);
    expect(r.total).toBe(10);
  });

  it('computes the pass ratio over checked links, excluding UNKNOWN', async () => {
    prismaMock.contribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 6, WARN: 2, FAIL: 2 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBe(0.6); // 6 / (6 + 2 + 2)
    expect(r.status).toBe('Ailing'); // >= 0.6
  });

  it('reads Critical when failures dominate', async () => {
    prismaMock.contribution.groupBy.mockResolvedValue(
      groupRows({ PASS: 1, FAIL: 9 })
    );

    const r = await getCommunityHealthPulse(1);

    expect(r.pulse).toBeCloseTo(0.1);
    expect(r.status).toBe('Critical');
  });

  it('returns a null pulse for a community with no contributions', async () => {
    prismaMock.contribution.groupBy.mockResolvedValue([]);

    const r = await getCommunityHealthPulse(1);

    expect(r).toMatchObject({
      total: 0,
      checked: 0,
      pulse: null,
      status: 'Unknown'
    });
  });
});

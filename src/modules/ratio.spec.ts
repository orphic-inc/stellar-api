/**
 * Unit tests for the ratio calculation module.
 * DB-dependent functions use a Prisma mock.
 */

const mockPrismaUser = { findUnique: jest.fn() };
const mockPrismaContribution = { findMany: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    contribution: mockPrismaContribution
  }
}));

import {
  computeRatio,
  getDownloadBracket,
  computeRequiredRatio,
  getEligibleContributionBytes,
  getRatioStats
} from './ratio';

const GiB = BigInt(1024 ** 3);

// ─── computeRatio ─────────────────────────────────────────────────────────────

describe('computeRatio', () => {
  it('returns 1.0 when downloaded is 0', () => {
    expect(computeRatio(0n, 0n)).toBe(1.0);
    expect(computeRatio(500n * GiB, 0n)).toBe(1.0);
  });

  it('returns totalEarned / downloaded', () => {
    expect(computeRatio(10n * GiB, 10n * GiB)).toBeCloseTo(1.0);
    expect(computeRatio(5n * GiB, 10n * GiB)).toBeCloseTo(0.5);
    expect(computeRatio(0n, 10n * GiB)).toBeCloseTo(0.0);
  });
});

// ─── getDownloadBracket ───────────────────────────────────────────────────────

describe('getDownloadBracket', () => {
  it('0 downloaded → 0–5 GiB bracket (no requirement)', () => {
    const b = getDownloadBracket(0n);
    expect(b.maxRequired).toBe(0);
    expect(b.minRequired).toBe(0);
    expect(b.label).toBe('0–5 GiB');
  });

  it('exactly 5 GiB → 5–10 GiB bracket', () => {
    const b = getDownloadBracket(5n * GiB);
    expect(b.maxRequired).toBe(0.15);
    expect(b.label).toBe('5–10 GiB');
  });

  it('25 GiB → 20–30 GiB bracket', () => {
    const b = getDownloadBracket(25n * GiB);
    expect(b.maxRequired).toBe(0.3);
    expect(b.minRequired).toBe(0.05);
  });

  it('200 GiB → 100+ GiB bracket (max requirement)', () => {
    const b = getDownloadBracket(200n * GiB);
    expect(b.maxRequired).toBe(0.6);
    expect(b.minRequired).toBe(0.6);
    expect(b.label).toBe('100+ GiB');
  });
});

// ─── computeRequiredRatio ─────────────────────────────────────────────────────

describe('computeRequiredRatio', () => {
  it('returns 0 in the free bracket (0–5 GiB)', () => {
    expect(computeRequiredRatio(1n * GiB, 0n)).toBe(0);
  });

  it('full contribution coverage halves the requirement toward minRequired', () => {
    // 10 GiB downloaded, 10 GiB eligible: coverage = 1.0
    // bracket 5–10 GiB: max 0.15, min 0.00
    // required = max(0.00, 0.15 * (1 - 1.0)) = 0
    expect(computeRequiredRatio(10n * GiB, 10n * GiB)).toBe(0);
  });

  it('zero coverage returns maxRequired', () => {
    // 7 GiB downloaded (in 5–10 GiB bracket), 0 eligible: coverage = 0.0
    // bracket max 0.15, min 0.00
    expect(computeRequiredRatio(7n * GiB, 0n)).toBeCloseTo(0.15);
  });

  it('partial coverage interpolates correctly', () => {
    // 15 GiB downloaded (10–20 GiB bracket: max 0.20, min 0.00)
    // 7.5 GiB eligible: coverage = 0.5
    // required = max(0.00, 0.20 * 0.5) = 0.10
    expect(
      computeRequiredRatio(15n * GiB, BigInt(Math.round(7.5 * 1024 ** 3)))
    ).toBeCloseTo(0.1);
  });

  it('minRequired clamps the result from going below minimum', () => {
    // 100+ GiB: max 0.60, min 0.60 — coverage cannot reduce below 0.60
    expect(computeRequiredRatio(150n * GiB, 150n * GiB)).toBeCloseTo(0.6);
  });
});

// ─── getEligibleContributionBytes ─────────────────────────────────────────────

describe('getEligibleContributionBytes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sums approvedAccountingBytes when set', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([
      { sizeInBytes: 100, approvedAccountingBytes: BigInt('500000000') },
      { sizeInBytes: null, approvedAccountingBytes: BigInt('200000000') }
    ]);
    const result = await getEligibleContributionBytes(1);
    expect(result).toBe(BigInt('700000000'));
  });

  it('returns 0 when no contributions have approvedAccountingBytes (query already filters them)', async () => {
    // Prisma filters out null approvedAccountingBytes before returning results
    mockPrismaContribution.findMany.mockResolvedValue([]);
    const result = await getEligibleContributionBytes(1);
    expect(result).toBe(0n);
  });

  it('returns 0n when user has no contributions', async () => {
    mockPrismaContribution.findMany.mockResolvedValue([]);
    const result = await getEligibleContributionBytes(1);
    expect(result).toBe(0n);
  });
});

// ─── getRatioStats ────────────────────────────────────────────────────────────

describe('getRatioStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns correct stats for a user with no downloads', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      totalEarned: 0n,
      downloaded: 0n
    });
    mockPrismaContribution.findMany.mockResolvedValue([]);

    const stats = await getRatioStats(1);

    expect(stats.ratio).toBe(1.0);
    expect(stats.requiredRatio).toBe(0);
    expect(stats.meetsRequirement).toBe(true);
    expect(stats.contributionCoverage).toBe(1.0);
  });

  it('correctly identifies a user who fails the requirement', async () => {
    // 7 GiB downloaded (5–10 GiB bracket), 0 earned, 0 eligible contributions
    mockPrismaUser.findUnique.mockResolvedValue({
      totalEarned: 0n,
      downloaded: 7n * GiB
    });
    mockPrismaContribution.findMany.mockResolvedValue([]);

    const stats = await getRatioStats(1);

    expect(stats.ratio).toBeCloseTo(0.0);
    expect(stats.requiredRatio).toBeCloseTo(0.15); // 5–10 GiB bracket, 0 coverage
    expect(stats.meetsRequirement).toBe(false);
  });

  it('serializes BigInts as strings', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      totalEarned: 5n * GiB,
      downloaded: 10n * GiB
    });
    mockPrismaContribution.findMany.mockResolvedValue([]);

    const stats = await getRatioStats(1);

    expect(typeof stats.totalEarned).toBe('string');
    expect(typeof stats.downloaded).toBe('string');
    expect(typeof stats.eligibleContributionBytes).toBe('string');
  });
});

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
  getConsumptionBracket,
  computeRequiredRatio,
  getEligibleContributionBytes,
  getRatioStats
} from './ratio';
import { AppError } from '../lib/errors';

const GiB = BigInt(1024 ** 3);

// ─── computeRatio ─────────────────────────────────────────────────────────────

describe('computeRatio', () => {
  it('returns 1.0 when downloaded is 0', () => {
    expect(computeRatio(0n, 0n)).toBe(1.0);
    expect(computeRatio(500n * GiB, 0n)).toBe(1.0);
  });

  it('returns contributed / consumed', () => {
    expect(computeRatio(10n * GiB, 10n * GiB)).toBeCloseTo(1.0);
    expect(computeRatio(5n * GiB, 10n * GiB)).toBeCloseTo(0.5);
    expect(computeRatio(0n, 10n * GiB)).toBeCloseTo(0.0);
  });
});

// ─── getConsumptionBracket ───────────────────────────────────────────────────────

describe('getConsumptionBracket', () => {
  it('0 downloaded → 0–5 GiB bracket (no requirement)', () => {
    const b = getConsumptionBracket(0n);
    expect(b.maxRequired).toBe(0);
    expect(b.minRequired).toBe(0);
    expect(b.label).toBe('0–5 GiB');
  });

  it('exactly 5 GiB → 5–10 GiB bracket', () => {
    const b = getConsumptionBracket(5n * GiB);
    expect(b.maxRequired).toBe(0.15);
    expect(b.label).toBe('5–10 GiB');
  });

  it('25 GiB → 20–30 GiB bracket', () => {
    const b = getConsumptionBracket(25n * GiB);
    expect(b.maxRequired).toBe(0.3);
    expect(b.minRequired).toBe(0.05);
  });

  it('200 GiB → 100+ GiB bracket (max requirement)', () => {
    const b = getConsumptionBracket(200n * GiB);
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

  it('excludes FAIL-status contributions from the relief pool (ADR-0006)', async () => {
    // The LinkHealth gate is enforced in the query: a confirmed-dead link
    // (FAIL) must not count toward coverage. WARN/UNKNOWN are NOT excluded —
    // suspicion alone never revokes relief.
    mockPrismaContribution.findMany.mockResolvedValue([]);
    await getEligibleContributionBytes(1);
    expect(mockPrismaContribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          approvedAccountingBytes: { not: null },
          linkStatus: { not: 'FAIL' }
        })
      })
    );
  });

  it('relief is revocable: losing a contribution to FAIL raises required ratio', () => {
    // 15 GiB consumed (10–20 GiB bracket: max 0.20). With 7.5 GiB eligible,
    // coverage 0.5 → required 0.10. If that contribution flips FAIL it leaves
    // the pool (eligible → 0), coverage 0 → required rises to the 0.20 ceiling.
    const consumed = 15n * GiB;
    const withHealthyLink = BigInt(Math.round(7.5 * 1024 ** 3));
    expect(computeRequiredRatio(consumed, withHealthyLink)).toBeCloseTo(0.1);
    expect(computeRequiredRatio(consumed, 0n)).toBeCloseTo(0.2);
  });
});

// ─── getRatioStats ────────────────────────────────────────────────────────────

describe('getRatioStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns correct stats for a user with no downloads', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      contributed: 0n,
      consumed: 0n
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
      contributed: 0n,
      consumed: 7n * GiB
    });
    mockPrismaContribution.findMany.mockResolvedValue([]);

    const stats = await getRatioStats(1);

    expect(stats.ratio).toBeCloseTo(0.0);
    expect(stats.requiredRatio).toBeCloseTo(0.15); // 5–10 GiB bracket, 0 coverage
    expect(stats.meetsRequirement).toBe(false);
  });

  it('serializes BigInts as strings', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      contributed: 5n * GiB,
      consumed: 10n * GiB
    });
    mockPrismaContribution.findMany.mockResolvedValue([]);

    const stats = await getRatioStats(1);

    expect(typeof stats.contributed).toBe('string');
    expect(typeof stats.consumed).toBe('string');
    expect(typeof stats.eligibleContributionBytes).toBe('string');
  });

  it('throws AppError(404) when the user is missing (#233)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);

    await expect(getRatioStats(1)).rejects.toThrow(AppError);
    await expect(getRatioStats(1)).rejects.toMatchObject({
      statusCode: 404,
      message: 'User not found'
    });
  });
});

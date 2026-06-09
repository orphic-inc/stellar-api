/**
 * Unit tests for the Community Reputation Score (CRS) module.
 * computeCrs is pure; getReputation uses a Prisma mock.
 */

const mockPrismaUser = { findUnique: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: { user: mockPrismaUser }
}));

import { computeCrs, getReputation } from './reputation';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-08T00:00:00Z');
const yearsAgo = (n: number): Date => new Date(NOW.getTime() - n * YEAR_MS);

// ─── computeCrs / LongevityScore ──────────────────────────────────────────────

describe('computeCrs — Longevity dimension', () => {
  it('a brand-new account scores ~0 longevity', () => {
    const { score, dimensions } = computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW
    });
    const longevity = dimensions.find((d) => d.name === 'longevity')!;
    expect(longevity.subScore).toBeCloseTo(0, 5);
    expect(score).toBeCloseTo(0, 5);
  });

  it('rewards age with diminishing returns (~63% of cap at TAU=3y)', () => {
    const { dimensions } = computeCrs({
      userId: 1,
      createdAt: yearsAgo(3),
      now: NOW
    });
    const longevity = dimensions.find((d) => d.name === 'longevity')!;
    // cap 10, asymptotic: 10 * (1 - e^-1) ≈ 6.32
    expect(longevity.subScore).toBeCloseTo(6.32, 1);
  });

  it('each year is worth less than the last (concave)', () => {
    const at = (y: number) =>
      computeCrs({ userId: 1, createdAt: yearsAgo(y), now: NOW }).score;
    const gain1 = at(1) - at(0);
    const gain5 = at(5) - at(4);
    expect(gain5).toBeLessThan(gain1);
  });

  it('is bounded: even an ancient account stays at or below the cap', () => {
    const { dimensions } = computeCrs({
      userId: 1,
      createdAt: yearsAgo(100),
      now: NOW
    });
    const longevity = dimensions.find((d) => d.name === 'longevity')!;
    expect(longevity.subScore).toBeLessThanOrEqual(10);
    expect(longevity.subScore).toBeGreaterThan(9.9);
  });

  it('clamps negative age (createdAt in the future) to 0', () => {
    const { score } = computeCrs({
      userId: 1,
      createdAt: new Date(NOW.getTime() + YEAR_MS),
      now: NOW
    });
    expect(score).toBeCloseTo(0, 5);
  });

  it('score is the sum of weighted dimensions', () => {
    const { score, dimensions } = computeCrs({
      userId: 1,
      createdAt: yearsAgo(4),
      now: NOW
    });
    const expected = dimensions.reduce((s, d) => s + d.weighted, 0);
    expect(score).toBeCloseTo(expected, 10);
  });
});

// ─── getReputation (read-time assembler) ──────────────────────────────────────

describe('getReputation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('computes CRS from the user createdAt', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ createdAt: yearsAgo(6) });
    const result = await getReputation(1);
    expect(result.score).toBeGreaterThan(0);
    expect(result.dimensions.map((d) => d.name)).toContain('longevity');
  });

  it('returns an empty score for an unknown user', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    const result = await getReputation(999);
    expect(result).toEqual({ score: 0, dimensions: [] });
  });
});

/**
 * Unit tests for the Community Reputation Score (CRS) module.
 * computeCrs is pure; getReputation uses a Prisma mock.
 */

const mockPrismaUser = { findUnique: jest.fn() };
const mockPrismaFriend = { count: jest.fn() };
const mockPrismaIrcActivity = { findMany: jest.fn() };
const mockPrismaEconomy = { count: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    friend: mockPrismaFriend,
    ircActivity: mockPrismaIrcActivity,
    economyTransaction: mockPrismaEconomy
  }
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

// ─── computeCrs / Ratio dimension ─────────────────────────────────────────────

describe('computeCrs — Ratio dimension', () => {
  const ratioOf = (input: Parameters<typeof computeCrs>[0]) =>
    computeCrs(input).dimensions.find((d) => d.name === 'ratio')!.subScore;

  it('earns nothing without demonstrated contribution (fresh default account)', () => {
    // default ratio 1.0, contributed 0 → no ratio reputation
    expect(ratioOf({ userId: 1, createdAt: NOW, now: NOW })).toBe(0);
    expect(
      ratioOf({
        userId: 1,
        createdAt: NOW,
        now: NOW,
        ratio: 1,
        contributed: 0n
      })
    ).toBe(0);
  });

  it('rewards a net contributor, diminishing returns toward the cap', () => {
    const contributed = 1n;
    const low = ratioOf({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ratio: 1,
      contributed
    });
    const high = ratioOf({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ratio: 4,
      contributed
    });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(8); // cap
  });

  it('is bounded even for an enormous ratio', () => {
    const sub = ratioOf({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ratio: 1000,
      contributed: 1n
    });
    expect(sub).toBeLessThanOrEqual(8);
    expect(sub).toBeGreaterThan(7.9);
  });
});

// ─── computeCrs / Friends dimension ───────────────────────────────────────────

describe('computeCrs — Friends dimension', () => {
  const friendsOf = (friendCount: number) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      friendCount
    }).dimensions.find((d) => d.name === 'friends')!.subScore;

  it('zero friends → zero', () => {
    expect(friendsOf(0)).toBe(0);
  });

  it('more friends help, with diminishing returns', () => {
    expect(friendsOf(5)).toBeGreaterThan(friendsOf(2));
    expect(friendsOf(20) - friendsOf(15)).toBeLessThan(
      friendsOf(5) - friendsOf(0)
    );
  });

  it('count cannot dominate: even thousands of friends stay under the low cap', () => {
    // FRIENDS_CAP = 4, far below longevity (10) / ratio (8) — count alone can't win
    expect(friendsOf(10_000)).toBeLessThanOrEqual(4);
    expect(friendsOf(10_000)).toBeGreaterThan(3.9);
  });
});

// ─── StylesheetScore dimension ────────────────────────────────────────────────

describe('computeCrs — Stylesheet dimension', () => {
  const styleOf = (stylesheetAdoptions: number): number =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      stylesheetAdoptions
    }).dimensions.find((d) => d.name === 'stylesheet')!.subScore;

  it('an author with no adoptions scores 0', () => {
    expect(styleOf(0)).toBeCloseTo(0, 10);
  });

  it('rises with each distinct adoption', () => {
    expect(styleOf(3)).toBeGreaterThan(styleOf(1));
    expect(styleOf(1)).toBeGreaterThan(0);
  });

  it('is bounded: mass adoption cannot dominate (STYLESHEET_CAP = 6)', () => {
    expect(styleOf(1000)).toBeLessThanOrEqual(6);
  });
});

// ─── getReputation (read-time assembler) ──────────────────────────────────────

describe('getReputation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaIrcActivity.findMany.mockResolvedValue([]);
    mockPrismaEconomy.count.mockResolvedValue(0);
  });

  it('computes CRS from the user createdAt + ratio + friends', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: yearsAgo(6),
      contributed: 30n * 1024n ** 3n,
      consumed: 10n * 1024n ** 3n // ratio 3.0
    });
    mockPrismaFriend.count.mockResolvedValue(5);
    const result = await getReputation(1);
    expect(result.score).toBeGreaterThan(0);
    expect(result.dimensions.map((d) => d.name)).toEqual(
      expect.arrayContaining(['longevity', 'ratio'])
    );
    expect(
      result.dimensions.find((d) => d.name === 'ratio')!.subScore
    ).toBeGreaterThan(0);
    expect(
      result.dimensions.find((d) => d.name === 'friends')!.subScore
    ).toBeGreaterThan(0);
  });

  it('returns an empty score for an unknown user', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    mockPrismaFriend.count.mockResolvedValue(0);
    const result = await getReputation(999);
    expect(result).toEqual({ score: 0, dimensions: [] });
  });

  it('reflects stylesheet adoptions from the CRS_* ledger count', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    mockPrismaEconomy.count.mockResolvedValue(4); // 4 distinct adopters

    const result = await getReputation(1);

    expect(mockPrismaEconomy.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, reason: 'CRS_STYLESHEET_ADOPTION' }
      })
    );
    expect(
      result.dimensions.find((d) => d.name === 'stylesheet')!.subScore
    ).toBeGreaterThan(0);
  });
});

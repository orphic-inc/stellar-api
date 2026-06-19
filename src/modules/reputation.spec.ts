/**
 * Unit tests for the Community Reputation Score (CRS) module.
 * computeCrs is pure; getReputation uses a Prisma mock.
 */

const mockPrismaUser = { findUnique: jest.fn() };
const mockPrismaFriend = { count: jest.fn() };
const mockPrismaEconomy = { count: jest.fn() };
const mockPrismaInviteTree = { findMany: jest.fn() };
const mockPrismaDonation = { aggregate: jest.fn() };
const mockPrismaCommunitySnapshot = { findMany: jest.fn() };
const mockPrismaContribution = { findMany: jest.fn() };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    friendRelationship: mockPrismaFriend,
    economyTransaction: mockPrismaEconomy,
    inviteTree: mockPrismaInviteTree,
    donation: mockPrismaDonation,
    communityHealthSnapshot: mockPrismaCommunitySnapshot,
    contribution: mockPrismaContribution
  }
}));

// A donation aggregate with no rows.
const emptyDonationAgg = {
  _count: { _all: 0 },
  _min: { donatedAt: null },
  _max: { donatedAt: null }
};

import { computeCrs, getReputation, filterReputationView } from './reputation';

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
    // The friend-count signal asymptotes to FRIENDS_CAP = 4 — count alone can't win
    expect(friendsOf(10_000)).toBeLessThanOrEqual(4);
    expect(friendsOf(10_000)).toBeGreaterThan(3.9);
  });

  // Friends × Stylesheet controlled vector (#147)
  const friendsFull = (input: Partial<Parameters<typeof computeCrs>[0]>) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ...input
    }).dimensions.find((d) => d.name === 'friends')!.subScore;

  it('adoption is a weak-tie nudge additive to the friend-count signal', () => {
    const base = friendsFull({ friendCount: 5 });
    const withAdoption = friendsFull({
      friendCount: 5,
      stylesheetAdoptionsMade: 2,
      stylesheetAdoptions: 1
    });
    // adopter 2×0.2 + author 1×0.1 = 0.5 added on top of the friend signal
    expect(withAdoption - base).toBeCloseTo(0.5, 10);
  });

  it('adopter is weighted above author (favour active curation)', () => {
    expect(friendsFull({ stylesheetAdoptionsMade: 1 })).toBeGreaterThan(
      friendsFull({ stylesheetAdoptions: 1 })
    );
  });

  it('the vector is bounded: mass adoption flattens out (ADOPTION_VECTOR_CAP = 2)', () => {
    // 1000 adoptions as adopter would be 200 unbounded; capped at 2.
    expect(friendsFull({ stylesheetAdoptionsMade: 1000 })).toBeCloseTo(2, 10);
  });

  it('friend-count + adoption together stay within the dimension cap (6)', () => {
    expect(
      friendsFull({ friendCount: 10_000, stylesheetAdoptionsMade: 1000 })
    ).toBeLessThanOrEqual(6);
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

// ─── computeCrs / Invite dimension ────────────────────────────────────────────

describe('computeCrs — Invite dimension', () => {
  const inviteOf = (input: Partial<Parameters<typeof computeCrs>[0]>) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ...input
    }).dimensions.find((d) => d.name === 'invite')!.subScore;

  it('no invitees → 0', () => {
    expect(inviteOf({})).toBe(0);
  });

  it('active + contributing invitees raise it, with diminishing returns', () => {
    expect(inviteOf({ inviteActiveContributing: 4 })).toBeGreaterThan(
      inviteOf({ inviteActiveContributing: 1 })
    );
    const gainEarly = inviteOf({ inviteActiveContributing: 1 }) - inviteOf({});
    const gainLate =
      inviteOf({ inviteActiveContributing: 20 }) -
      inviteOf({ inviteActiveContributing: 19 });
    expect(gainLate).toBeLessThan(gainEarly);
  });

  it('long-lived invitees add a weaker positive than active+contributing', () => {
    expect(inviteOf({ inviteLongLived: 1 })).toBeGreaterThan(0);
    expect(inviteOf({ inviteActiveContributing: 1 })).toBeGreaterThan(
      inviteOf({ inviteLongLived: 1 })
    );
  });

  it('banned and low-quality invitees erode the positive', () => {
    const clean = inviteOf({ inviteActiveContributing: 4 });
    expect(
      inviteOf({ inviteActiveContributing: 4, inviteBanned: 2 })
    ).toBeLessThan(clean);
    expect(
      inviteOf({ inviteActiveContributing: 4, inviteLowQuality: 2 })
    ).toBeLessThan(clean);
  });

  it('net is floored at 0 — invite abuse cannot push the dimension negative', () => {
    expect(inviteOf({ inviteActiveContributing: 1, inviteBanned: 100 })).toBe(
      0
    );
  });

  it('is bounded by INVITE_CAP = 5', () => {
    expect(inviteOf({ inviteActiveContributing: 10_000 })).toBeLessThanOrEqual(
      5
    );
    expect(inviteOf({ inviteActiveContributing: 10_000 })).toBeGreaterThan(4.9);
  });
});

// ─── computeCrs / Donation dimension ──────────────────────────────────────────

describe('computeCrs — Donation dimension', () => {
  const donationOf = (input: Partial<Parameters<typeof computeCrs>[0]>) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      ...input
    }).dimensions.find((d) => d.name === 'donation')!.subScore;

  it('no donations → 0', () => {
    expect(donationOf({})).toBe(0);
  });

  it('more donations raise it (consistency), with diminishing returns', () => {
    expect(donationOf({ donationCount: 5 })).toBeGreaterThan(
      donationOf({ donationCount: 1 })
    );
    const gainEarly = donationOf({ donationCount: 1 }) - donationOf({});
    const gainLate =
      donationOf({ donationCount: 50 }) - donationOf({ donationCount: 49 });
    expect(gainLate).toBeLessThan(gainEarly);
  });

  it('a longer support span raises it (longevity)', () => {
    expect(donationOf({ donationSpanYears: 4 })).toBeGreaterThan(
      donationOf({ donationSpanYears: 1 })
    );
  });

  it('is amount-agnostic: amount is not even an input (recognition, not pay-to-win)', () => {
    // The only donation inputs are count + span. Identical count/span ⇒ identical
    // score regardless of any dollar value, which the scorer never sees.
    expect(donationOf({ donationCount: 3, donationSpanYears: 2 })).toBe(
      donationOf({ donationCount: 3, donationSpanYears: 2 })
    );
  });

  it('is bounded by DONATION_CAP = 3 — the lowest dimension cap', () => {
    expect(
      donationOf({ donationCount: 10_000, donationSpanYears: 10_000 })
    ).toBeLessThanOrEqual(3);
  });
});

// ─── computeCrs / Community dimension ─────────────────────────────────────────

describe('computeCrs — Community dimension', () => {
  const healthy = (weight: number) => ({
    pulse: 1.0,
    coverage: 0.9,
    weight
  });
  const critical = (weight: number) => ({
    pulse: 0.0,
    coverage: 0.9,
    weight
  });
  const communityOf = (
    communityHealth: NonNullable<
      Parameters<typeof computeCrs>[0]['communityHealth']
    >
  ) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      communityHealth
    }).dimensions.find((d) => d.name === 'community')!.subScore;

  it('no contributed-to communities → 0', () => {
    expect(communityOf([])).toBe(0);
  });

  it('a fully-healthy community rewards up to the positive cap (+4)', () => {
    expect(communityOf([healthy(5)])).toBeCloseTo(4, 10);
  });

  it('a critical community penalises down to the soft floor (−1)', () => {
    expect(communityOf([critical(5)])).toBeCloseTo(-1, 10);
  });

  it('is neutral at the Critical-edge pulse 0.60', () => {
    expect(communityOf([{ pulse: 0.6, coverage: 0.9, weight: 5 }])).toBeCloseTo(
      0,
      10
    );
  });

  it('excludes Unknown communities (coverage below 0.5)', () => {
    // The only community is unprobed → no signal, term 0.
    expect(communityOf([{ pulse: 0.2, coverage: 0.4, weight: 5 }])).toBe(0);
  });

  it('weights by the member’s quality stake (heavier weight dominates)', () => {
    // 9× weight healthy (+4), 1× weight critical (−1): (9·4 + 1·−1)/10 = 3.5
    expect(communityOf([healthy(9), critical(1)])).toBeCloseTo(3.5, 10);
    // The same two communities, but the member's quality investment is reversed:
    // now the critical one carries the heavier weight → the average flips negative-ward.
    expect(communityOf([healthy(1), critical(9)])).toBeCloseTo(-0.5, 10);
  });

  it('stays bounded in [−1, +4]', () => {
    expect(communityOf([healthy(10_000), healthy(5)])).toBeLessThanOrEqual(4);
    expect(communityOf([critical(10_000), critical(5)])).toBeGreaterThanOrEqual(
      -1
    );
  });
});

// ─── signed dimension floor (aggregator) ──────────────────────────────────────

describe('computeCrs — signed dimension floor', () => {
  it('keeps a negative subScore instead of clamping it to 0', () => {
    const community = computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      communityHealth: [{ pulse: 0.0, coverage: 0.9, weight: 1 }]
    }).dimensions.find((d) => d.name === 'community')!;
    // Without the floor the clamp would force this to 0; with floor −1 it survives.
    expect(community.subScore).toBe(-1);
    expect(community.weighted).toBe(-1);
  });
});

// ─── getReputation (read-time assembler) ──────────────────────────────────────

describe('getReputation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaEconomy.count.mockResolvedValue(0);
    mockPrismaInviteTree.findMany.mockResolvedValue([]);
    mockPrismaDonation.aggregate.mockResolvedValue(emptyDonationAgg);
    mockPrismaContribution.findMany.mockResolvedValue([]);
    mockPrismaCommunitySnapshot.findMany.mockResolvedValue([]);
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

  it('classifies direct invitees into the Invite signals and scores them', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    const oldEnough = new Date(NOW.getTime() - 3 * YEAR_MS);
    mockPrismaInviteTree.findMany.mockResolvedValue([
      // active + contributing + long-lived, no warnings, recent login
      {
        user: {
          disabled: false,
          contributed: 5n,
          dateRegistered: oldEnough,
          lastLogin: NOW,
          warnings: []
        }
      },
      // banned — counts only as a negative
      {
        user: {
          disabled: true,
          contributed: 9n,
          dateRegistered: oldEnough,
          lastLogin: NOW,
          warnings: []
        }
      }
    ]);

    const result = await getReputation(1);

    expect(mockPrismaInviteTree.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { inviterId: 1 } })
    );
    expect(
      result.dimensions.find((d) => d.name === 'invite')!.subScore
    ).toBeGreaterThan(0);
  });

  it('quality-grades contributions into the signed Community dimension weight', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    // Two contributions to community 10: a Perfect flac rip (log+cue → 1.0) and
    // an mp3 with no bitrate (ungradeable → 0.3 fallback weight).
    mockPrismaContribution.findMany.mockResolvedValue([
      {
        type: 'flac',
        release: { communityId: 10 },
        releaseFile: { bitrate: null, hasLog: true, hasCue: true }
      },
      {
        type: 'mp3',
        release: { communityId: 10 },
        releaseFile: { bitrate: null, hasLog: false, hasCue: false }
      }
    ]);
    // ...reading Critical health → the dimension should go negative.
    mockPrismaCommunitySnapshot.findMany.mockResolvedValue([
      { communityId: 10, pulse: 0.1, coverage: 0.9 }
    ]);

    const result = await getReputation(1);

    expect(mockPrismaContribution.findMany).toHaveBeenCalled();
    expect(
      result.dimensions.find((d) => d.name === 'community')!.subScore
    ).toBeLessThan(0);
  });

  it('feeds DonationScore from the amount-agnostic aggregate (count + span)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    mockPrismaDonation.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _min: { donatedAt: new Date(NOW.getTime() - 2 * YEAR_MS) },
      _max: { donatedAt: NOW }
    });

    const result = await getReputation(1);

    expect(mockPrismaDonation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } })
    );
    expect(
      result.dimensions.find((d) => d.name === 'donation')!.subScore
    ).toBeGreaterThan(0);
  });

  it('reads the adopter side of the ledger for the Friends controlled vector (#147)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    mockPrismaEconomy.count.mockResolvedValue(3);

    const result = await getReputation(1);

    // Both ledger sides are queried: author (userId) and adopter (actorUserId).
    expect(mockPrismaEconomy.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { actorUserId: 1, reason: 'CRS_STYLESHEET_ADOPTION' }
      })
    );
    // With zero friends, a non-zero friends subScore can only come from the
    // adoption vector.
    expect(
      result.dimensions.find((d) => d.name === 'friends')!.subScore
    ).toBeGreaterThan(0);
  });
});

// ─── filterReputationView (paranoia-gated projection) ─────────────────────────

describe('filterReputationView', () => {
  const crs = {
    score: 12,
    dimensions: [
      { name: 'longevity', subScore: 6, weighted: 6 },
      { name: 'ratio', subScore: 4, weighted: 4 },
      { name: 'friends', subScore: 2, weighted: 2 }
    ]
  };

  it('passes through unchanged when snatch-derived dimensions are included', () => {
    expect(filterReputationView(crs, { includeSnatchDerived: true })).toBe(crs);
  });

  it('drops the ratio dimension and recomputes the score when excluded', () => {
    const view = filterReputationView(crs, { includeSnatchDerived: false });
    expect(view.dimensions.map((d) => d.name)).toEqual([
      'longevity',
      'friends'
    ]);
    // score recomputed from the remaining weighted subscores: 6 + 2 = 8
    expect(view.score).toBe(8);
  });

  it('is a no-op when there is no snatch-derived dimension present', () => {
    const noRatio = {
      score: 8,
      dimensions: [
        { name: 'longevity', subScore: 6, weighted: 6 },
        { name: 'friends', subScore: 2, weighted: 2 }
      ]
    };
    const view = filterReputationView(noRatio, { includeSnatchDerived: false });
    expect(view.dimensions).toHaveLength(2);
    expect(view.score).toBe(8);
  });
});

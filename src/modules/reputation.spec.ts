/**
 * Unit tests for the Community Reputation Score (CRS) module.
 * computeCrs is pure; getReputation uses a Prisma mock.
 */

const mockPrismaUser = { findUnique: jest.fn(), findMany: jest.fn() };
const mockPrismaQueryRaw = jest.fn();
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
    contribution: mockPrismaContribution,
    $queryRaw: mockPrismaQueryRaw
  }
}));

// The IRC dimension reads getIrcScore over the in-process metrics cache; mock
// it so computeCrs is deterministic without seeding the cache.
const mockGetIrcScore = jest.fn();
jest.mock('./irc', () => ({ getIrcScore: mockGetIrcScore }));

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

  const b = 0.1415926535 * 5; // SITE_BASE x5 — base author delta of the curve

  it('an author with no adoptions scores 0', () => {
    expect(styleOf(0)).toBeCloseTo(0, 10);
  });

  it('rises with each distinct adoption (back-loaded marginal curve, #121)', () => {
    expect(styleOf(3)).toBeGreaterThan(styleOf(1));
    expect(styleOf(1)).toBeGreaterThan(0);
  });

  it('tracks the tiering curve below the cap (15 adoptions ≈ 5.45)', () => {
    expect(styleOf(15)).toBeCloseTo((3 * 0.3 + 5 * 0.45 + 7 * 0.65) * b, 10);
  });

  it('clamps to STYLESHEET_CAP = 6 once the curve runs past it', () => {
    // Raw curve at 16 ≈ 6.05 and keeps climbing; the dimension cap holds it at 6.
    expect(styleOf(16)).toBeCloseTo(6, 10);
    expect(styleOf(30)).toBeCloseTo(6, 10);
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

// ─── computeCrs / InviteContagion dimension (#155) ────────────────────────────

describe('computeCrs — InviteContagion dimension', () => {
  const crsOf = (infectedAncestorDistances: number[]) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      infectedAncestorDistances
    });
  const contagionOf = (distances: number[]) =>
    crsOf(distances).dimensions.find((d) => d.name === 'inviteContagion')!
      .subScore;

  it('a clean genealogy has no drag and is not suspect', () => {
    expect(contagionOf([])).toBe(0);
    expect(crsOf([]).suspect).toBe(false);
  });

  it('drags negative, decaying with distance from the banned trunk', () => {
    expect(contagionOf([1])).toBeCloseTo(-1.0, 10);
    expect(contagionOf([2])).toBeCloseTo(-0.5, 10);
    expect(contagionOf([1])).toBeLessThan(contagionOf([2]));
  });

  it('lowers the total CRS by the drag', () => {
    expect(crsOf([1]).score).toBeLessThan(crsOf([]).score);
  });

  it('clamps to the dimension floor (−2.0)', () => {
    expect(contagionOf([1, 1, 1, 1])).toBe(-2);
  });

  it('sets suspect at/below the review threshold (−0.5)', () => {
    expect(crsOf([1]).suspect).toBe(true); // −1.0
    expect(crsOf([2]).suspect).toBe(true); // −0.5 boundary
    expect(crsOf([3]).suspect).toBe(false); // −0.25
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

describe('computeCrs — LinkHealth dimension', () => {
  const CAP = 8;
  const linkHealthOf = (
    linkHealthReliability: number,
    linkHealthYears: number
  ) =>
    computeCrs({
      userId: 1,
      createdAt: NOW,
      now: NOW,
      linkHealthReliability,
      linkHealthYears
    }).dimensions.find((d) => d.name === 'linkHealth')!.subScore;

  it('no contributions (R=0, H=0) → 0', () => {
    expect(linkHealthOf(0, 0)).toBe(0);
  });

  it('reliability leads: rotted links (R=0) score 0 no matter how much banked H', () => {
    expect(linkHealthOf(0, 100)).toBe(0);
  });

  it('volume gates: perfect reliability but ~no banked uptime (H≈0) ≈ 0', () => {
    // A fresh account that dumped links all PASS today: R≈1, H≈0 → can't farm it.
    expect(linkHealthOf(1, 0)).toBeCloseTo(0, 10);
    expect(linkHealthOf(1, 0.001)).toBeLessThan(0.01);
  });

  it('perfect reliability at H_TAU=3yr → ~63% of cap', () => {
    expect(linkHealthOf(1, 3)).toBeCloseTo(CAP * (1 - Math.exp(-1)), 6);
  });

  it('saturates toward cap 8 with sustained reliable uptime', () => {
    expect(linkHealthOf(1, 30)).toBeGreaterThan(7.9);
    expect(linkHealthOf(1, 30)).toBeLessThanOrEqual(CAP);
  });

  it('scales linearly with reliability (R halved → subScore halved)', () => {
    expect(linkHealthOf(0.5, 6)).toBeCloseTo(linkHealthOf(1, 6) / 2, 10);
  });

  it('clamps out-of-range reliability to [0,1]', () => {
    expect(linkHealthOf(2, 3)).toBeCloseTo(linkHealthOf(1, 3), 10);
    expect(linkHealthOf(-1, 3)).toBe(0);
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

// ─── computeCrs / IRC dimension (#141) ────────────────────────────────────────

describe('computeCrs — IRC dimension', () => {
  const ircOf = (input: Parameters<typeof computeCrs>[0]) =>
    computeCrs(input).dimensions.find((d) => d.name === 'irc')!;

  beforeEach(() => mockGetIrcScore.mockReset());

  it('scores 0 and never consults the scorer when the user has no linked nick', () => {
    expect(ircOf({ userId: 1, createdAt: NOW, now: NOW }).subScore).toBe(0);
    expect(mockGetIrcScore).not.toHaveBeenCalled();
  });

  it('scores 0 when the nick has no data in the current window (null)', () => {
    mockGetIrcScore.mockReturnValue(null);
    expect(
      ircOf({ userId: 1, createdAt: NOW, now: NOW, ircNick: 'ghost' }).subScore
    ).toBe(0);
    expect(mockGetIrcScore).toHaveBeenCalledWith('ghost');
  });

  it('scales the [0,1] raw score up to the dimension cap of 2', () => {
    mockGetIrcScore.mockReturnValue(1);
    const dim = ircOf({ userId: 1, createdAt: NOW, now: NOW, ircNick: 'nova' });
    expect(dim.subScore).toBe(2); // raw 1 × IRC_CAP 2
    expect(dim.weighted).toBe(2); // IRC_WEIGHT 1.0
  });

  it('scales a partial raw score proportionally within the cap', () => {
    mockGetIrcScore.mockReturnValue(0.5);
    expect(
      ircOf({ userId: 1, createdAt: NOW, now: NOW, ircNick: 'nova' }).subScore
    ).toBe(1); // 0.5 × 2
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
    mockPrismaQueryRaw.mockResolvedValue([]); // no infected ancestors (#155)
    mockPrismaUser.findMany.mockResolvedValue([]);
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
    expect(result).toEqual({ score: 0, dimensions: [], suspect: false });
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
        createdAt: NOW,
        linkStatus: 'UNKNOWN',
        healthyMs: 0n,
        healthySince: null,
        release: { communityId: 10 },
        releaseFile: { bitrate: null, hasLog: true, hasCue: true }
      },
      {
        type: 'mp3',
        createdAt: NOW,
        linkStatus: 'UNKNOWN',
        healthyMs: 0n,
        healthySince: null,
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

  it('derives link-health R/H from banked contribution uptime (#95)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    // A 2-year-old contribution that banked the full 2 years of PASS (link now
    // down, segment closed): R ≈ 1 over its 2y life, H ≈ 2 link-years. Dates are
    // Date.now()-relative because the assembler reads the real clock (not NOW).
    mockPrismaContribution.findMany.mockResolvedValue([
      {
        type: 'flac',
        createdAt: new Date(Date.now() - 2 * YEAR_MS),
        linkStatus: 'FAIL',
        healthyMs: BigInt(Math.round(2 * YEAR_MS)),
        healthySince: null,
        release: { communityId: null },
        releaseFile: null
      }
    ]);

    const result = await getReputation(1);

    // The fetch is widened to all of the user's contributions (no community filter).
    expect(mockPrismaContribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } })
    );
    const linkHealth = result.dimensions.find((d) => d.name === 'linkHealth')!;
    expect(linkHealth.subScore).toBeCloseTo(8 * (1 - Math.exp(-2 / 3)), 1);
  });

  it('counts the live open PASS segment (healthySince) at read time (#95)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    // Nothing banked, but PASS continuously since creation 1y ago — the live
    // segment alone must yield R ≈ 1, H ≈ 1, so the dimension is non-zero.
    mockPrismaContribution.findMany.mockResolvedValue([
      {
        type: 'flac',
        createdAt: new Date(NOW.getTime() - YEAR_MS),
        linkStatus: 'PASS',
        healthyMs: 0n,
        healthySince: new Date(NOW.getTime() - YEAR_MS),
        release: { communityId: null },
        releaseFile: null
      }
    ]);

    const result = await getReputation(1);
    expect(
      result.dimensions.find((d) => d.name === 'linkHealth')!.subScore
    ).toBeGreaterThan(0);
  });

  it('a dead link with no banked uptime drags link-health reliability to 0 (#95)', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({
      createdAt: NOW,
      contributed: 0n,
      consumed: 0n
    });
    mockPrismaFriend.count.mockResolvedValue(0);
    mockPrismaContribution.findMany.mockResolvedValue([
      {
        type: 'flac',
        createdAt: new Date(NOW.getTime() - 2 * YEAR_MS),
        linkStatus: 'FAIL',
        healthyMs: 0n,
        healthySince: null,
        release: { communityId: null },
        releaseFile: null
      }
    ]);

    const result = await getReputation(1);
    expect(
      result.dimensions.find((d) => d.name === 'linkHealth')!.subScore
    ).toBe(0);
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
    score: 11,
    dimensions: [
      { name: 'longevity', subScore: 6, weighted: 6 },
      { name: 'ratio', subScore: 4, weighted: 4 },
      { name: 'friends', subScore: 2, weighted: 2 },
      { name: 'inviteContagion', subScore: -1, weighted: -1 }
    ],
    suspect: true
  };

  it('passes through unchanged when both gates are open', () => {
    expect(
      filterReputationView(crs, {
        includeSnatchDerived: true,
        includeModeration: true
      })
    ).toBe(crs);
  });

  it('drops the ratio dimension and recomputes the score when snatch excluded', () => {
    const view = filterReputationView(crs, {
      includeSnatchDerived: false,
      includeModeration: true
    });
    expect(view.dimensions.map((d) => d.name)).toEqual([
      'longevity',
      'friends',
      'inviteContagion'
    ]);
    // recomputed from remaining weighted subscores: 6 + 2 − 1 = 7
    expect(view.score).toBe(7);
    expect(view.suspect).toBe(true); // moderation gate still open
  });

  it('hides the contagion drag + clears suspect when moderation excluded', () => {
    const view = filterReputationView(crs, {
      includeSnatchDerived: true,
      includeModeration: false
    });
    expect(view.dimensions.map((d) => d.name)).not.toContain('inviteContagion');
    // penalty stripped from the displayed total: 6 + 4 + 2 = 12
    expect(view.score).toBe(12);
    expect(view.suspect).toBe(false);
  });

  it('applies both gates together (member-facing, no ratio + no contagion)', () => {
    const view = filterReputationView(crs, {
      includeSnatchDerived: false,
      includeModeration: false
    });
    expect(view.dimensions.map((d) => d.name)).toEqual([
      'longevity',
      'friends'
    ]);
    expect(view.score).toBe(8); // 6 + 2
    expect(view.suspect).toBe(false);
  });

  it('is a no-op on score when neither hidden dimension is present', () => {
    const plain = {
      score: 8,
      dimensions: [
        { name: 'longevity', subScore: 6, weighted: 6 },
        { name: 'friends', subScore: 2, weighted: 2 }
      ],
      suspect: false
    };
    const view = filterReputationView(plain, {
      includeSnatchDerived: false,
      includeModeration: false
    });
    expect(view.dimensions).toHaveLength(2);
    expect(view.score).toBe(8);
  });
});

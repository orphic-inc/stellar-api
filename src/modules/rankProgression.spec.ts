/**
 * Unit tests for the rank-progression evaluator (USER_CLASSES_PLAN.md §6).
 *
 * The evaluator is pure — no DB, no I/O — so these tests need no Prisma mock.
 * They read against the default class ladder (DEFAULT_RANKS / DEFAULT_RULES).
 */
import {
  evaluateRankChange,
  isAdjacentPromotionStep,
  isOnLadder,
  isAutoManaged,
  STAFF_LEVEL,
  DEFAULT_RANKS,
  DEFAULT_RULES,
  RankPromotionRule,
  RankProgressionInput
} from './rankProgression';

const GiB = BigInt(1024 ** 3);

const rankId = (name: string): number => {
  const r = DEFAULT_RANKS.find((x) => x.name === name);
  if (!r) throw new Error(`no such rank: ${name}`);
  return r.id;
};

/** A user who clears every numeric/extra criterion on the ladder. */
const maxed = (
  over: Partial<RankProgressionInput> = {}
): RankProgressionInput => ({
  currentRankId: rankId('User'),
  contributed: 1000n * GiB,
  consumed: 500n * GiB, // ratio 2.0 — clears the 1.05 rungs
  contributionCount: 1000,
  distinctReleaseCount: 1000,
  qualityContributionCount: 1000,
  accountAgeDays: 365,
  hasActiveWarning: false,
  rankLocked: false,
  ...over
});

// ─── promotion ────────────────────────────────────────────────────────────────

describe('evaluateRankChange — promotion', () => {
  it('promotes a User who meets all Member criteria one step to Member', () => {
    const result = evaluateRankChange(maxed());
    expect(result.direction).toBe('promote');
    expect(result.targetRankId).toBe(rankId('Member'));
  });

  it('climbs only one rung per pass — a maxed User reaches Member, not beyond', () => {
    const result = evaluateRankChange(maxed());
    expect(result.targetRankId).toBe(rankId('Member'));
    expect(result.targetRankId).not.toBe(rankId('Power User'));
  });

  it('stays when criteria are not yet met', () => {
    const result = evaluateRankChange(maxed({ contributed: 1n * GiB }));
    expect(result.direction).toBe('none');
  });

  it('promotes at the exact threshold (>= is inclusive)', () => {
    // Member → Power User needs 25 GiB, 5 contributions, 14 days, ratio 1.05.
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('Member'),
        contributed: 25n * GiB,
        consumed: 20n * GiB, // ratio 1.25 ≥ 1.05
        contributionCount: 5,
        accountAgeDays: 14
      })
    );
    expect(result.direction).toBe('promote');
    expect(result.targetRankId).toBe(rankId('Power User'));
  });

  it('stalls a never-consumed Member at Member (ratio 1.0 < 1.05)', () => {
    // Faithful port of the 1.0-when-unconsumed convention: a user who has never
    // consumed cannot clear the 1.05 rungs no matter how much they contribute.
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('Member'),
        contributed: 10_000n * GiB,
        consumed: 0n,
        contributionCount: 10_000,
        accountAgeDays: 365
      })
    );
    expect(result.direction).toBe('none');
  });
});

// ─── demotion ─────────────────────────────────────────────────────────────────

describe('evaluateRankChange — demotion', () => {
  it('demotes one step when the stock criteria for the current class lapse', () => {
    // Elite was reached via Power User → Elite (100 GiB, 50 contributions).
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Elite'), contributed: 1n * GiB })
    );
    expect(result.direction).toBe('demote');
    expect(result.targetRankId).toBe(rankId('Power User'));
  });

  it('does not demote for ratio drift (ratio is not a stock criterion)', () => {
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('Elite'),
        contributed: 1000n * GiB,
        consumed: 100_000n * GiB // ratio ~0.01, well under 1.05
      })
    );
    expect(result.direction).toBe('none');
  });

  it('does not demote a User (base class has no incoming rule)', () => {
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('User'),
        contributed: 0n,
        contributionCount: 0
      })
    );
    expect(result.direction).toBe('none');
  });
});

// ─── extra predicates ───────────────────────────────────────────────────────────

describe('evaluateRankChange — extra predicates', () => {
  it('holds a Stellarific below Stellartastic without 500 distinct releases', () => {
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Stellarific'), distinctReleaseCount: 499 })
    );
    expect(result.direction).toBe('none');
  });

  it('promotes a Stellarific to Stellartastic once 500 distinct releases is met', () => {
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Stellarific'), distinctReleaseCount: 500 })
    );
    expect(result.direction).toBe('promote');
    expect(result.targetRankId).toBe(rankId('Stellartastic'));
  });

  it('demotes a Stellartastic who falls below 500 distinct releases', () => {
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('Stellartastic'),
        distinctReleaseCount: 499
      })
    );
    expect(result.direction).toBe('demote');
    expect(result.targetRankId).toBe(rankId('Stellarific'));
  });

  it('promotes a Stellartastic to Stellarige on 500 quality contributions', () => {
    const result = evaluateRankChange(
      maxed({
        currentRankId: rankId('Stellartastic'),
        qualityContributionCount: 500
      })
    );
    expect(result.direction).toBe('promote');
    expect(result.targetRankId).toBe(rankId('Stellarige'));
  });
});

// ─── guards ─────────────────────────────────────────────────────────────────────

describe('evaluateRankChange — guards', () => {
  it('does not touch a rankLocked user even when they qualify to promote', () => {
    const result = evaluateRankChange(maxed({ rankLocked: true }));
    expect(result.direction).toBe('none');
    expect(result.targetRankId).toBe(rankId('User'));
  });

  it('freezes a user with an active warning', () => {
    const result = evaluateRankChange(maxed({ hasActiveWarning: true }));
    expect(result.direction).toBe('none');
  });

  it('never promotes into an assigned class (Stellarige → Staff)', () => {
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Stellarige') })
    );
    expect(result.direction).toBe('none');
  });

  it('never auto-manages a user already in an assigned class (Staff)', () => {
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Staff') })
    );
    expect(result.direction).toBe('none');
  });
});

// ─── rules off the ladder (#718) ────────────────────────────────────────────────

/**
 * A rule with criteria no one can lapse below or fail to reach; what matters is
 * only where it points. Put first, it is the one `rules.find` used to take.
 */
const offLadder = (
  fromRankId: number,
  toRankId: number
): RankPromotionRule => ({
  fromRankId,
  toRankId,
  minContributed: 0n,
  minRatio: 0,
  minContributions: 0,
  minAccountAgeDays: 0,
  extra: null,
  enabled: true
});

/** A secondary rank's id: never on the ladder the sweep loads. */
const DONOR_ID = 99;

describe('evaluateRankChange — rules off the ladder (#718)', () => {
  it('promotes by the adjacent rule, not one that skips a rung', () => {
    const result = evaluateRankChange(maxed(), [
      offLadder(rankId('User'), rankId('Power User')),
      ...DEFAULT_RULES
    ]);
    expect(result.direction).toBe('promote');
    expect(result.targetRankId).toBe(rankId('Member'));
  });

  it('demotes by the adjacent rule, not one that spans two rungs', () => {
    // A stale Member → Elite rule with impossible stock criteria would demote
    // an Elite two rungs, to Member.
    const stale = {
      ...offLadder(rankId('Member'), rankId('Elite')),
      minContributed: 10_000n * GiB
    };
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Elite'), contributed: 1n * GiB }),
      [stale, ...DEFAULT_RULES]
    );
    expect(result.direction).toBe('demote');
    expect(result.targetRankId).toBe(rankId('Power User'));
  });

  it('never demotes into a secondary rank', () => {
    const intoDonor = {
      ...offLadder(DONOR_ID, rankId('Member')),
      minContributed: 10_000n * GiB
    };
    const result = evaluateRankChange(
      maxed({ currentRankId: rankId('Member'), contributed: 0n }),
      [intoDonor, ...DEFAULT_RULES]
    );
    expect(result.direction).toBe('demote');
    expect(result.targetRankId).toBe(rankId('User'));
  });

  it('a stale rule alone leaves the member where they are', () => {
    const result = evaluateRankChange(maxed(), [
      offLadder(rankId('User'), rankId('Power User'))
    ]);
    expect(result.direction).toBe('none');
  });
});

describe('isAutoManaged (#866)', () => {
  it.each([
    ['a primary rank below the staff level', 450, false, true],
    ['a primary rank at the staff level', STAFF_LEVEL, false, false],
    ['a primary rank above it', 1000, false, false],
    ['a secondary rank', 120, true, false]
  ])('is right for %s', (_case, level, secondary, expected) => {
    expect(isAutoManaged({ level, secondary })).toBe(expected);
  });

  it('agrees with the default ladder', () => {
    expect(
      DEFAULT_RANKS.every(
        (r) =>
          isAutoManaged({ level: r.level, secondary: false }) === r.autoManaged
      )
    ).toBe(true);
  });
});

describe('isOnLadder', () => {
  const ladder = [
    { id: 1, level: 100 },
    { id: 2, level: 150 },
    { id: 3, level: 200 }
  ];

  it('accepts an adjacent step', () => {
    expect(isOnLadder({ fromRankId: 1, toRankId: 2 }, ladder)).toBe(true);
  });

  it('rejects a step over a rung', () => {
    expect(isOnLadder({ fromRankId: 1, toRankId: 3 }, ladder)).toBe(false);
  });

  it('rejects an endpoint missing from the ladder', () => {
    expect(isOnLadder({ fromRankId: 1, toRankId: DONOR_ID }, ladder)).toBe(
      false
    );
    expect(isOnLadder({ fromRankId: DONOR_ID, toRankId: 2 }, ladder)).toBe(
      false
    );
  });
});

// ─── isAdjacentPromotionStep (#170 admin CRUD guard) ────────────────────────────

describe('isAdjacentPromotionStep', () => {
  it('accepts a toRank one rung above fromRank with nothing between', () => {
    expect(isAdjacentPromotionStep(100, 150, [200, 300])).toBe(true);
  });

  it('rejects a toRank at or below fromRank', () => {
    expect(isAdjacentPromotionStep(150, 150, [])).toBe(false);
    expect(isAdjacentPromotionStep(150, 100, [])).toBe(false);
  });

  it('rejects a step that skips a rung on the ladder', () => {
    expect(isAdjacentPromotionStep(100, 200, [150])).toBe(false);
  });

  it('ignores rungs outside the (fromLevel, toLevel) window', () => {
    expect(isAdjacentPromotionStep(150, 200, [100, 300])).toBe(true);
  });
});

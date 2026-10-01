/**
 * Rank-progression evaluator — the pure, table-driven core of automated user
 * class progression (USER_CLASSES_PLAN.md §6).
 *
 * Given a user's stats plus the rule set, it decides whether the user promotes
 * one step, demotes one step, or stays put. No DB and no I/O live here so the
 * decision is deterministically unit-testable; the DB-bound sweep
 * (rankProgressionJob) supplies the inputs and delegates changes to setUserRank.
 */

export const GiB = BigInt(1024 ** 3);

export type RankExtraPredicate =
  'DISTINCT_RELEASES_500' | 'QUALITY_CONTRIB_500';

export interface Rank {
  id: number;
  level: number;
  name: string;
  /** false for Staff/SysOp — never auto-reached, never auto-demoted into. */
  autoManaged: boolean;
}

/**
 * Primary ranks at or above this level are staff: assigned by hand, never
 * auto-managed (#866). The one copy; the inactivity sweep and the invite
 * handout re-export it.
 */
export const STAFF_LEVEL = 500;

/**
 * Whether automated jobs manage members of this rank (#866): primary, and below
 * the staff level. Promotion rules join only these ranks. The inactivity sweep
 * and the invite handout apply the same threshold to a member's primary rank.
 */
export const isAutoManaged = (rank: {
  level: number;
  secondary: boolean;
}): boolean => !rank.secondary && rank.level < STAFF_LEVEL;

export interface RankPromotionRule {
  fromRankId: number;
  toRankId: number;
  minContributed: bigint; // bytes
  minRatio: number;
  minContributions: number;
  minAccountAgeDays: number;
  extra: RankExtraPredicate | null;
  enabled: boolean;
}

export interface RankProgressionInput {
  currentRankId: number;
  contributed: bigint;
  consumed: bigint;
  contributionCount: number;
  distinctReleaseCount: number;
  qualityContributionCount: number;
  accountAgeDays: number;
  hasActiveWarning: boolean;
  rankLocked: boolean;
}

export type Direction = 'promote' | 'demote' | 'none';

export interface RankProgressionResult {
  targetRankId: number;
  direction: Direction;
  /** Human-readable why — for audit notes. Not load-bearing. */
  reason: string;
}

// ─── default ladder (USER_CLASSES_PLAN.md §2 + §5) ──────────────────────────────

export const DEFAULT_RANKS: Rank[] = [
  { id: 1, level: 100, name: 'User', autoManaged: true },
  { id: 2, level: 150, name: 'Member', autoManaged: true },
  { id: 3, level: 200, name: 'Power User', autoManaged: true },
  { id: 4, level: 300, name: 'Elite', autoManaged: true },
  { id: 5, level: 350, name: 'Stellarific', autoManaged: true },
  { id: 6, level: 400, name: 'Stellartastic', autoManaged: true },
  { id: 7, level: 450, name: 'Stellarige', autoManaged: true },
  { id: 8, level: 500, name: 'Staff', autoManaged: false },
  { id: 9, level: 1000, name: 'SysOp', autoManaged: false }
];

export const DEFAULT_RULES: RankPromotionRule[] = [
  promotionRule(1, 2, 10n * GiB, 0.7, 0, 7, null),
  promotionRule(2, 3, 25n * GiB, 1.05, 5, 14, null),
  promotionRule(3, 4, 100n * GiB, 1.05, 50, 28, null),
  promotionRule(4, 5, 500n * GiB, 1.05, 500, 56, null),
  promotionRule(5, 6, 500n * GiB, 1.05, 500, 56, 'DISTINCT_RELEASES_500'),
  promotionRule(6, 7, 500n * GiB, 1.05, 500, 56, 'QUALITY_CONTRIB_500')
];

function promotionRule(
  fromRankId: number,
  toRankId: number,
  minContributed: bigint,
  minRatio: number,
  minContributions: number,
  minAccountAgeDays: number,
  extra: RankExtraPredicate | null
): RankPromotionRule {
  return {
    fromRankId,
    toRankId,
    minContributed,
    minRatio,
    minContributions,
    minAccountAgeDays,
    extra,
    enabled: true
  };
}

// ─── pure helpers ───────────────────────────────────────────────────────────────

/**
 * Mirrors `ratio.computeRatio` but kept local so this module stays free of the
 * Prisma client that ratio.ts pulls in — the evaluator must remain pure.
 */
export const computeRatio = (contributed: bigint, consumed: bigint): number => {
  if (consumed === 0n) return 1.0;
  return Number(contributed) / Number(consumed);
};

const extraMet = (
  extra: RankExtraPredicate | null,
  input: RankProgressionInput
): boolean => {
  switch (extra) {
    case 'DISTINCT_RELEASES_500':
      return input.distinctReleaseCount >= 500;
    case 'QUALITY_CONTRIB_500':
      return input.qualityContributionCount >= 500;
    case null:
      return true;
  }
};

/** All criteria — the bar for a PROMOTION. */
const meetsAll = (
  rule: RankPromotionRule,
  input: RankProgressionInput
): boolean =>
  input.contributed >= rule.minContributed &&
  computeRatio(input.contributed, input.consumed) >= rule.minRatio &&
  input.contributionCount >= rule.minContributions &&
  input.accountAgeDays >= rule.minAccountAgeDays &&
  extraMet(rule.extra, input);

/**
 * "Stock" criteria only — bytes, contribution count, extra predicate. Ratio and
 * age are deliberately excluded: they gate promotion but never trigger demotion
 * (you do not lose a class for ratio drift or the passage of time).
 */
const meetsStock = (
  rule: RankPromotionRule,
  input: RankProgressionInput
): boolean =>
  input.contributed >= rule.minContributed &&
  input.contributionCount >= rule.minContributions &&
  extraMet(rule.extra, input);

// ─── the evaluator ──────────────────────────────────────────────────────────────

export const evaluateRankChange = (
  input: RankProgressionInput,
  rules: RankPromotionRule[] = DEFAULT_RULES,
  ranks: Rank[] = DEFAULT_RANKS
): RankProgressionResult => {
  const stay = (reason: string): RankProgressionResult => ({
    targetRankId: input.currentRankId,
    direction: 'none',
    reason
  });

  const current = ranks.find((r) => r.id === input.currentRankId);
  if (!current) return stay('unknown rank');
  if (input.rankLocked)
    return stay('rankLocked — engine will not touch this user');
  if (input.hasActiveWarning) return stay('active warning — frozen');
  if (!current.autoManaged)
    return stay(`${current.name} is assigned, never auto-managed`);

  // Only rules that are an adjacent step on the ladder as it stands now (#718),
  // which holds auto-managed ranks only (#866). The write path checks this,
  // but a later level change can strand a rule; left in, it would promote past
  // a rung, shadow the right rule, or demote into the wrong rank.
  const ladder = ranks.filter((r) => r.autoManaged);
  const live = rules.filter((r) => r.enabled && isOnLadder(r, ladder));

  // Demotion takes precedence over promotion: a user must remain a valid
  // member of their current class before they can advance. This only diverges
  // from promotion in the prestige tiers, where the Extra predicates let the
  // outgoing rule pass while the incoming (current-class) one has lapsed.
  const incoming = live.find((r) => r.toRankId === input.currentRankId);
  if (incoming && !meetsStock(incoming, input)) {
    return {
      targetRankId: incoming.fromRankId,
      direction: 'demote',
      reason: `no longer meets stock criteria for ${current.name}`
    };
  }

  // Promotion: the outgoing rule from the current rank. One step only.
  const outgoing = live.find((r) => r.fromRankId === input.currentRankId);
  if (outgoing) {
    const target = ranks.find((r) => r.id === outgoing.toRankId);
    if (target?.autoManaged && meetsAll(outgoing, input)) {
      return {
        targetRankId: outgoing.toRankId,
        direction: 'promote',
        reason: `meets all ${target.name} criteria`
      };
    }
  }

  return stay(outgoing ? 'criteria not yet met' : 'top of the auto ladder');
};

/**
 * Guards RankPromotionRule admin CRUD (tools.ts, #170): a rule must step to the
 * very next rung by level, with nothing else on the ladder in between. Without
 * this, two rules could both claim the same fromRankId — evaluateRankChange's
 * `rules.find` takes whichever one Prisma returns first, an unordered query
 * result — silently dropping coverage instead of erroring.
 */
export const isAdjacentPromotionStep = (
  fromLevel: number,
  toLevel: number,
  otherLadderLevels: number[]
): boolean =>
  toLevel > fromLevel &&
  !otherLadderLevels.some((level) => level > fromLevel && level < toLevel);

/**
 * True when `rule` is an adjacent step on `ladder`, the auto-managed ranks only
 * (#718, #866). An endpoint missing from the ladder — a secondary rank, a staff
 * rank, or a deleted one — fails, so the evaluator and the stale-rule report
 * share one answer with the write-time guard.
 */
export const isOnLadder = (
  rule: Pick<RankPromotionRule, 'fromRankId' | 'toRankId'>,
  ladder: Pick<Rank, 'id' | 'level'>[]
): boolean => {
  const from = ladder.find((r) => r.id === rule.fromRankId);
  const to = ladder.find((r) => r.id === rule.toRankId);
  if (!from || !to) return false;
  return isAdjacentPromotionStep(
    from.level,
    to.level,
    ladder.filter((r) => r.id !== from.id && r.id !== to.id).map((r) => r.level)
  );
};

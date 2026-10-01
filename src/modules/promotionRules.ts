/**
 * Promotion rule administration (#170, #718): the ladder checks staff edits
 * run against. Every rule must step between adjacent primary ranks — the write
 * check refuses one that does not, and a rank change that strands an existing
 * rule reports it rather than refusing, so staff can still reorder the ladder.
 *
 * The evaluator (rankProgression.ts) applies the same `isOnLadder` rule at read
 * time, so a rule this module reports as stranded is one the sweep ignores.
 */
import { prisma } from '../lib/prisma';

export { isAutoManaged } from './rankProgression';
import {
  isAdjacentPromotionStep,
  isAutoManaged,
  isOnLadder,
  STAFF_LEVEL
} from './rankProgression';

export const promotionRuleInclude = {
  fromRank: { select: { name: true } },
  toRank: { select: { name: true } }
} as const;

/**
 * Existence + adjacency guard shared by create/update. Returns an error
 * message to surface as a 422, or null when the pair is valid. Adjacency is
 * scoped to the primary ladder (secondary ranks like Donor/VIP overlay tags
 * don't participate in auto-progression — see rankProgressionJob.loadLadder).
 */
export async function validatePromotionRulePair(
  fromRankId: number,
  toRankId: number
): Promise<string | null> {
  const [fromRank, toRank] = await Promise.all([
    prisma.userRank.findUnique({
      where: { id: fromRankId },
      select: { level: true, secondary: true }
    }),
    prisma.userRank.findUnique({
      where: { id: toRankId },
      select: { level: true, secondary: true }
    })
  ]);
  if (!fromRank || !toRank) return 'fromRank or toRank does not exist';
  // The ladder check below only looks at the rungs between, never the ends. A
  // secondary end (#718) or a staff end (#866) would pass it and sit dead: the
  // sweep moves members only between auto-managed ranks.
  if (!isAutoManaged(fromRank) || !isAutoManaged(toRank)) {
    return `fromRank and toRank must both be primary ranks below the staff level (${STAFF_LEVEL})`;
  }

  const ladderLevels = await prisma.userRank.findMany({
    where: {
      secondary: false,
      id: { notIn: [fromRankId, toRankId] }
    },
    select: { level: true }
  });

  if (
    !isAdjacentPromotionStep(
      fromRank.level,
      toRank.level,
      ladderLevels.map((r) => r.level)
    )
  ) {
    return 'fromRank and toRank must be adjacent rungs on the ladder (toRank the very next level up, nothing in between)';
  }
  return null;
}

/**
 * The promotion rules a rank update just took off the ladder (#718). A level or
 * secondary change can strand a rule written when it was adjacent, including a
 * level moved across the staff level (#866); the update still goes through, and
 * the rules are reported instead. Rules already off the
 * ladder before this change are not this change's doing and are left out.
 */
export async function rulesStrandedBy(
  before: { id: number; level: number; secondary: boolean },
  after: { level: number; secondary: boolean }
) {
  if (before.level === after.level && before.secondary === after.secondary) {
    return [];
  }
  const [ranks, rules] = await Promise.all([
    prisma.userRank.findMany({
      select: { id: true, level: true, secondary: true }
    }),
    prisma.rankPromotionRule.findMany({
      orderBy: [{ fromRankId: 'asc' }, { toRankId: 'asc' }],
      include: promotionRuleInclude
    })
  ]);
  const ladderNow = ranks.filter(isAutoManaged);
  const ladderBefore = ranks
    .map((r) =>
      r.id === before.id
        ? { ...r, level: before.level, secondary: before.secondary }
        : r
    )
    .filter(isAutoManaged);
  return rules.filter(
    (r) => isOnLadder(r, ladderBefore) && !isOnLadder(r, ladderNow)
  );
}

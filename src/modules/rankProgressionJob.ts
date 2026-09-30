/**
 * Automated rank-progression sweep (USER_CLASSES_PLAN §6). The thin, DB-bound
 * shell around the pure evaluator (rankProgression.ts): it loads the ladder and
 * rules from the DB, builds each eligible user's RankProgressionInput, asks the
 * evaluator for a decision, and applies one-step promotions/demotions.
 *
 * The evaluator owns ALL the policy (one-step-per-pass, stock-only demotion,
 * demotion-wins precedence, Staff/SysOp & rankLocked & active-warning freezes);
 * this module only supplies inputs and persists the outcome.
 */
import {
  Bitrate,
  NotificationType,
  Prisma,
  SubscriptionPage
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { getEligibleContributionBytes } from './ratio';
import { ranks as ranksConfig } from './config';
import {
  evaluateRankChange,
  Rank,
  RankProgressionInput,
  RankProgressionResult,
  RankExtraPredicate,
  RankPromotionRule
} from './rankProgression';

const log = getLogger('rankProgressionJob');

const STARTUP_DELAY_MS = 45_000;
const BATCH_SIZE = 500;
const DAY_MS = 86_400_000;
const STAFF_LEVEL = 500; // ranks at/above this are assigned, never auto-managed
const LOSSLESS_BITRATES: Bitrate[] = [Bitrate.Lossless, Bitrate.Lossless24];

/**
 * Project the DB ranks/rules onto the evaluator's interfaces. autoManaged is
 * derived from level: everything below Staff (500) is on the auto ladder; Staff
 * and SysOp are assigned and never auto-reached or auto-demoted.
 */
export const loadLadder = async (): Promise<{
  ranks: Rank[];
  rules: RankPromotionRule[];
}> => {
  const [rankRows, ruleRows] = await Promise.all([
    prisma.userRank.findMany({
      where: { secondary: false },
      select: { id: true, level: true, name: true }
    }),
    prisma.rankPromotionRule.findMany()
  ]);

  const ranks: Rank[] = rankRows.map((r) => ({
    id: r.id,
    level: r.level,
    name: r.name,
    autoManaged: r.level < STAFF_LEVEL
  }));

  const rules: RankPromotionRule[] = ruleRows.map((r) => ({
    fromRankId: r.fromRankId,
    toRankId: r.toRankId,
    minContributed: r.minContributed,
    minRatio: r.minRatio,
    minContributions: r.minContributions,
    minAccountAgeDays: r.minAccountAgeDays,
    extra: r.extra as RankExtraPredicate | null,
    enabled: r.enabled
  }));

  return { ranks, rules };
};

type SweepUser = {
  id: number;
  userRankId: number;
  consumed: bigint;
  dateRegistered: Date;
  rankLocked: boolean;
};

/**
 * Build a user's evaluator input. Per the §11 product decisions (#172):
 * - "contributed" toward promotion is link-health-eligible bytes (ADR-0006),
 *   NOT raw User.contributed — getEligibleContributionBytes already applies the
 *   72h age + approved + not-FAIL filter.
 * - QUALITY_CONTRIB_500 counts contributions that are lossless OR have log+cue,
 *   and are not scene.
 * Contribution count / distinct releases also count only accounted contributions
 * (approvedAccountingBytes set), to stay consistent with the eligible-bytes pool.
 */
export const buildProgressionInput = async (
  user: SweepUser
): Promise<RankProgressionInput> => {
  const accounted = { userId: user.id, approvedAccountingBytes: { not: null } };

  const [
    eligibleBytes,
    contributionCount,
    distinctReleases,
    qualityContributionCount,
    activeWarnings
  ] = await Promise.all([
    getEligibleContributionBytes(user.id),
    prisma.contribution.count({ where: accounted }),
    prisma.contribution.findMany({
      where: accounted,
      select: { releaseId: true },
      distinct: ['releaseId']
    }),
    prisma.contribution.count({
      where: {
        ...accounted,
        releaseFile: {
          isScene: false,
          OR: [
            { bitrate: { in: LOSSLESS_BITRATES } },
            { AND: [{ hasLog: true }, { hasCue: true }] }
          ]
        }
      }
    }),
    prisma.userWarning.count({
      where: {
        userId: user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    })
  ]);

  return {
    currentRankId: user.userRankId,
    contributed: eligibleBytes,
    consumed: user.consumed,
    contributionCount,
    distinctReleaseCount: distinctReleases.length,
    qualityContributionCount,
    accountAgeDays: Math.floor(
      (Date.now() - user.dateRegistered.getTime()) / DAY_MS
    ),
    hasActiveWarning: activeWarnings > 0,
    rankLocked: user.rankLocked
  };
};

/**
 * The reserved system actor for auto rank changes: the install SysOp (the
 * lowest-id user at SysOp level). Audit rows and notifications attribute to it.
 * Returns null when no such user exists — the sweep then no-ops.
 */
export const resolveSystemActorId = async (): Promise<number | null> => {
  const sysop = await prisma.user.findFirst({
    where: { userRank: { level: { gte: 1000 } } },
    orderBy: { id: 'asc' },
    select: { id: true }
  });
  return sysop?.id ?? null;
};

/**
 * Persist one auto rank change, answering whether it was made. Deliberately a
 * primary-rank-only update — NOT a call to setUserRank, which replaces the
 * user's whole secondary-rank set and would silently strip a Donor/VIP
 * secondary on every auto-promotion. We reuse the same `user.rank_changed`
 * audit action so the trail stays uniform, and the meta records that the
 * engine (not a human) made the move.
 *
 * The write is a claim on the user as the evaluator read them (#826): still
 * active, still on the rank the step starts from, and neither locked nor under
 * an active warning. A batch is read up to 500 users before it is written, so
 * without the claim a staff rank change, lock or warning made in between was
 * overwritten by a decision taken before it. A rank deleted in between answers
 * P2003, and is left for the next sweep's ladder to settle.
 */
const applyRankChange = async (
  user: SweepUser,
  result: RankProgressionResult,
  systemActorId: number
): Promise<boolean> => {
  const now = new Date();
  let count: number;
  try {
    ({ count } = await prisma.user.updateMany({
      where: {
        id: user.id,
        userRankId: user.userRankId,
        disabled: false,
        rankLocked: false,
        warnings: {
          none: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
        }
      },
      data: { userRankId: result.targetRankId }
    }));
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    )
      return false;
    throw err;
  }
  if (count === 0) return false;

  await audit(prisma, systemActorId, 'user.rank_changed', 'User', user.id, {
    userRankId: result.targetRankId,
    auto: true,
    direction: result.direction,
    reason: result.reason
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      type:
        result.direction === 'promote'
          ? NotificationType.rank_promoted
          : NotificationType.rank_demoted,
      actorId: systemActorId,
      // Notification is subscription-shaped (page + pageId); a rank change has no
      // natural subscription page, so we map it to the site-level notice channel
      // with the new rank id as the target.
      page: SubscriptionPage.global_notices,
      pageId: result.targetRankId
    }
  });
  return true;
};

export type SweepResult = {
  scanned: number;
  promoted: number;
  demoted: number;
  /** Users whose evaluation or write threw; each was logged and skipped. */
  failed: number;
};

/** One page of the auto-managed cohort, after `cursor`. */
const loadBatch = (
  autoManagedRankIds: number[],
  cursor: number | undefined
): Promise<SweepUser[]> =>
  prisma.user.findMany({
    where: { disabled: false, userRankId: { in: autoManagedRankIds } },
    orderBy: { id: 'asc' },
    take: BATCH_SIZE,
    ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      userRankId: true,
      consumed: true,
      dateRegistered: true,
      rankLocked: true
    }
  });

/** Evaluate one user and apply any change; answers the direction taken. */
const sweepOne = async (
  user: SweepUser,
  ladder: { ranks: Rank[]; rules: RankPromotionRule[] },
  systemActorId: number
): Promise<RankProgressionResult['direction']> => {
  const input = await buildProgressionInput(user);
  const result = evaluateRankChange(input, ladder.rules, ladder.ranks);
  if (result.direction === 'none') return 'none';

  if (!(await applyRankChange(user, result, systemActorId))) {
    log.info('Auto rank change skipped: the user changed since it was read', {
      userId: user.id,
      direction: result.direction
    });
    return 'none';
  }
  log.info('Auto rank change', {
    userId: user.id,
    direction: result.direction,
    fromRankId: user.userRankId,
    toRankId: result.targetRankId,
    reason: result.reason
  });
  return result.direction;
};

/**
 * `sweepOne`, contained to one user and folded into the tally (#596). Each
 * user is independent, so a failure is logged, counted and skipped. Uncaught,
 * it used to abandon the sweep, leaving everyone later in the cursor
 * unevaluated until the next day's run.
 */
const sweepContained = async (
  user: SweepUser,
  ladder: { ranks: Rank[]; rules: RankPromotionRule[] },
  systemActorId: number,
  tally: SweepResult
): Promise<void> => {
  tally.scanned++;
  try {
    const direction = await sweepOne(user, ladder, systemActorId);
    if (direction === 'promote') tally.promoted++;
    else if (direction === 'demote') tally.demoted++;
  } catch (err) {
    tally.failed++;
    log.error('Rank progression failed for a user', { userId: user.id, err });
  }
};

/**
 * Run one full sweep. Batched by ascending id over the auto-managed cohort
 * (active users whose primary rank is below Staff). Each user is evaluated once
 * per sweep — the evaluator's one-step rule does the rest.
 */
export const runRankProgressionSweep = async (): Promise<SweepResult> => {
  const tally: SweepResult = { scanned: 0, promoted: 0, demoted: 0, failed: 0 };
  const ladder = await loadLadder();
  const autoManagedRankIds = ladder.ranks
    .filter((r) => r.autoManaged)
    .map((r) => r.id);
  if (autoManagedRankIds.length === 0) return tally;

  const systemActorId = await resolveSystemActorId();
  if (systemActorId === null) {
    log.warn('No SysOp actor — skipping rank progression sweep');
    return tally;
  }

  let cursor: number | undefined;
  for (;;) {
    const batch = await loadBatch(autoManagedRankIds, cursor);
    if (batch.length === 0) break;

    for (const user of batch) {
      await sweepContained(user, ladder, systemActorId, tally);
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  if (tally.promoted + tally.demoted + tally.failed > 0) {
    log.info('Rank progression sweep complete', tally);
  }
  return tally;
};

export const startRankProgressionJob = (): void => {
  const run = (): void => {
    runRankProgressionSweep().catch((err) =>
      log.error('Rank progression sweep failed', { err })
    );
  };

  const outer = setTimeout(() => {
    run();
    setInterval(run, ranksConfig.progressionIntervalMs).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Rank progression job scheduled', {
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: ranksConfig.progressionIntervalMs
  });
};

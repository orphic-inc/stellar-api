/**
 * Invite handout sweep (#282, ADR-0039) — the DB-bound shell around the pure
 * evaluator (inviteGrant.ts). It loads candidates, asks the evaluator for a
 * decision per member, and applies it in two batched writes. All the policy
 * lives in the evaluator; this module only supplies inputs and persists
 * outcomes.
 *
 * Three things here are deliberate and not obvious from the issue:
 *
 *  - This job is the ONLY writer that raises `inviteCount`. Before it,
 *    `createInvite` decremented and nothing incremented: the founding SysOp's
 *    100 from `/install` was the entire supply. So the fail-closed defaults are
 *    load-bearing rather than ceremonial — `INVITE_GRANT_MODE=off` plus every
 *    rank's rate defaulting to 0 means merging this changes nothing anywhere.
 *  - Grants are applied with a CONDITIONAL `updateMany`, not a read-modify-write.
 *    The `inviteCount` predicate is re-evaluated at write time, so a member who
 *    spends an invite between our read and our write cannot be clobbered and the
 *    cap cannot be exceeded. This is the same TOCTOU window the repo's Prisma
 *    guard rule warns about, closed by never writing an absolute value.
 *  - The trail is ONE audit row per cycle, not one per member. `AuditLog`
 *    carries no indexes and nothing prunes it; a weekly per-member row would be
 *    tens of thousands a year for a uniform event that is already reconstructible
 *    from the member's rank and `lastInviteGrantAt`. What the row answers is
 *    "did it run, what did it do, was it configured right" — which is what
 *    anyone actually asks of a faucet.
 */
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { inviteGrant as inviteGrantConfig } from './config';
import { resolveSystemActorId } from './rankProgressionJob';
import { computeStanding } from './standing';
import {
  evaluateInviteGrant,
  isStandingDenied,
  InviteGrantInput,
  STAFF_LEVEL,
  DAY_MS
} from './inviteGrant';

const log = getLogger('inviteGrantJob');

const STARTUP_DELAY_MS = 120_000;
const BATCH_SIZE = 500;

interface Candidate extends InviteGrantInput {
  id: number;
  rankId: number;
}

/**
 * Load one cursor-paged batch of members worth evaluating.
 *
 * The `where` is a coarse pre-filter, not the rule: it excludes what the
 * evaluator would exempt anyway, so a large member table is not walked in full
 * every night. The evaluator still re-checks every exemption, because a
 * pre-filter that silently disagreed with it would be invisible.
 *
 * Warning rows come back with the member rather than in a second pass, because
 * `computeStanding` needs the whole set to count what is still active at `now`
 * — an expired warning must not deny a grant.
 */
const loadBatch = async (
  cursor: number | undefined,
  now: Date
): Promise<Candidate[]> => {
  const rows = await prisma.user.findMany({
    where: {
      disabled: false,
      userRank: { level: { lt: STAFF_LEVEL }, inviteGrantPerPeriod: { gt: 0 } }
    },
    ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      inviteCount: true,
      lastInviteGrantAt: true,
      dateRegistered: true,
      disabled: true,
      banDate: true,
      userRank: {
        select: {
          id: true,
          level: true,
          inviteGrantPerPeriod: true,
          inviteCap: true
        }
      },
      warnings: { select: { expiresAt: true } }
    },
    take: BATCH_SIZE,
    orderBy: { id: 'asc' }
  });

  return rows.map((r) => ({
    id: r.id,
    rankId: r.userRank.id,
    perPeriod: r.userRank.inviteGrantPerPeriod,
    cap: r.userRank.inviteCap,
    balance: r.inviteCount,
    lastInviteGrantAt: r.lastInviteGrantAt,
    dateRegistered: r.dateRegistered,
    disabled: r.disabled,
    rankLevel: r.userRank.level,
    standing: computeStanding({
      warnings: r.warnings,
      banned: r.banDate !== null,
      accountAgeDays: (now.getTime() - r.dateRegistered.getTime()) / DAY_MS,
      now
    })
  }));
};

interface Tally {
  /** Members who received invites. */
  granted: number;
  /** Invites actually added. */
  invites: number;
  /** Eligible but at cap — clock advanced, nothing added. */
  atCap: number;
  /** Denied by standing. Called out separately because it is the governance arm. */
  withheld: number;
  /** Per-rank grant counts, so a misconfigured class is visible in the tally. */
  byRank: Record<number, number>;
}

/**
 * Apply one batch's decisions.
 *
 * Two `updateMany` calls rather than one write per member: the grant set is
 * keyed by rank (every member of a rank receives the same amount and shares the
 * same cap predicate), and the advance set needs no amount at all.
 *
 * The grant predicate repeats the evaluator's room check on purpose. It is not
 * redundant — the evaluator decided against a balance we read, and this decides
 * against the balance at write time. A member who spends in between simply
 * keeps their invite and is skipped, rather than having our stale absolute
 * value written over their spend.
 */
const applyBatch = async (
  batch: Candidate[],
  now: Date,
  tally: Tally
): Promise<void> => {
  const grantsByRank = new Map<
    number,
    { ids: number[]; amount: number; cap: number }
  >();
  const advanceIds: number[] = [];

  for (const member of batch) {
    const decision = evaluateInviteGrant(member, now);

    if (decision.action === 'grant') {
      const bucket = grantsByRank.get(member.rankId) ?? {
        ids: [],
        amount: decision.amount,
        cap: member.cap
      };
      bucket.ids.push(member.id);
      grantsByRank.set(member.rankId, bucket);
      tally.granted += 1;
      tally.invites += decision.amount;
      tally.byRank[member.rankId] = (tally.byRank[member.rankId] ?? 0) + 1;
    } else if (decision.action === 'advance') {
      advanceIds.push(member.id);
      tally.atCap += 1;
    } else if (isStandingDenied(member.standing)) {
      tally.withheld += 1;
    }
  }

  if (inviteGrantConfig.mode !== 'on') return;

  for (const [, bucket] of grantsByRank) {
    await prisma.user.updateMany({
      where: {
        id: { in: bucket.ids },
        inviteCount: { lte: bucket.cap - bucket.amount }
      },
      data: {
        inviteCount: { increment: bucket.amount },
        lastInviteGrantAt: now
      }
    });
  }

  // The clamped set advances its clock and receives nothing. This is the second
  // write the "a skipped period is spent" rule costs, and the rule is what stops
  // accrual degenerating into top-up-to-cap.
  if (advanceIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: advanceIds } },
      data: { lastInviteGrantAt: now }
    });
  }
};

export const runInviteGrantCycle = async (
  now: Date = new Date()
): Promise<Tally> => {
  const tally: Tally = {
    granted: 0,
    invites: 0,
    atCap: 0,
    withheld: 0,
    byRank: {}
  };

  const mode = inviteGrantConfig.mode;
  if (mode === 'off') return tally;

  const systemActorId = await resolveSystemActorId();
  if (systemActorId === null) {
    log.warn('No SysOp actor — invite handout sweep skipped');
    return tally;
  }

  let cursor: number | undefined;

  // Paged with a cursor rather than a bare `take`: a limit alone would mean the
  // same first N members are the only ones ever evaluated, and everyone past
  // them never earns an invite.
  for (;;) {
    const batch = await loadBatch(cursor, now);
    if (batch.length === 0) break;

    await applyBatch(batch, now, tally);

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  if (mode === 'on' && (tally.granted > 0 || tally.atCap > 0)) {
    await audit(prisma, systemActorId, 'invites.granted', 'SiteSettings', 1, {
      by: 'inviteGrantJob',
      ...tally
    });
  }

  log.info(
    mode === 'dryRun'
      ? 'Would run invite handout cycle'
      : 'Invite handout cycle complete',
    { mode, ...tally }
  );
  return tally;
};

export const startInviteGrantJob = (): void => {
  if (inviteGrantConfig.mode === 'off') {
    log.info('Invite handout job disabled (INVITE_GRANT_MODE=off)');
    return;
  }

  const outer = setTimeout(() => {
    void runInviteGrantCycle().catch((err) =>
      log.error('Invite handout cycle failed', { err })
    );
    setInterval(
      () =>
        void runInviteGrantCycle().catch((err) =>
          log.error('Invite handout cycle failed', { err })
        ),
      inviteGrantConfig.intervalMs
    ).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Invite handout job scheduled', {
    mode: inviteGrantConfig.mode,
    intervalMs: inviteGrantConfig.intervalMs
  });
};

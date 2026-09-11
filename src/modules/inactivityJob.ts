/**
 * Inactivity sweep (#279, ADR-0038) — the DB-bound shell around the pure
 * evaluator (inactivity.ts). It loads candidates, asks the evaluator for a
 * decision per user, and applies it. All the policy lives in the evaluator;
 * this module only supplies inputs and persists outcomes.
 *
 * Three things here are deliberate and not obvious from the issue:
 *
 *  - `mode` gates the WRITES, not the evaluation. `dryRun` walks the whole
 *    candidate set and logs exactly what it would do, because the number this
 *    prints against real data is the only thing that makes turning it on a
 *    considered decision rather than a hope.
 *  - The per-cycle cap bounds disables only. Warnings are recoverable — the
 *    member signs in and the stamp clears — while a disable needs staff to
 *    undo, so only one of the two needs a ceiling.
 *  - Admin-created accounts are identified by their `user.create` audit row.
 *    Self-registration writes none, `createUser` writes one with a required
 *    non-null actorId, and nothing in this tree prunes auditLog, so the marker
 *    is both exclusive and durable.
 */
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { sendSystemMessage } from './pm';
import {
  sendInactivityWarningEmail,
  sendInactivityDisabledEmail
} from '../lib/mailer';
import { inactivity as inactivityConfig } from './config';
import { resolveSystemActorId } from './rankProgressionJob';
import {
  evaluateInactivity,
  InactivityInput,
  DISABLE_AFTER_DAYS,
  WARN_AFTER_DAYS,
  STAFF_LEVEL
} from './inactivity';

const log = getLogger('inactivityJob');

const STARTUP_DELAY_MS = 90_000;
const BATCH_SIZE = 500;

const WARN_SUBJECT = 'Your account is about to be deactivated';
const warnBody = (days: number) =>
  `Your account has been inactive for a long time and is scheduled to be deactivated in ${days} days. Signing in is enough to keep it — there is nothing else to do.`;

interface Candidate extends InactivityInput {
  id: number;
  email: string;
}

/**
 * Load one cursor-paged batch of accounts worth evaluating.
 *
 * The `where` is a coarse pre-filter, not the rule: it excludes what the
 * evaluator would exempt anyway, so a large member table is not walked in full
 * every night. The evaluator still re-checks every exemption, because a
 * pre-filter that silently disagreed with it would be invisible.
 */
const loadBatch = async (cursor: number | undefined): Promise<Candidate[]> => {
  const rows = await prisma.user.findMany({
    where: {
      disabled: false,
      isDonor: false,
      rankLocked: false,
      userRank: { level: { lt: STAFF_LEVEL } }
    },
    ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      email: true,
      lastLogin: true,
      dateRegistered: true,
      reactivatedAt: true,
      inactivityWarnedAt: true,
      disabled: true,
      isDonor: true,
      rankLocked: true,
      userRank: { select: { level: true } }
    },
    take: BATCH_SIZE,
    orderBy: { id: 'asc' }
  });

  // One query for the whole batch rather than one per user: `user.create` is
  // written from exactly one place, so its presence is the admin-created flag.
  const adminCreated = new Set(
    (
      await prisma.auditLog.findMany({
        where: {
          action: 'user.create',
          targetType: 'User',
          targetId: { in: rows.map((r) => r.id) }
        },
        select: { targetId: true }
      })
    ).flatMap((a) => (a.targetId === null ? [] : [a.targetId]))
  );

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    lastLogin: r.lastLogin,
    dateRegistered: r.dateRegistered,
    reactivatedAt: r.reactivatedAt,
    inactivityWarnedAt: r.inactivityWarnedAt,
    disabled: r.disabled,
    isDonor: r.isDonor,
    rankLocked: r.rankLocked,
    rankLevel: r.userRank.level,
    adminCreated: adminCreated.has(r.id)
  }));
};

/**
 * Send the warning and stamp it.
 *
 * The stamp is written whether or not the email left the building. That is a
 * deliberate call (#279): the System PM is the notice of record, and it is
 * delivered here because the account is not disabled yet — `sendSystemMessage`
 * refuses disabled recipients, so this ordering is the only one that works.
 * On a deployment with no SMTP configured the email is a no-op and the member
 * is told only through a channel they must sign in to read; `dryRun` plus the
 * per-cycle cap are what bound that.
 */
const applyWarn = async (user: Candidate): Promise<void> => {
  const grace = DISABLE_AFTER_DAYS - WARN_AFTER_DAYS;
  await sendSystemMessage(user.id, WARN_SUBJECT, warnBody(grace)).catch((err) =>
    log.error('Inactivity warning PM failed', { userId: user.id, err })
  );
  await sendInactivityWarningEmail(user.email, grace).catch((err) =>
    log.error('Inactivity warning email failed', { userId: user.id, err })
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { inactivityWarnedAt: new Date() }
  });
};

/**
 * Disable the account and tell them how to get it back.
 *
 * Order is load-bearing: the final email goes out BEFORE the update, because
 * once `disabled` is true the member has no readable channel left. Sessions are
 * revoked because a live cookie would otherwise keep working until it expires,
 * even though the auth middleware also rejects disabled users.
 */
const applyDisable = async (
  user: Candidate,
  reason: string,
  systemActorId: number
): Promise<void> => {
  await sendInactivityDisabledEmail(user.email).catch((err) =>
    log.error('Deactivation email failed', { userId: user.id, err })
  );

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { disabled: true } }),
    prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);

  // Same `user.disabled` action a staff disable writes, so the trail stays
  // uniform; the metadata is what says the engine did it and why.
  await audit(prisma, systemActorId, 'user.disabled', 'User', user.id, {
    by: 'inactivityJob',
    reason
  });
};

interface Tally {
  warned: number;
  disabled: number;
  deferred: number;
}

/**
 * Evaluate one account and apply the outcome, mutating the running tally.
 *
 * `mode` gates the WRITES only — every branch below still counts, because the
 * dry-run numbers are the whole reason that mode exists.
 */
const applyDecision = async (
  user: Candidate,
  now: Date,
  mode: 'dryRun' | 'on',
  systemActorId: number,
  tally: Tally
): Promise<void> => {
  const decision = evaluateInactivity(user, now);
  if (decision.action === 'none') return;

  if (decision.action === 'disable') {
    // The cap bounds disables only. A warning is undone by signing in; a
    // disable needs someone with `users_disable` to reverse it.
    if (tally.disabled >= inactivityConfig.maxDisablesPerCycle) {
      tally.deferred += 1;
      return;
    }
    if (mode === 'on') await applyDisable(user, decision.reason, systemActorId);
    tally.disabled += 1;
  } else {
    if (mode === 'on') await applyWarn(user);
    tally.warned += 1;
  }

  log.info(mode === 'dryRun' ? 'Would act on user' : 'Acted on user', {
    mode,
    action: decision.action,
    userId: user.id,
    reason: decision.reason
  });
};

export const runInactivityCycle = async (
  now: Date = new Date()
): Promise<{ warned: number; disabled: number; deferred: number }> => {
  const mode = inactivityConfig.mode;
  if (mode === 'off') return { warned: 0, disabled: 0, deferred: 0 };

  const systemActorId = await resolveSystemActorId();
  if (systemActorId === null) {
    log.warn('No SysOp found — inactivity sweep skipped');
    return { warned: 0, disabled: 0, deferred: 0 };
  }

  const tally: Tally = { warned: 0, disabled: 0, deferred: 0 };
  let cursor: number | undefined;

  // Paged with a cursor rather than a single `take`: a bare limit would mean the
  // same first N users are the only ones ever evaluated, and everyone past them
  // is immortal.
  for (;;) {
    const batch = await loadBatch(cursor);
    if (batch.length === 0) break;

    for (const user of batch) {
      await applyDecision(user, now, mode, systemActorId, tally);
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  if (tally.deferred > 0) {
    log.warn('Inactivity disable cap reached', {
      cap: inactivityConfig.maxDisablesPerCycle,
      deferred: tally.deferred
    });
  }
  log.info('Inactivity cycle complete', { mode, ...tally });
  return tally;
};

export const startInactivityJob = (): void => {
  if (inactivityConfig.mode === 'off') {
    log.info('Inactivity job disabled (INACTIVITY_MODE=off)');
    return;
  }

  const outer = setTimeout(() => {
    void runInactivityCycle().catch((err) =>
      log.error('Inactivity cycle failed', { err })
    );
    setInterval(
      () =>
        void runInactivityCycle().catch((err) =>
          log.error('Inactivity cycle failed', { err })
        ),
      inactivityConfig.intervalMs
    ).unref();
  }, STARTUP_DELAY_MS);
  outer.unref();

  log.info('Inactivity job scheduled', {
    mode: inactivityConfig.mode,
    intervalMs: inactivityConfig.intervalMs,
    maxDisablesPerCycle: inactivityConfig.maxDisablesPerCycle
  });
};

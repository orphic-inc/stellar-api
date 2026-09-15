import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { getRatioStats } from './ratio';
import { AppError } from '../lib/errors';
import { site } from './config';
import { sendSystemMessage } from './pm';
import { resolveSystemActorId } from './rankProgressionJob';
import {
  WATCH_DURATION_MS,
  decideRatioTransition,
  transitionTarget,
  type PolicyRow,
  type RatioTransition
} from './ratioPolicyRules';
import type { PageParams } from '../lib/pagination';
import type { RatioStats } from './ratio';

const log = getLogger('ratioPolicy');

/** The ui route that explains ratio, linked from every transition PM. */
const RATIO_RULES_PATH = '/ratio';

export interface PolicyStateView {
  status: RatioPolicyStatus;
  watchStartedAt: string | null;
  watchExpiresAt: string | null;
  downloadDisabledAt: string | null;
  /** Why downloads are disabled (#646); null unless `DOWNLOAD_DISABLED`. */
  disabledCause: RatioDisableCause | null;
  lastEvaluatedAt: string;
}

const serializeState = (s: {
  status: RatioPolicyStatus;
  watchStartedAt: Date | null;
  watchExpiresAt: Date | null;
  downloadDisabledAt: Date | null;
  disabledCause: RatioDisableCause | null;
  lastEvaluatedAt: Date;
}): PolicyStateView => ({
  status: s.status,
  watchStartedAt: s.watchStartedAt?.toISOString() ?? null,
  watchExpiresAt: s.watchExpiresAt?.toISOString() ?? null,
  downloadDisabledAt: s.downloadDisabledAt?.toISOString() ?? null,
  disabledCause: s.disabledCause,
  lastEvaluatedAt: s.lastEvaluatedAt.toISOString()
});

/** What applied a transition, recorded on its audit row (ADR-0044 §7). */
export type RatioEvaluator = 'download' | 'sweep';

const fmt = (n: number) => n.toFixed(2);

/** The System PM for each transition (ADR-0044 §7). */
const transitionMessage = (
  t: RatioTransition,
  stats: RatioStats,
  now: Date
): { subject: string; body: string } => {
  const numbers = `Your ratio is ${fmt(stats.ratio)}; your required ratio is ${fmt(stats.requiredRatio)}.`;
  const rules = `\n\nHow ratio works: ${RATIO_RULES_PATH}`;
  switch (t.kind) {
    case 'watch_started':
      return {
        subject: 'You are on ratio watch',
        body: `${numbers} You are on ratio watch until ${new Date(now.getTime() + WATCH_DURATION_MS).toUTCString()}. If your ratio is still short then, or you download 10 GiB or more before it is, your downloads will be disabled.${rules}`
      };
    case 'download_disabled':
      return {
        subject: 'Your downloads have been disabled',
        body: `${t.trigger === 'download_limit' ? 'You downloaded 10 GiB while on ratio watch' : 'Your ratio watch ended'} with your ratio still short, so your downloads have been disabled. ${numbers}${rules}`
      };
    case 'download_restored':
      return {
        subject: 'Your downloads have been restored',
        body: `Your ratio now meets its requirement, so your downloads have been restored. ${numbers}${rules}`
      };
    case 'watch_cleared':
      return {
        subject: 'You are off ratio watch',
        body: `Your ratio now meets its requirement, so your ratio watch has ended. ${numbers}${rules}`
      };
  }
};

/**
 * The claim on a policy row as it was read. Exported so a database test can
 * hold the claim on its own, apart from the evaluation that reads first.
 *
 * `?? null`: Prisma reads an undefined field as no filter at all, which would
 * silently widen the claim.
 */
export const ratioClaimWhere = (userId: number, row: PolicyRow) => ({
  userId,
  status: row.status,
  disabledCause: row.disabledCause ?? null,
  watchStartedAt: row.watchStartedAt ?? null
});

/**
 * Write one transition as a claim on the row as it was read (ADR-0044 §6).
 *
 * The claim matches `status`, `disabledCause` and `watchStartedAt`, so a
 * concurrent evaluation, or a staff override that landed after the read, leaves
 * nothing to move. `watchStartedAt` is what stops a stale read of an expired
 * watch from disabling a watch staff just re-set. `canDownload` and the audit
 * row are written only when this call moved the row. Returns whether it did.
 */
const claimTransition = async (
  userId: number,
  row: PolicyRow,
  t: RatioTransition,
  stats: RatioStats,
  consumed: bigint,
  by: RatioEvaluator,
  now: Date
): Promise<boolean> => {
  const target = transitionTarget(t, consumed, now);
  // A site without a SysOp is mid-install; the member is the next best actor.
  const actorId = (await resolveSystemActorId()) ?? userId;
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.ratioPolicyState.updateMany({
      where: ratioClaimWhere(userId, row),
      data: { ...target.row, lastEvaluatedAt: now }
    });
    if (count === 0) return false;

    await tx.user.update({
      where: { id: userId },
      data: { canDownload: target.canDownload }
    });
    await audit(tx, actorId, `ratioPolicy.${t.kind}`, 'User', userId, {
      from: row.status,
      fromCause: row.disabledCause,
      to: target.row.status,
      toCause: target.row.disabledCause,
      ratio: stats.ratio,
      requiredRatio: stats.requiredRatio,
      by,
      ...(t.kind === 'download_disabled' ? { trigger: t.trigger } : {})
    });
    return true;
  });
};

/**
 * Apply the ratio rules to one member (ADR-0044 §4): load, decide, claim, then
 * PM after the commit so a failed PM cannot undo the transition. Returns the
 * transition this call made, or `null`.
 *
 * Only a download may start a watch; the sweep passes `by: 'sweep'`.
 */
export const applyRatioRules = async (
  userId: number,
  by: RatioEvaluator,
  now: Date = new Date()
): Promise<RatioTransition | null> => {
  const [stats, user] = await Promise.all([
    getRatioStats(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { consumed: true }
    })
  ]);
  const row = await prisma.ratioPolicyState.upsert({
    where: { userId },
    update: {},
    create: { userId, status: RatioPolicyStatus.OK }
  });

  const t = decideRatioTransition(row, stats, user.consumed, now, {
    allowWatchStart: by === 'download'
  });
  if (
    t === null ||
    !(await claimTransition(userId, row, t, stats, user.consumed, by, now))
  ) {
    await prisma.ratioPolicyState.updateMany({
      where: { userId },
      data: { lastEvaluatedAt: now }
    });
    return null;
  }

  log.info('Ratio policy transition', { userId, transition: t, by });
  const { subject, body } = transitionMessage(t, stats, now);
  await sendSystemMessage(userId, subject, body).catch((err) =>
    log.error('Ratio policy PM failed', { userId, err })
  );
  return t;
};

/** After a download (`downloads.ts`), in the background. */
export const evaluateRatioPolicy = async (userId: number): Promise<void> => {
  await applyRatioRules(userId, 'download');
};

export const getPolicyState = async (
  userId: number
): Promise<PolicyStateView> => {
  const state = await prisma.ratioPolicyState.findUnique({ where: { userId } });
  if (!state) {
    return {
      status: RatioPolicyStatus.OK,
      watchStartedAt: null,
      watchExpiresAt: null,
      downloadDisabledAt: null,
      disabledCause: null,
      lastEvaluatedAt: new Date().toISOString()
    };
  }
  return serializeState(state);
};

export interface OverridePolicyInput {
  status: RatioPolicyStatus;
  reason: string;
  message?: string;
}

const OVERRIDE_SUBJECT: Record<RatioPolicyStatus, string> = {
  OK: 'Your ratio watch status was cleared',
  WATCH: 'You have been placed on ratio watch',
  DOWNLOAD_DISABLED: 'Your downloads have been disabled'
};

/** The row a staff override writes for `status`, from a clean slate. */
const overrideState = (
  status: RatioPolicyStatus,
  consumed: bigint,
  now: Date
) => {
  const watch = status === RatioPolicyStatus.WATCH;
  const disabled = status === RatioPolicyStatus.DOWNLOAD_DISABLED;
  return {
    status,
    lastEvaluatedAt: now,
    watchStartedAt: watch ? now : null,
    watchExpiresAt: watch ? new Date(now.getTime() + WATCH_DURATION_MS) : null,
    consumedAtWatchStart: watch ? consumed : null,
    downloadDisabledAt: disabled ? now : null,
    disabledCause: disabled ? RatioDisableCause.STAFF : null
  };
};

/**
 * Staff set a member's policy status (#646). An absolute write, so a staff
 * decision always wins over the automatic transitions.
 *
 *  - A staff `DOWNLOAD_DISABLED` records cause `STAFF` and never lifts itself;
 *    any other status clears the cause.
 *  - A staff `WATCH` stamps `consumedAtWatchStart` with the member's current
 *    `consumed`, so the 10 GiB rule applies to it. It used to write null, which
 *    the evaluator reads as nothing consumed, leaving a staff watch uncapped.
 *  - `reason` is for staff and lives in the audit row; `message` is for the
 *    member and is sent as a System PM after the write commits (the #636
 *    pattern), so a failed PM cannot undo the change.
 */
export const overridePolicyStatus = async (
  actorId: number,
  userId: number,
  { status, reason, message }: OverridePolicyInput
): Promise<PolicyStateView> => {
  const state = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { consumed: true }
    });
    if (!user) throw new AppError(404, 'User not found');
    const before = await tx.ratioPolicyState.findUnique({
      where: { userId },
      select: { status: true, disabledCause: true }
    });

    const data = overrideState(status, user.consumed, new Date());
    const disabled = status === RatioPolicyStatus.DOWNLOAD_DISABLED;

    const written = await tx.ratioPolicyState.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
    await tx.user.update({
      where: { id: userId },
      data: { canDownload: !disabled }
    });
    await audit(tx, actorId, 'ratioPolicy.override', 'User', userId, {
      from: before?.status ?? RatioPolicyStatus.OK,
      fromCause: before?.disabledCause ?? null,
      to: status,
      toCause: data.disabledCause,
      reason,
      messaged: message !== undefined
    });
    return written;
  });

  if (message !== undefined) {
    await sendSystemMessage(
      userId,
      OVERRIDE_SUBJECT[status],
      `${message}\n\nIf you have questions, contact staff through Staff PM: ${site.staffPmPath}`
    ).catch((err) =>
      log.error('Ratio policy override PM failed', { userId, err })
    );
  }

  return serializeState(state);
};

/**
 * Members on ratio watch or download-disabled, for staff, newest watch first.
 * An explicit select (#646): the route used `include`, which returned the whole
 * row and leaked the undocumented `consumedAtWatchStart`.
 */
export const listRatioWatch = async (pg: PageParams) => {
  const where = {
    status: {
      in: [RatioPolicyStatus.WATCH, RatioPolicyStatus.DOWNLOAD_DISABLED]
    }
  };
  const [rows, total] = await Promise.all([
    prisma.ratioPolicyState.findMany({
      where,
      select: {
        userId: true,
        user: { select: { id: true, username: true } },
        status: true,
        watchStartedAt: true,
        watchExpiresAt: true,
        downloadDisabledAt: true,
        disabledCause: true,
        lastEvaluatedAt: true
      },
      orderBy: { watchStartedAt: 'desc' },
      skip: pg.skip,
      take: pg.limit
    }),
    prisma.ratioPolicyState.count({ where })
  ]);
  return { rows, total };
};

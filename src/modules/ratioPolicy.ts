import { RatioDisableCause, RatioPolicyStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { getLogger } from './logging';
import { getRatioStats } from './ratio';
import { AppError } from '../lib/errors';
import { site } from './config';
import { sendSystemMessage } from './pm';
import type { PageParams } from '../lib/pagination';

const log = getLogger('ratioPolicy');

const WATCH_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const WATCH_DOWNLOAD_LIMIT = BigInt(10 * 1024 ** 3); // 10 GiB

/** The automatic disable's status and cause, written together (#646). */
const DISABLED_BY_RATIO = {
  status: RatioPolicyStatus.DOWNLOAD_DISABLED,
  disabledCause: RatioDisableCause.RATIO
};

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

export const evaluateRatioPolicy = async (userId: number): Promise<void> => {
  const [stats, user] = await Promise.all([
    getRatioStats(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { consumed: true }
    })
  ]);

  const state = await prisma.ratioPolicyState.upsert({
    where: { userId },
    update: {},
    create: { userId, status: RatioPolicyStatus.OK }
  });

  const now = new Date();
  const meetsRequirement = stats.meetsRequirement;

  if (state.status === RatioPolicyStatus.OK) {
    if (!meetsRequirement && stats.requiredRatio > 0) {
      log.info('User entering ratio watch', {
        userId,
        ratio: stats.ratio,
        required: stats.requiredRatio
      });
      await prisma.ratioPolicyState.update({
        where: { userId },
        data: {
          status: RatioPolicyStatus.WATCH,
          watchStartedAt: now,
          watchExpiresAt: new Date(now.getTime() + WATCH_DURATION_MS),
          consumedAtWatchStart: user.consumed,
          lastEvaluatedAt: now
        }
      });
    } else {
      await prisma.ratioPolicyState.update({
        where: { userId },
        data: { lastEvaluatedAt: now }
      });
    }
    return;
  }

  if (state.status === RatioPolicyStatus.WATCH) {
    if (meetsRequirement) {
      log.info('User exiting ratio watch (ratio restored)', { userId });
      await prisma.$transaction([
        prisma.ratioPolicyState.update({
          where: { userId },
          data: {
            status: RatioPolicyStatus.OK,
            watchStartedAt: null,
            watchExpiresAt: null,
            consumedAtWatchStart: null,
            lastEvaluatedAt: now
          }
        }),
        prisma.user.update({
          where: { id: userId },
          data: { canDownload: true }
        })
      ]);
      return;
    }

    const consumedDuringWatch =
      state.consumedAtWatchStart != null
        ? user.consumed - state.consumedAtWatchStart
        : 0n;
    const exceededDownloadLimit = consumedDuringWatch >= WATCH_DOWNLOAD_LIMIT;
    const watchExpired =
      state.watchExpiresAt != null && now >= state.watchExpiresAt;

    if (exceededDownloadLimit || watchExpired) {
      const reason = exceededDownloadLimit
        ? '10 GiB downloaded during watch'
        : 'watch period expired';
      log.warn('User download-disabled', { userId, reason });
      await prisma.$transaction([
        prisma.ratioPolicyState.update({
          where: { userId },
          data: {
            ...DISABLED_BY_RATIO,
            downloadDisabledAt: now,
            lastEvaluatedAt: now
          }
        }),
        prisma.user.update({
          where: { id: userId },
          data: { canDownload: false }
        })
      ]);
    } else {
      await prisma.ratioPolicyState.update({
        where: { userId },
        data: { lastEvaluatedAt: now }
      });
    }
    return;
  }

  // DOWNLOAD_DISABLED: only staff can change this; just refresh the timestamp
  await prisma.ratioPolicyState.update({
    where: { userId },
    data: { lastEvaluatedAt: now }
  });
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

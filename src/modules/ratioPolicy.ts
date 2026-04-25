import { RatioPolicyStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getLogger } from './logging';
import { getRatioStats } from './ratio';
import { AppError } from '../lib/errors';

const log = getLogger('ratioPolicy');

const WATCH_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const WATCH_DOWNLOAD_LIMIT = BigInt(10 * 1024 ** 3); // 10 GiB

export interface PolicyStateView {
  status: RatioPolicyStatus;
  watchStartedAt: string | null;
  watchExpiresAt: string | null;
  leechDisabledAt: string | null;
  lastEvaluatedAt: string;
}

const serializeState = (s: {
  status: RatioPolicyStatus;
  watchStartedAt: Date | null;
  watchExpiresAt: Date | null;
  leechDisabledAt: Date | null;
  lastEvaluatedAt: Date;
}): PolicyStateView => ({
  status: s.status,
  watchStartedAt: s.watchStartedAt?.toISOString() ?? null,
  watchExpiresAt: s.watchExpiresAt?.toISOString() ?? null,
  leechDisabledAt: s.leechDisabledAt?.toISOString() ?? null,
  lastEvaluatedAt: s.lastEvaluatedAt.toISOString()
});

export const evaluateRatioPolicy = async (userId: number): Promise<void> => {
  const [stats, user] = await Promise.all([
    getRatioStats(userId),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { downloaded: true }
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
          downloadedAtWatchStart: user.downloaded,
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
            downloadedAtWatchStart: null,
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

    const downloadedDuringWatch =
      state.downloadedAtWatchStart != null
        ? user.downloaded - state.downloadedAtWatchStart
        : 0n;
    const exceededDownloadLimit = downloadedDuringWatch >= WATCH_DOWNLOAD_LIMIT;
    const watchExpired =
      state.watchExpiresAt != null && now >= state.watchExpiresAt;

    if (exceededDownloadLimit || watchExpired) {
      const reason = exceededDownloadLimit
        ? '10 GiB downloaded during watch'
        : 'watch period expired';
      log.warn('User leech-disabled', { userId, reason });
      await prisma.$transaction([
        prisma.ratioPolicyState.update({
          where: { userId },
          data: {
            status: RatioPolicyStatus.LEECH_DISABLED,
            leechDisabledAt: now,
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

  // LEECH_DISABLED: only staff can change this; just refresh the timestamp
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
      leechDisabledAt: null,
      lastEvaluatedAt: new Date().toISOString()
    };
  }
  return serializeState(state);
};

export const overridePolicyStatus = async (
  userId: number,
  newStatus: RatioPolicyStatus
): Promise<PolicyStateView> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  });
  if (!user) throw new AppError(404, 'User not found');

  const now = new Date();
  const data: Parameters<typeof prisma.ratioPolicyState.upsert>[0]['create'] = {
    userId,
    status: newStatus,
    lastEvaluatedAt: now,
    watchStartedAt: newStatus === RatioPolicyStatus.WATCH ? now : null,
    watchExpiresAt:
      newStatus === RatioPolicyStatus.WATCH
        ? new Date(now.getTime() + WATCH_DURATION_MS)
        : null,
    downloadedAtWatchStart: null,
    leechDisabledAt: newStatus === RatioPolicyStatus.LEECH_DISABLED ? now : null
  };

  const [state] = await prisma.$transaction([
    prisma.ratioPolicyState.upsert({
      where: { userId },
      create: data,
      update: data
    }),
    prisma.user.update({
      where: { id: userId },
      data: { canDownload: newStatus !== RatioPolicyStatus.LEECH_DISABLED }
    })
  ]);

  return serializeState(state);
};

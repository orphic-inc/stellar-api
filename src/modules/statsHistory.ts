import { StatSnapshotPeriod, UserSettings } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { getSystemStats } from './stats';

// ─── Bucket helpers ──────────────────────────────────────────────────────────

function hourBucket(d = new Date()): Date {
  return new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
}

function dayBucket(d = new Date()): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function weekBucket(d = new Date()): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return new Date(
    Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())
  );
}

export function getBucket(period: StatSnapshotPeriod): Date {
  if (period === 'Daily') return hourBucket();
  if (period === 'Monthly') return dayBucket();
  return weekBucket();
}

export function getRetentionCutoff(period: StatSnapshotPeriod): Date {
  const now = new Date();
  if (period === 'Daily') return new Date(now.getTime() - 25 * 60 * 60 * 1000);
  if (period === 'Monthly')
    return new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000);
  return new Date(now.getTime() - 53 * 7 * 24 * 60 * 60 * 1000);
}

// ─── Capture functions ───────────────────────────────────────────────────────

type UserAggRow = {
  id: number;
  contributed: bigint;
  consumed: bigint;
  contributionCount: number;
};

export async function captureUserStats(
  period: StatSnapshotPeriod
): Promise<void> {
  const bucketAt = getBucket(period);

  const rows = await prisma.$queryRaw<UserAggRow[]>`
    SELECT u.id, u.contributed, u.consumed, COUNT(c.id)::int AS "contributionCount"
    FROM "users" u
    LEFT JOIN "contributions" c ON c."userId" = u.id
    WHERE u.disabled = false
    GROUP BY u.id, u.contributed, u.consumed
  `;

  if (rows.length > 0) {
    await prisma.userStatSnapshot.createMany({
      data: rows.map((r) => ({
        userId: r.id,
        period,
        bucketAt,
        contributed: r.contributed,
        consumed: r.consumed,
        contributionCount: r.contributionCount
      })),
      skipDuplicates: true
    });
  }

  await prisma.userStatSnapshot.deleteMany({
    where: { period, capturedAt: { lt: getRetentionCutoff(period) } }
  });
}

export async function captureSiteStats(): Promise<void> {
  const bucketAt = hourBucket();
  const stats = await getSystemStats();

  await prisma.siteStatSnapshot.upsert({
    where: { bucketAt },
    update: {},
    create: {
      bucketAt,
      maxUsers: stats.maxUsers,
      totalUsers: stats.totalUsers,
      enabledUsers: stats.enabledUsers,
      activeToday: stats.activeToday,
      activeThisWeek: stats.activeThisWeek,
      activeThisMonth: stats.activeThisMonth,
      communities: stats.communities,
      releases: stats.releases,
      artists: stats.artists,
      blogPosts: stats.blogPosts,
      announcements: stats.announcements,
      comments: stats.comments,
      contributedLinks: stats.contributedLinks,
      contributedLinkDownloads: stats.contributedLinkDownloads
    }
  });
}

// ─── Query functions ─────────────────────────────────────────────────────────

type UserWithSettings = {
  id: number;
  userSettings: UserSettings | null;
};

export async function getUserStatHistory(
  userId: number,
  period: StatSnapshotPeriod,
  requesterId: number,
  isRequesterStaff: boolean,
  userAndSettings: UserWithSettings
) {
  const isOwner = requesterId === userId;
  const settings = userAndSettings.userSettings;

  if (!isOwner && !isRequesterStaff) {
    const canSeeAny =
      settings?.showContributedStats || settings?.showConsumedStats;
    if (!canSeeAny) throw new AppError(403, 'Stats are private');
  }

  const rows = await prisma.userStatSnapshot.findMany({
    where: { userId, period },
    orderBy: { capturedAt: 'asc' }
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    period: row.period,
    capturedAt: row.capturedAt.toISOString(),
    contributed:
      isOwner || isRequesterStaff || settings?.showContributedStats
        ? row.contributed.toString()
        : null,
    consumed:
      isOwner || isRequesterStaff || settings?.showConsumedStats
        ? row.consumed.toString()
        : null,
    contributionCount: row.contributionCount
  }));
}

export async function getSiteStatHistory(limit = 100) {
  const rows = await prisma.siteStatSnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: limit
  });
  return rows.reverse();
}

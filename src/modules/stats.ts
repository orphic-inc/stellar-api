import { prisma } from '../lib/prisma';
import { countSeats, getSettings } from './settings';
import { SYSTEM_USERNAME } from './bootstrap';

/**
 * The reserved System user is site machinery, not a member: it owns built-in
 * fixtures, can never log in, and nobody signed up as it. Counting it inflates
 * `totalUsers` by one.
 *
 * Only the total needs this. `enabledUsers` already excludes it (System is
 * `disabled`), and the active-window counts filter on `lastLogin`, which System
 * never sets. `enabledUsers` is also the seat count `maxUsers` is enforced
 * against (#624), so it reads through the same `countSeats`.
 */
const EXCLUDE_SYSTEM = { username: { not: SYSTEM_USERNAME } };

export const getSystemStats = async () => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(now.getDate() - 30);

  const [
    totalUsers,
    enabledUsers,
    activeToday,
    activeThisWeek,
    activeThisMonth,
    communities,
    releases,
    artists,
    blogPosts,
    announcements,
    comments,
    contributedLinks,
    contributionDownloadCounts,
    settings
  ] = await Promise.all([
    prisma.user.count({ where: EXCLUDE_SYSTEM }),
    countSeats(),
    prisma.user.count({ where: { lastLogin: { gte: startOfToday } } }),
    prisma.user.count({ where: { lastLogin: { gte: startOfWeek } } }),
    prisma.user.count({ where: { lastLogin: { gte: startOfMonth } } }),
    prisma.community.count(),
    prisma.release.count(),
    prisma.artist.count({ where: { deletedAt: null } }),
    prisma.blog.count(),
    prisma.news.count(),
    prisma.comment.count({ where: { deletedAt: null } }),
    prisma.contribution.count(),
    prisma.contribution.findMany({
      select: { _count: { select: { consumers: true } } }
    }),
    getSettings()
  ]);

  const contributedLinkDownloads = contributionDownloadCounts.reduce(
    (sum, contribution) => sum + contribution._count.consumers,
    0
  );

  return {
    maxUsers: settings.maxUsers,
    totalUsers,
    enabledUsers,
    activeToday,
    activeThisWeek,
    activeThisMonth,
    communities,
    releases,
    artists,
    blogPosts,
    announcements,
    comments,
    contributedLinks,
    contributedLinkDownloads
  };
};

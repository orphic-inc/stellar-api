import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// GET /api/stats
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now);
    startOfMonth.setDate(now.getDate() - 30);

    const [
      enabledUsers,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      communities,
      releases,
      artists
    ] = await Promise.all([
      prisma.user.count({ where: { disabled: false } }),
      prisma.user.count({ where: { lastLogin: { gte: startOfToday } } }),
      prisma.user.count({ where: { lastLogin: { gte: startOfWeek } } }),
      prisma.user.count({ where: { lastLogin: { gte: startOfMonth } } }),
      prisma.community.count(),
      prisma.release.count(),
      prisma.artist.count()
    ]);

    res.json({ enabledUsers, activeToday, activeThisWeek, activeThisMonth, communities, releases, artists });
  })
);

export default router;

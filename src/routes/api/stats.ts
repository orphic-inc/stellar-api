import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  requirePermission,
  requireAdminOnly
} from '../../middleware/permissions';
import { prisma } from '../../lib/prisma';
import { getSystemStats } from '../../modules/stats';
import {
  getSiteStatHistory,
  captureSiteStats
} from '../../modules/statsHistory';

const router = express.Router();

// GET /api/stats/history — site-wide historical snapshots
router.get(
  '/history',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const snapshots = await getSiteStatHistory();
    res.json(snapshots);
  })
);

// POST /api/stats/snapshot — manually trigger a site stat snapshot (admin only)
router.post(
  '/snapshot',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    await captureSiteStats();
    res.sendStatus(204);
  })
);

// GET /api/stats
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await getSystemStats();
    res.json(stats);
  })
);

// GET /api/stats/economy — EconomyTransaction aggregates (staff)
router.get(
  '/economy',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [grouped, recent] = await Promise.all([
      prisma.economyTransaction.groupBy({
        by: ['reason'],
        _sum: { amount: true },
        _count: true
      }),
      prisma.economyTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { id: true, username: true } } }
      })
    ]);
    res.json({ grouped, recent });
  })
);

// GET /api/stats/releases — release and contribution counts (staff)
router.get(
  '/releases',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [releases, contributions, byType, byLinkStatus, artists] =
      await Promise.all([
        prisma.release.count(),
        prisma.contribution.count(),
        prisma.contribution.groupBy({ by: ['type'], _count: true }),
        prisma.contribution.groupBy({ by: ['linkStatus'], _count: true }),
        prisma.artist.count()
      ]);
    res.json({ releases, contributions, byType, byLinkStatus, artists });
  })
);

// GET /api/stats/clients — top 50 user agent strings (staff)
router.get(
  '/clients',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.userSession.groupBy({
      by: ['userAgent'],
      _count: { userAgent: true },
      orderBy: { _count: { userAgent: 'desc' } },
      take: 50
    });
    res.json(
      rows.map((r) => ({ userAgent: r.userAgent, count: r._count.userAgent }))
    );
  })
);

// GET /api/stats/user-flow — invite funnel + last 12 site stat snapshots (staff)
router.get(
  '/user-flow',
  ...requirePermission('admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [inviteFunnel, snapshots] = await Promise.all([
      prisma.invite.groupBy({ by: ['status'], _count: true }),
      prisma.siteStatSnapshot.findMany({
        orderBy: { bucketAt: 'desc' },
        take: 12,
        select: { bucketAt: true, totalUsers: true, activeThisMonth: true }
      })
    ]);
    res.json({ inviteFunnel, snapshots });
  })
);

// GET /api/stats/site-info — aggregate DB counts (admin only)
router.get(
  '/site-info',
  ...requireAdminOnly(),
  asyncHandler(async (_req: Request, res: Response) => {
    const [
      totalUsers,
      enabledUsers,
      disabledUsers,
      releases,
      artists,
      contributions,
      communities,
      forumTopics,
      forumPosts,
      collages,
      wikiPages
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { disabled: false } }),
      prisma.user.count({ where: { disabled: true } }),
      prisma.release.count(),
      prisma.artist.count(),
      prisma.contribution.count(),
      prisma.community.count(),
      prisma.forumTopic.count({ where: { deletedAt: null } }),
      prisma.forumPost.count({ where: { deletedAt: null } }),
      prisma.collage.count({ where: { isDeleted: false } }),
      prisma.wikiPage.count()
    ]);
    res.json({
      totalUsers,
      enabledUsers,
      disabledUsers,
      releases,
      artists,
      contributions,
      communities,
      forumTopics,
      forumPosts,
      collages,
      wikiPages
    });
  })
);

export default router;

import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
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

export default router;

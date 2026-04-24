import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { getSystemStats } from '../../modules/stats';

const router = express.Router();

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

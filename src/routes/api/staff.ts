import express, { Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../modules/asyncHandler';
import { getStaffList } from '../../modules/staff';

const router = express.Router();

// GET /api/staff — staff listing, accessible to all authenticated users
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getStaffList());
  })
);

export default router;

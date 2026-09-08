import express, { Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../modules/asyncHandler';
import { getStaffList } from '../../modules/staff';
import { resolveViewer } from '../../modules/bbcodeRender';

const router = express.Router();

// GET /api/staff — staff listing, accessible to all authenticated users
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getStaffList(await resolveViewer(req)));
  })
);

export default router;

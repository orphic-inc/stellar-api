import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { validateQuery, parsedQuery } from '../../middleware/validate';
import {
  releasesQuerySchema,
  usersQuerySchema,
  tagsQuerySchema,
  votesQuerySchema,
  historyQuerySchema,
  type ReleasesQuery,
  type UsersQuery,
  type TagsQuery,
  type VotesQuery,
  type HistoryQuery
} from '../../schemas/top10';
import {
  getTopReleases,
  getTopUsers,
  getTopTags,
  getTopVotedReleases,
  getHistorySnapshot,
  createSnapshot
} from '../../modules/top10';

const router = express.Router();

// GET /api/top10/releases
router.get(
  '/releases',
  requireAuth,
  validateQuery(releasesQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<ReleasesQuery>(res);
    const items = await getTopReleases(q);
    res.json({ items });
  })
);

// GET /api/top10/users
router.get(
  '/users',
  requireAuth,
  validateQuery(usersQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<UsersQuery>(res);
    const items = await getTopUsers(q);
    res.json({ items });
  })
);

// GET /api/top10/tags
router.get(
  '/tags',
  requireAuth,
  validateQuery(tagsQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<TagsQuery>(res);
    const items = await getTopTags(q);
    res.json({ items });
  })
);

// GET /api/top10/votes
router.get(
  '/votes',
  requireAuth,
  validateQuery(votesQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<VotesQuery>(res);
    const items = await getTopVotedReleases(q);
    res.json({ items });
  })
);

// GET /api/top10/history  (staff only)
router.get(
  '/history',
  ...requirePermission('staff'),
  validateQuery(historyQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<HistoryQuery>(res);
    const snapshot = await getHistorySnapshot(q);
    if (!snapshot) {
      res.status(404).json({ msg: 'No snapshot found for this date and type' });
      return;
    }
    res.json(snapshot);
  })
);

// POST /api/top10/snapshot  (admin only — cron trigger)
router.post(
  '/snapshot',
  ...requirePermission('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const type =
      req.body?.type === 'Weekly' ? ('Weekly' as const) : ('Daily' as const);
    await createSnapshot(type);
    res.json({ msg: 'Snapshot created' });
  })
);

export default router;

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
import { top10Cache } from '../../lib/ttlCache';

const router = express.Router();

const TTL = {
  releases: 6 * 60 * 60 * 1000,
  users: 12 * 60 * 60 * 1000,
  tags: 12 * 60 * 60 * 1000,
  votes: 30 * 60 * 1000,
  history: 24 * 60 * 60 * 1000
} as const;

// GET /api/top10/releases
router.get(
  '/releases',
  requireAuth,
  validateQuery(releasesQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<ReleasesQuery>(res);
    const key = `releases:${JSON.stringify(q)}`;
    const cached = top10Cache.get<{ items: unknown[] }>(key);
    if (cached) return res.json(cached);
    const items = await getTopReleases(q);
    const body = { items };
    top10Cache.set(key, body, TTL.releases);
    res.json(body);
  })
);

// GET /api/top10/users
router.get(
  '/users',
  requireAuth,
  validateQuery(usersQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<UsersQuery>(res);
    const key = `users:${JSON.stringify(q)}`;
    const cached = top10Cache.get<{ items: unknown[] }>(key);
    if (cached) return res.json(cached);
    const items = await getTopUsers(q);
    const body = { items };
    top10Cache.set(key, body, TTL.users);
    res.json(body);
  })
);

// GET /api/top10/tags
router.get(
  '/tags',
  requireAuth,
  validateQuery(tagsQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<TagsQuery>(res);
    const key = `tags:${JSON.stringify(q)}`;
    const cached = top10Cache.get<{ items: unknown[] }>(key);
    if (cached) return res.json(cached);
    const items = await getTopTags(q);
    const body = { items };
    top10Cache.set(key, body, TTL.tags);
    res.json(body);
  })
);

// GET /api/top10/votes
router.get(
  '/votes',
  requireAuth,
  validateQuery(votesQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<VotesQuery>(res);
    const key = `votes:${JSON.stringify(q)}`;
    const cached = top10Cache.get<{ items: unknown[] }>(key);
    if (cached) return res.json(cached);
    const items = await getTopVotedReleases(q);
    const body = { items };
    top10Cache.set(key, body, TTL.votes);
    res.json(body);
  })
);

// GET /api/top10/history  (staff only)
router.get(
  '/history',
  ...requirePermission('staff'),
  validateQuery(historyQuerySchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const q = parsedQuery<HistoryQuery>(res);
    const key = `history:${JSON.stringify(q)}`;
    const cached = top10Cache.get<object>(key);
    if (cached) return res.json(cached);
    const snapshot = await getHistorySnapshot(q);
    if (!snapshot) {
      res.status(404).json({ msg: 'No snapshot found for this date and type' });
      return;
    }
    top10Cache.set(key, snapshot, TTL.history);
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

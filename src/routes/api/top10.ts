import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { validate, validateQuery } from '../../middleware/validate';
import {
  releasesQuerySchema,
  usersQuerySchema,
  tagsQuerySchema,
  votesQuerySchema,
  historyQuerySchema,
  snapshotSchema
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
const votesQuery = validateQuery(votesQuerySchema);
const usersQuery = validateQuery(usersQuerySchema);
const tagsQuery = validateQuery(tagsQuerySchema);
const snapshotBody = validate(snapshotSchema);
const releasesQuery = validateQuery(releasesQuerySchema);
const historyQuery = validateQuery(historyQuerySchema);

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
  releasesQuery,
  asyncHandler(async (_req: Request, res: Response) => {
    const q = releasesQuery.read(res);
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
  usersQuery,
  asyncHandler(async (_req: Request, res: Response) => {
    const q = usersQuery.read(res);
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
  tagsQuery,
  asyncHandler(async (_req: Request, res: Response) => {
    const q = tagsQuery.read(res);
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
  votesQuery,
  asyncHandler(async (_req: Request, res: Response) => {
    const q = votesQuery.read(res);
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
  historyQuery,
  asyncHandler(async (_req: Request, res: Response) => {
    const q = historyQuery.read(res);
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
//
// `type` selects the WINDOW the snapshot captures, not just the label it is
// filed under — Daily is the last 24h, Weekly the last 7 days. It used to be
// read straight off `req.body?.type` with anything that was not exactly
// 'Weekly' silently coerced to 'Daily', so a caller sending 'weekly' got a
// daily snapshot and a 200. It now validates like every other mutating route:
// a bad value is a 400, and an absent body still defaults to Daily.
router.post(
  '/snapshot',
  ...requirePermission('admin'),
  snapshotBody,
  asyncHandler(async (_req: Request, res: Response) => {
    const { type } = snapshotBody.read(res);
    await createSnapshot(type);
    res.json({ msg: 'Snapshot created' });
  })
);

export default router;

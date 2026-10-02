import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../../modules/asyncHandler';
import { listLeadershipLog } from '../../../modules/communityLeadership';
import { requireAuth } from '../../../middleware/auth';
import { loadPermissions } from '../../../middleware/permissions';
import {
  parsedParams,
  validateParams,
  validateQuery
} from '../../../middleware/validate';
import {
  paginatedResponse,
  paginationBase,
  parsedPage
} from '../../../lib/pagination';

/**
 * A community's leadership log, mounted at
 * `/api/communities/:id/leadership-log` (#897, ADR-0054). The rules live in
 * modules/communityLeadership.ts.
 */
const router = express.Router({ mergeParams: true });
const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const querySchema = z.object({ ...paginationBase });

// GET /api/communities/:id/leadership-log — who led the community, and when
router.get(
  '/',
  requireAuth,
  validateParams(paramsSchema),
  validateQuery(querySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const pg = parsedPage(res);
    const perms = await loadPermissions(req, res);
    const isStaff = !!(perms['communities_manage'] || perms['admin']);
    const { data, total } = await listLeadershipLog(id, req.user.id, isStaff, {
      skip: pg.skip,
      limit: pg.limit
    });
    paginatedResponse(res, data, total, pg);
  })
);

export default router;

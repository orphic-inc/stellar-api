import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../../modules/asyncHandler';
import { listLeadershipLog } from '../../../modules/communityLeadership';
import { requireAuth } from '../../../middleware/auth';
import { loadPermissions } from '../../../middleware/permissions';
import { validateParams, validateQuery } from '../../../middleware/validate';
import {
  paginatedResponse,
  paginationBase,
  pageOf
} from '../../../lib/pagination';

/**
 * A community's leadership log, mounted at
 * `/api/communities/:id/leadership-log` (#897, ADR-0054). The rules live in
 * modules/communityLeadership.ts.
 */
const router = express.Router({ mergeParams: true });
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const idParams = validateParams(idParamsSchema);
const leadershipLogQuerySchema = z.object({ ...paginationBase });
const leadershipLogQuery = validateQuery(leadershipLogQuerySchema);

// GET /api/communities/:id/leadership-log — who led the community, and when
router.get(
  '/',
  requireAuth,
  idParams,
  leadershipLogQuery,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    const pg = pageOf(leadershipLogQuery.read(res));
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

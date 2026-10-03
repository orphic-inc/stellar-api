import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requirePermission } from '../../../middleware/permissions';
import { validateQuery } from '../../../middleware/validate';
import {
  paginatedResponse,
  paginationBase,
  parsedPage
} from '../../../lib/pagination';

/**
 * Every community, for staff administering them (#902, ADR-0055). Mounted at
 * `/api/communities/manage`, ahead of `/:id`.
 *
 * The member browse (`GET /communities`) lists what the caller can read; this
 * lists what staff administer, closed communities included. It returns the
 * browse's projection, which is the administrative record, never contents.
 */
const router = express.Router();
const querySchema = z.object({ ...paginationBase });

// GET /api/communities/manage — every community (communities_manage)
router.get(
  '/',
  ...requirePermission('communities_manage'),
  validateQuery(querySchema),
  asyncHandler(async (_req, res) => {
    const pg = parsedPage(res);
    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        orderBy: { id: 'asc' },
        skip: pg.skip,
        take: pg.limit,
        include: {
          curators: { select: { id: true, username: true } },
          _count: {
            select: { contributors: true, releases: true, consumers: true }
          }
        }
      }),
      prisma.community.count()
    ]);
    paginatedResponse(res, communities, total, pg);
  })
);

export default router;

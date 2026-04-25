import { Router } from 'express';
import {
  requirePermission,
  loadPermissions
} from '../../middleware/permissions';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateQuery,
  validateParams,
  parsedBody,
  parsedQuery,
  parsedParams
} from '../../middleware/validate';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import * as requestModule from '../../modules/requests';
import { prisma } from '../../lib/prisma';
import {
  createRequestSchema,
  addBountySchema,
  fillRequestSchema,
  unfillRequestSchema,
  listRequestsQuerySchema,
  requestIdParamsSchema,
  type ListRequestsQuery
} from '../../schemas/requests';
import { AppError } from '../../lib/errors';
import type { AuthenticatedRequest } from '../../types/auth';

const router = Router();

// ─── GET /requests — list with filters ────────────────────────────────────────

router.get(
  '/',
  validateQuery(listRequestsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<ListRequestsQuery>(res);
    const result = await requestModule.listRequests({
      page: q.page,
      limit: q.limit,
      communityId: q.communityId,
      status: q.status
    });
    res.json(result);
  })
);

// ─── POST /requests — create ───────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  validate(createRequestSchema),
  authHandler(async (req, res) => {
    const request = await requestModule.createRequest(
      req.user.id,
      parsedBody(res)
    );
    res.status(201).json(request);
  })
);

// ─── GET /requests/:id — detail ────────────────────────────────────────────────

router.get(
  '/:id',
  validateParams(requestIdParamsSchema),
  asyncHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const request = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, username: true } },
        filler: { select: { id: true, username: true } },
        community: { select: { id: true, name: true } },
        artists: { include: { artist: true } },
        bounties: {
          include: { user: { select: { id: true, username: true } } }
        },
        filledContribution: {
          include: {
            release: { select: { id: true, title: true } },
            user: { select: { id: true, username: true } }
          }
        }
      }
    });
    if (!request) throw new AppError(404, 'Request not found');
    res.json(requestModule.serializeRequest(request));
  })
);

// ─── POST /requests/:id/bounty — add bounty ────────────────────────────────────

router.post(
  '/:id/bounty',
  requireAuth,
  validateParams(requestIdParamsSchema),
  validate(addBountySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { amount } = parsedBody<{ amount: bigint }>(res);
    const request = await requestModule.addBounty(req.user.id, id, amount);
    res.json(request);
  })
);

// ─── POST /requests/:id/fill — fill a request ──────────────────────────────────

router.post(
  '/:id/fill',
  requireAuth,
  validateParams(requestIdParamsSchema),
  validate(fillRequestSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { contributionId } = parsedBody<{ contributionId: number }>(res);
    const request = await requestModule.fillRequest(
      req.user.id,
      id,
      contributionId
    );
    res.json(request);
  })
);

// ─── POST /requests/:id/unfill — staff unfill ─────────────────────────────────

router.post(
  '/:id/unfill',
  ...requirePermission('staff', 'admin'),
  validateParams(requestIdParamsSchema),
  validate(unfillRequestSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { reason } = parsedBody<{ reason?: string }>(res);
    const request = await requestModule.unfillRequest(req.user.id, id, reason);
    res.json(request);
  })
);

// ─── DELETE /requests/:id — owner or staff delete ──────────────────────────────
// Owners may delete their own open requests; staff may delete any (including filled).

router.delete(
  '/:id',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const existing = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      select: { userId: true, status: true }
    });
    if (!existing) throw new AppError(404, 'Request not found');

    const perms = await loadPermissions(req, res);
    const isStaff = !!(perms['staff'] || perms['admin']);
    const isOwner = existing.userId === req.user.id;

    if (!isOwner && !isStaff) throw new AppError(403, 'Permission denied');

    await requestModule.deleteRequest(req.user.id, id, isStaff);
    res.status(204).end();
  })
);

export default router;

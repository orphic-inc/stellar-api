import { Router } from 'express';
import { loadPermissions } from '../../middleware/permissions';
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
import { hasPermission } from '../../lib/rankPermissions';
import {
  createRequestSchema,
  updateRequestSchema,
  addBountySchema,
  fillRequestSchema,
  unfillRequestSchema,
  listRequestsQuerySchema,
  requestIdParamsSchema,
  type ListRequestsQuery,
  type UpdateRequestInput
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
      q: q.q,
      artist: q.artist,
      type: q.type,
      year: q.year,
      page: q.page,
      limit: q.limit,
      communityId: q.communityId,
      status: q.status,
      orderBy: q.orderBy,
      order: q.order
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
    const perms = await loadPermissions(req, res);
    if (!hasPermission(perms, 'requests_create')) {
      throw new AppError(403, 'Permission denied');
    }
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
        },
        votes: { select: { userId: true } }
      }
    });
    if (!request) throw new AppError(404, 'Request not found');
    const serialized = requestModule.serializeRequest(request);
    res.json({
      ...serialized,
      voteCount: request.voteCount,
      votes: request.votes
    });
  })
);

// ─── POST /requests/:id/vote — toggle vote ─────────────────────────────────────

router.post(
  '/:id/vote',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const request = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      select: { id: true }
    });
    if (!request) throw new AppError(404, 'Request not found');

    const existing = await prisma.requestVote.findUnique({
      where: { requestId_userId: { requestId: id, userId: req.user.id } }
    });

    if (existing) {
      await prisma.$transaction([
        prisma.requestVote.delete({
          where: { requestId_userId: { requestId: id, userId: req.user.id } }
        }),
        prisma.request.update({
          where: { id },
          data: { voteCount: { decrement: 1 } }
        })
      ]);
      return res.json({ voted: false });
    }

    await prisma.$transaction([
      prisma.requestVote.create({
        data: { requestId: id, userId: req.user.id }
      }),
      prisma.request.update({
        where: { id },
        data: { voteCount: { increment: 1 } }
      })
    ]);
    res.json({ voted: true });
  })
);

// ─── GET /requests/:id/bounty-history ──────────────────────────────────────────

router.get(
  '/:id/bounty-history',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const request = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      select: { id: true }
    });
    if (!request) throw new AppError(404, 'Request not found');

    const [bounties, actions] = await Promise.all([
      prisma.requestBounty.findMany({
        where: { requestId: id },
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.requestAction.findMany({
        where: { requestId: id },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.json({ bounties, actions });
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

// ─── PUT /requests/:id — owner or staff edit ──────────────────────────────────

router.put(
  '/:id',
  requireAuth,
  validateParams(requestIdParamsSchema),
  validate(updateRequestSchema),
  authHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const input = parsedBody<UpdateRequestInput>(res);

    const existing = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      select: { userId: true, status: true }
    });
    if (!existing) throw new AppError(404, 'Request not found');
    if (existing.status !== 'open')
      throw new AppError(422, 'Only open requests can be edited');

    const perms = await loadPermissions(req, res);
    const isStaff = hasPermission(perms, 'requests_moderate');
    if (existing.userId !== req.user.id && !isStaff)
      throw new AppError(403, 'Permission denied');

    const updated = await prisma.request.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description
        }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.year !== undefined && { year: input.year }),
        ...(input.image !== undefined && { image: input.image })
      },
      include: {
        user: { select: { id: true, username: true } },
        bounties: true
      }
    });
    res.json(requestModule.serializeRequest(updated));
  })
);

// ─── POST /requests/:id/unfill — owner, filler, or staff unfill ───────────────

router.post(
  '/:id/unfill',
  requireAuth,
  validateParams(requestIdParamsSchema),
  validate(unfillRequestSchema),
  authHandler(async (req: AuthenticatedRequest, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { reason } = parsedBody<{ reason?: string }>(res);

    const existing = await prisma.request.findUnique({
      where: { id, deletedAt: null },
      select: { userId: true, fillerId: true, status: true }
    });
    if (!existing) throw new AppError(404, 'Request not found');
    if (existing.status !== 'filled')
      throw new AppError(422, 'Request is not filled');

    const perms = await loadPermissions(req, res);
    const isStaff = hasPermission(perms, 'requests_moderate');
    const isOwner = existing.userId === req.user.id;
    const isFiller = existing.fillerId === req.user.id;

    if (!isStaff && !isOwner && !isFiller)
      throw new AppError(403, 'Permission denied');

    const request = await requestModule.unfillRequest(req.user.id, id, reason);
    res.json(request);
  })
);

// ─── DELETE /requests/:id — owner or staff delete ──────────────────────────────

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
    const isStaff = hasPermission(perms, 'requests_moderate');
    const isOwner = existing.userId === req.user.id;

    if (!isOwner && !isStaff) throw new AppError(403, 'Permission denied');

    await requestModule.deleteRequest(req.user.id, id, isStaff);
    res.status(204).end();
  })
);

export default router;

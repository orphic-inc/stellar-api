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
import * as requestLifecycle from '../../modules/requestLifecycle';
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

const router = Router();

// ─── GET /requests — list with filters ────────────────────────────────────────

router.get(
  '/',
  validateQuery(listRequestsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<ListRequestsQuery>(res);
    const result = await requestLifecycle.listRequests({
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
    const request = await requestLifecycle.createRequest(
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
  asyncHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await requestLifecycle.getRequestDetail(id);
    res.json(result);
  })
);

// ─── POST /requests/:id/vote — toggle vote ─────────────────────────────────────

router.post(
  '/:id/vote',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await requestLifecycle.toggleVote(id, req.user.id);
    res.json(result);
  })
);

// ─── GET /requests/:id/bounty-history ──────────────────────────────────────────

router.get(
  '/:id/bounty-history',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await requestLifecycle.getBountyHistory(id);
    res.json(result);
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
    const request = await requestLifecycle.addBounty(req.user.id, id, amount);
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
    const request = await requestLifecycle.fillRequest(
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
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const input = parsedBody<UpdateRequestInput>(res);
    const perms = await loadPermissions(req, res);
    const canModerateRequests = hasPermission(perms, 'requests_moderate');
    const updated = await requestLifecycle.updateRequest({
      requestId: id,
      actorId: req.user.id,
      canModerateRequests,
      input
    });
    res.json(updated);
  })
);

// ─── POST /requests/:id/unfill — owner, filler, or staff unfill ───────────────

router.post(
  '/:id/unfill',
  requireAuth,
  validateParams(requestIdParamsSchema),
  validate(unfillRequestSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { reason } = parsedBody<{ reason?: string }>(res);
    const perms = await loadPermissions(req, res);
    const canModerateRequests = hasPermission(perms, 'requests_moderate');
    const request = await requestLifecycle.unfillRequest({
      requestId: id,
      actorId: req.user.id,
      canModerateRequests,
      reason
    });
    res.json(request);
  })
);

// ─── DELETE /requests/:id — owner or staff delete ──────────────────────────────

router.delete(
  '/:id',
  requireAuth,
  validateParams(requestIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const perms = await loadPermissions(req, res);
    const canModerateRequests = hasPermission(perms, 'requests_moderate');
    await requestLifecycle.deleteRequest({
      requestId: id,
      actorId: req.user.id,
      canModerateRequests
    });
    res.status(204).end();
  })
);

export default router;

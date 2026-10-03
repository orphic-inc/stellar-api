import { Router } from 'express';
import { loadPermissions } from '../../middleware/permissions';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateQuery,
  validateParams
} from '../../middleware/validate';
import { authHandler } from '../../modules/asyncHandler';
import * as requestLifecycle from '../../modules/requestLifecycle';
import { hasPermission } from '../../lib/rankPermissions';
import {
  createRequestSchema,
  updateRequestSchema,
  addBountySchema,
  fillRequestSchema,
  unfillRequestSchema,
  listRequestsQuerySchema,
  requestIdParamsSchema
} from '../../schemas/requests';
import { AppError } from '../../lib/errors';

const router = Router();
const updateRequestBody = validate(updateRequestSchema);
const unfillRequestBody = validate(unfillRequestSchema);
const requestIdParams = validateParams(requestIdParamsSchema);
const listRequestsQuery = validateQuery(listRequestsQuerySchema);
const fillRequestBody = validate(fillRequestSchema);
const createRequestBody = validate(createRequestSchema);
const addBountyBody = validate(addBountySchema);

// ─── GET /requests — list with filters ────────────────────────────────────────

// Gated and community-scoped as of #547. `communityId` was a caller-supplied
// filter with no session required, so private communities' requests — and their
// NAMES, which the projection carries — were readable by anyone. Identical to
// the defect #509 F2 fixed on `/search/requests`, left live on the browse path.
router.get(
  '/',
  requireAuth,
  listRequestsQuery,
  authHandler(async (req, res) => {
    const q = listRequestsQuery.read(res);
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
      order: q.order,
      viewerId: req.user.id
    });
    res.json(result);
  })
);

// ─── POST /requests — create ───────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  createRequestBody,
  authHandler(async (req, res) => {
    const perms = await loadPermissions(req, res);
    if (!hasPermission(perms, 'requests_create')) {
      throw new AppError(403, 'Permission denied');
    }
    const request = await requestLifecycle.createRequest(
      req.user.id,
      createRequestBody.read(res)
    );
    res.status(201).json(request);
  })
);

// ─── GET /requests/:id — detail ────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth,
  requestIdParams,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const result = await requestLifecycle.getRequestDetail(id, req.user.id);
    res.json(result);
  })
);

// ─── POST /requests/:id/vote — toggle vote ─────────────────────────────────────

router.post(
  '/:id/vote',
  requireAuth,
  requestIdParams,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const result = await requestLifecycle.toggleVote(id, req.user.id);
    res.json(result);
  })
);

// ─── GET /requests/:id/bounty-history ──────────────────────────────────────────

router.get(
  '/:id/bounty-history',
  requireAuth,
  requestIdParams,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const result = await requestLifecycle.getBountyHistory(id, req.user.id);
    res.json(result);
  })
);

// ─── POST /requests/:id/bounty — add bounty ────────────────────────────────────

router.post(
  '/:id/bounty',
  requireAuth,
  requestIdParams,
  addBountyBody,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const { amount } = addBountyBody.read(res);
    const request = await requestLifecycle.addBounty(req.user.id, id, amount);
    res.json(request);
  })
);

// ─── POST /requests/:id/fill — fill a request ──────────────────────────────────

router.post(
  '/:id/fill',
  requireAuth,
  requestIdParams,
  fillRequestBody,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const { contributionId } = fillRequestBody.read(res);
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
  requestIdParams,
  updateRequestBody,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const input = updateRequestBody.read(res);
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
  requestIdParams,
  unfillRequestBody,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
    const { reason } = unfillRequestBody.read(res);
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
  requestIdParams,
  authHandler(async (req, res) => {
    const { id } = requestIdParams.read(res);
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

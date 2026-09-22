import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { parsedPage, paginatedResponse } from '../../lib/pagination';
import {
  catchUpNotificationFilterHits,
  clearReadNotificationFilterHits,
  countUnreadNotificationFilterHits,
  createNotificationFilter,
  deleteNotificationFilter,
  deleteNotificationFilterHit,
  getFilterAllowance,
  listNotificationFilterHits,
  listNotificationFilters,
  markNotificationFilterHitRead,
  updateNotificationFilter
} from '../../modules/notificationFilters';
import {
  markNotificationFilterHitReadSchema,
  notificationFilterCatchupSchema,
  notificationFilterHitScopeSchema,
  notificationFilterHitsQuerySchema,
  notificationFilterSchema,
  type MarkNotificationFilterHitReadInput,
  type NotificationFilterCatchupInput,
  type NotificationFilterHitScope,
  type NotificationFilterHitsQuery,
  type NotificationFilterInput
} from '../../schemas/notificationFilters';

/**
 * Contribution notification filters (#263, ADR-0049).
 *
 * THE RANK ALLOWANCE IS THE ONLY GATE. Every handler opens with
 * `getFilterAllowance`, which answers 403 for a rank whose
 * `notificationFilterLimit` is `0`. It runs in the handler rather than as
 * middleware because no route-gate kind describes it (`lib/routeGate.ts`), so
 * each operation declares that 403 in `lib/openapi.ts` by hand.
 *
 * Hit routes address a CONTRIBUTION, not a hit row: the member-facing list
 * shows one item per contribution however many filters caught it, so that is
 * the identity a read or a delete names. `filterId` narrows either to one
 * filter's row.
 */
const router = express.Router();

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const contributionParamsSchema = z.object({
  contributionId: z.coerce.number().int().positive()
});

// ─── Hits (static segments, so registered before /:id) ────────────────────────

// GET /api/notification-filters/hits — contributions caught, one item each.
router.get(
  '/hits',
  requireAuth,
  validateQuery(notificationFilterHitsQuerySchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { filterId, unread } = parsedQuery<NotificationFilterHitsQuery>(res);
    const pg = parsedPage(res);
    const { items, total } = await listNotificationFilterHits(req.user.id, {
      filterId,
      unread,
      skip: pg.skip,
      take: pg.limit
    });
    paginatedResponse(res, items, total, pg);
  })
);

// GET /api/notification-filters/hits/unread-count — contributions, not rows.
router.get(
  '/hits/unread-count',
  requireAuth,
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    res.json({ count: await countUnreadNotificationFilterHits(req.user.id) });
  })
);

// POST /api/notification-filters/hits/read — one contribution's hits.
router.post(
  '/hits/read',
  requireAuth,
  validate(markNotificationFilterHitReadSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { contributionId, filterId } =
      parsedBody<MarkNotificationFilterHitReadInput>(res);
    await markNotificationFilterHitRead(req.user.id, contributionId, filterId);
    res.status(204).send();
  })
);

// POST /api/notification-filters/hits/catchup — everything, or one filter.
router.post(
  '/hits/catchup',
  requireAuth,
  validate(notificationFilterCatchupSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { filterId } = parsedBody<NotificationFilterCatchupInput>(res);
    await catchUpNotificationFilterHits(req.user.id, filterId);
    res.status(204).send();
  })
);

// DELETE /api/notification-filters/hits — clear READ hits only.
router.delete(
  '/hits',
  requireAuth,
  validateQuery(notificationFilterHitScopeSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { filterId } = parsedQuery<NotificationFilterHitScope>(res);
    await clearReadNotificationFilterHits(req.user.id, filterId);
    res.status(204).send();
  })
);

// DELETE /api/notification-filters/hits/:contributionId — read or not.
router.delete(
  '/hits/:contributionId',
  requireAuth,
  validateParams(contributionParamsSchema),
  validateQuery(notificationFilterHitScopeSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { contributionId } = parsedParams<{ contributionId: number }>(res);
    const { filterId } = parsedQuery<NotificationFilterHitScope>(res);
    await deleteNotificationFilterHit(req.user.id, contributionId, filterId);
    res.status(204).send();
  })
);

// ─── Filters ──────────────────────────────────────────────────────────────────

// GET /api/notification-filters — the member's filters and their allowance.
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const limit = await getFilterAllowance(req.user.userRankId);
    res.json({ filters: await listNotificationFilters(req.user.id), limit });
  })
);

// POST /api/notification-filters
router.post(
  '/',
  requireAuth,
  validate(notificationFilterSchema),
  authHandler(async (req, res) => {
    const limit = await getFilterAllowance(req.user.userRankId);
    const filter = await createNotificationFilter(
      req.user.id,
      limit,
      parsedBody<NotificationFilterInput>(res)
    );
    res.status(201).json(filter);
  })
);

// PUT /api/notification-filters/:id — a full replacement.
router.put(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  validate(notificationFilterSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { id } = parsedParams<{ id: number }>(res);
    res.json(
      await updateNotificationFilter(
        req.user.id,
        id,
        parsedBody<NotificationFilterInput>(res)
      )
    );
  })
);

// DELETE /api/notification-filters/:id — its hits go with it.
router.delete(
  '/:id',
  requireAuth,
  validateParams(idParamsSchema),
  authHandler(async (req, res) => {
    await getFilterAllowance(req.user.userRankId);
    const { id } = parsedParams<{ id: number }>(res);
    await deleteNotificationFilter(req.user.id, id);
    res.status(204).send();
  })
);

export default router;

import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission, isModerator } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  validateQuery,
  parsedBody,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import {
  createTicketSchema,
  replyTicketSchema,
  assignTicketSchema,
  bulkResolveSchema,
  ticketListQuerySchema,
  createResponseSchema,
  updateResponseSchema,
  type CreateTicketInput,
  type ReplyTicketInput,
  type AssignTicketInput,
  type BulkResolveInput,
  type TicketListQueryInput,
  type CreateResponseInput,
  type UpdateResponseInput
} from '../../schemas/staffInbox';
import {
  listStaffTickets,
  listMyTickets,
  createTicket,
  viewTicket,
  replyToTicket,
  assignTicket,
  resolveTicket,
  unresolveTicket,
  bulkResolveTickets,
  listResponses,
  createResponse,
  updateResponse,
  deleteResponse,
  getStaffUnreadCount
} from '../../modules/staffInbox';
import type { StaffInboxStatus } from '@prisma/client';

const router = express.Router();

const ticketIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

const responseIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/staff-inbox — staff view of all tickets
router.get(
  '/',
  ...requirePermission('staff', 'admin'),
  validateQuery(ticketListQuerySchema),
  authHandler(async (req, res) => {
    const { page, status, assignedToMe } =
      parsedQuery<TicketListQueryInput>(res);
    const result = await listStaffTickets({
      page,
      status: status as StaffInboxStatus | 'all',
      assignedToMe,
      staffUserId: req.user.id
    });
    res.json(result);
  })
);

// GET /api/staff-inbox/unread-count — count of open/unanswered tickets (staff)
router.get(
  '/unread-count',
  ...requirePermission('staff', 'admin'),
  authHandler(async (_req, res) => {
    const count = await getStaffUnreadCount();
    res.json({ count });
  })
);

// GET /api/staff-inbox/responses — list canned responses (staff)
router.get(
  '/responses',
  ...requirePermission('staff', 'admin'),
  authHandler(async (_req, res) => {
    const responses = await listResponses();
    res.json(responses);
  })
);

// POST /api/staff-inbox/responses — create canned response (staff)
router.post(
  '/responses',
  ...requirePermission('staff', 'admin'),
  validate(createResponseSchema),
  authHandler(async (_req, res) => {
    const { name, body } = parsedBody<CreateResponseInput>(res);
    const response = await createResponse(name, body);
    res.status(201).json(response);
  })
);

// PUT /api/staff-inbox/responses/:id — update canned response (staff)
router.put(
  '/responses/:id',
  ...requirePermission('staff', 'admin'),
  validateParams(responseIdSchema),
  validate(updateResponseSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const data = parsedBody<UpdateResponseInput>(res);
    const result = await updateResponse(id, data);
    if (!result.ok) return res.status(404).json({ msg: 'Response not found' });
    res.json(result.response);
  })
);

// DELETE /api/staff-inbox/responses/:id — delete canned response (staff)
router.delete(
  '/responses/:id',
  ...requirePermission('staff', 'admin'),
  validateParams(responseIdSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteResponse(id);
    if (!result.ok) return res.status(404).json({ msg: 'Response not found' });
    res.status(204).send();
  })
);

// POST /api/staff-inbox/bulk-resolve — bulk resolve tickets (staff)
router.post(
  '/bulk-resolve',
  ...requirePermission('staff', 'admin'),
  validate(bulkResolveSchema),
  authHandler(async (req, res) => {
    const { ids } = parsedBody<BulkResolveInput>(res);
    const result = await bulkResolveTickets(ids, req.user.id);
    res.json(result);
  })
);

// GET /api/staff-inbox/mine — user's own submitted tickets
router.get(
  '/mine',
  requireAuth,
  validateQuery(z.object({ page: z.coerce.number().int().min(1).default(1) })),
  authHandler(async (req, res) => {
    const { page } = parsedQuery<{ page: number }>(res);
    const result = await listMyTickets(req.user.id, page);
    res.json(result);
  })
);

// POST /api/staff-inbox — create new ticket (any authenticated user)
router.post(
  '/',
  requireAuth,
  validate(createTicketSchema),
  authHandler(async (req, res) => {
    const { subject, body } = parsedBody<CreateTicketInput>(res);
    const conversation = await createTicket(req.user.id, subject, body);
    res.status(201).json(conversation);
  })
);

// GET /api/staff-inbox/:id — view ticket
router.get(
  '/:id',
  requireAuth,
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const staffAccess = await isModerator(req, res);
    const result = await viewTicket(id, req.user.id, staffAccess);
    if (!result.ok) {
      if (result.reason === 'forbidden')
        return res.status(403).json({ msg: 'Permission denied' });
      return res.status(404).json({ msg: 'Ticket not found' });
    }
    res.json(result.conversation);
  })
);

// POST /api/staff-inbox/:id/reply — reply to ticket
router.post(
  '/:id/reply',
  requireAuth,
  validateParams(ticketIdSchema),
  validate(replyTicketSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<ReplyTicketInput>(res);
    const staffAccess = await isModerator(req, res);
    const result = await replyToTicket(id, req.user.id, body, staffAccess);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        forbidden: 403,
        resolved: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(201).json(result.message);
  })
);

// POST /api/staff-inbox/:id/assign — assign ticket (staff only)
router.post(
  '/:id/assign',
  ...requirePermission('staff', 'admin'),
  validateParams(ticketIdSchema),
  validate(assignTicketSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { assignedUserId } = parsedBody<AssignTicketInput>(res);
    const result = await assignTicket(id, assignedUserId);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        assignee_not_found: 404,
        assignee_not_staff: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/staff-inbox/:id/resolve — resolve ticket
router.post(
  '/:id/resolve',
  requireAuth,
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const staffAccess = await isModerator(req, res);
    const result = await resolveTicket(id, req.user.id, staffAccess);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        forbidden: 403,
        already_resolved: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/staff-inbox/:id/unresolve — unresolve ticket (staff only)
router.post(
  '/:id/unresolve',
  ...requirePermission('staff', 'admin'),
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await unresolveTicket(id);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        not_resolved: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

export default router;

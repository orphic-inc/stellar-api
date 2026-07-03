import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../modules/asyncHandler';
import {
  requirePermission,
  loadPermissions,
  hasPermission
} from '../../middleware/permissions';
import { requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import {
  validate,
  validateQuery,
  validateParams,
  parsedBody,
  parsedQuery,
  parsedParams
} from '../../middleware/validate';
import {
  createResponseSchema,
  updateResponseSchema,
  createTicketSchema,
  replySchema,
  assignSchema,
  queueQuerySchema,
  bulkResolveSchema,
  type CreateResponseInput,
  type UpdateResponseInput,
  type CreateTicketInput,
  type ReplyInput,
  type AssignInput,
  type QueueQueryInput,
  type BulkResolveInput
} from '../../schemas/staffInbox';
import {
  listResponses,
  createResponse,
  updateResponse,
  deleteResponse,
  createTicket,
  listMyTickets,
  listQueue,
  getQueueCount,
  viewTicket,
  replyToTicket,
  resolveTicket,
  unresolveTicket,
  assignTicket,
  bulkResolve
} from '../../modules/staffInbox';

const router = express.Router();

const responseIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

const ticketIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// ─── Canned Responses ─────────────────────────────────────────────────────────

// GET /api/staff-inbox/responses — list canned responses (staff)
router.get(
  '/responses',
  ...requirePermission('staff_inbox_manage'),
  authHandler(async (_req, res) => {
    const responses = await listResponses();
    res.json(responses);
  })
);

// POST /api/staff-inbox/responses — create canned response (staff)
router.post(
  '/responses',
  ...requirePermission('staff_inbox_manage'),
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
  ...requirePermission('staff_inbox_manage'),
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
  ...requirePermission('staff_inbox_manage'),
  validateParams(responseIdSchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteResponse(id);
    if (!result.ok) return res.status(404).json({ msg: 'Response not found' });
    res.status(204).send();
  })
);

// ─── Staff Inbox Tickets ───────────────────────────────────────────────────────

// GET /api/staff-inbox/tickets/count — count of tickets with unread staff replies
router.get(
  '/tickets/count',
  requireAuth,
  authHandler(async (req, res) => {
    const count = await prisma.staffInboxConversation.count({
      where: { userId: req.user.id, status: 'Open' }
    });
    res.json({ count });
  })
);

// GET /api/staff-inbox/tickets — user's own tickets
router.get(
  '/tickets',
  requireAuth,
  validateQuery(z.object({ page: z.coerce.number().int().min(1).default(1) })),
  authHandler(async (req, res) => {
    const { page } = parsedQuery<{ page: number }>(res);
    const result = await listMyTickets(req.user.id, page);
    res.json(result);
  })
);

// POST /api/staff-inbox/tickets — create new ticket
router.post(
  '/tickets',
  requireAuth,
  validate(createTicketSchema),
  authHandler(async (req, res) => {
    const { subject, body } = parsedBody<CreateTicketInput>(res);
    const ticket = await createTicket(req.user.id, subject, body);
    res.status(201).json(ticket);
  })
);

// GET /api/staff-inbox/queue — staff ticket queue
router.get(
  '/queue',
  ...requirePermission('staff_inbox_manage'),
  validateQuery(queueQuerySchema),
  authHandler(async (req, res) => {
    const { page, status, assignedToMe, unassigned } =
      parsedQuery<QueueQueryInput>(res);
    const result = await listQueue({
      page,
      status,
      assignedToMe,
      unassigned,
      staffUserId: req.user.id
    });
    res.json(result);
  })
);

// GET /api/staff-inbox/queue/count — unresolved ticket count for badge
router.get(
  '/queue/count',
  ...requirePermission('staff_inbox_manage'),
  authHandler(async (_req, res) => {
    const count = await getQueueCount();
    res.json({ count });
  })
);

// POST /api/staff-inbox/bulk-resolve — batch resolve tickets (staff)
router.post(
  '/bulk-resolve',
  ...requirePermission('staff_inbox_manage'),
  validate(bulkResolveSchema),
  authHandler(async (req, res) => {
    const { ids } = parsedBody<BulkResolveInput>(res);
    const result = await bulkResolve(ids, req.user.id);
    res.json(result);
  })
);

// GET /api/staff-inbox/tickets/:id — view single ticket
router.get(
  '/tickets/:id',
  requireAuth,
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isStaff = hasPermission(
      await loadPermissions(req, res),
      'staff_inbox_manage'
    );
    const result = await viewTicket(id, req.user.id, isStaff);
    if (!result.ok) return res.status(404).json({ msg: 'Ticket not found' });
    res.json(result.ticket);
  })
);

// POST /api/staff-inbox/tickets/:id/reply
router.post(
  '/tickets/:id/reply',
  requireAuth,
  validateParams(ticketIdSchema),
  validate(replySchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<ReplyInput>(res);
    const isStaff = hasPermission(
      await loadPermissions(req, res),
      'staff_inbox_manage'
    );
    const result = await replyToTicket(id, req.user.id, body, isStaff);
    if (!result.ok) {
      // non-owner access is masked as not_found (404) upstream — no 'forbidden'.
      const status = result.reason === 'resolved' ? 422 : 404;
      return res.status(status).json({ msg: result.reason });
    }
    res.status(201).json(result.message);
  })
);

// POST /api/staff-inbox/tickets/:id/resolve
router.post(
  '/tickets/:id/resolve',
  requireAuth,
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isStaff = hasPermission(
      await loadPermissions(req, res),
      'staff_inbox_manage'
    );
    const result = await resolveTicket(id, req.user.id, isStaff);
    if (!result.ok) {
      // non-owner access is masked as not_found (404) upstream — no 'forbidden'.
      const status = result.reason === 'already_resolved' ? 422 : 404;
      return res.status(status).json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/staff-inbox/tickets/:id/unresolve (staff only)
router.post(
  '/tickets/:id/unresolve',
  ...requirePermission('staff_inbox_manage'),
  validateParams(ticketIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await unresolveTicket(id, req.user.id);
    if (!result.ok) {
      const status = result.reason === 'not_resolved' ? 422 : 404;
      return res.status(status).json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

// POST /api/staff-inbox/tickets/:id/assign (staff only)
router.post(
  '/tickets/:id/assign',
  ...requirePermission('staff_inbox_manage'),
  validateParams(ticketIdSchema),
  validate(assignSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { assignedUserId, assignedUsername } = parsedBody<AssignInput>(res);

    let resolvedId: number | null = assignedUserId ?? null;
    if (assignedUsername && assignedUserId === undefined) {
      const user = await prisma.user.findFirst({
        where: { username: { equals: assignedUsername, mode: 'insensitive' } },
        select: { id: true }
      });
      if (!user) return res.status(404).json({ msg: 'User not found' });
      resolvedId = user.id;
    }

    const result = await assignTicket(id, resolvedId, req.user.id);
    if (!result.ok) {
      const status = result.reason === 'assignee_not_staff' ? 422 : 404;
      return res.status(status).json({ msg: result.reason });
    }
    res.status(204).send();
  })
);

export default router;

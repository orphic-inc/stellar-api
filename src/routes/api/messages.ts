import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
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
import {
  composeMessageSchema,
  replyMessageSchema,
  updateConversationSchema,
  bulkMessageActionSchema,
  messageListQuerySchema,
  createTicketSchema,
  assignTicketSchema,
  ticketQueueQuerySchema,
  type ComposeMessageInput,
  type ReplyMessageInput,
  type UpdateConversationInput,
  type BulkMessageActionInput,
  type MessageListQueryInput,
  type CreateTicketInput,
  type AssignTicketInput,
  type TicketQueueQueryInput
} from '../../schemas/pm';
import {
  listInbox,
  listSentbox,
  sendMessage,
  replyToConversation,
  viewConversation,
  updateConversationFlags,
  deleteConversation,
  bulkUpdateConversations,
  getUnreadCount,
  createTicket,
  listMyTickets,
  listTicketQueue,
  getTicketUnreadCount,
  resolveTicket,
  unresolveTicket,
  assignTicket,
  bulkResolveTickets
} from '../../modules/pm';
import { isModerator, requirePermission } from '../../middleware/permissions';

const router = express.Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { msg: 'Too many messages sent. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const conversationIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/messages — inbox list
router.get(
  '/',
  requireAuth,
  validateQuery(messageListQuerySchema),
  authHandler(async (req, res) => {
    const { page, search } = parsedQuery<MessageListQueryInput>(res);
    const result = await listInbox(req.user.id, page, search);
    res.json(result);
  })
);

// GET /api/messages/unread-count
router.get(
  '/unread-count',
  requireAuth,
  authHandler(async (req, res) => {
    const count = await getUnreadCount(req.user.id);
    res.json({ count });
  })
);

// GET /api/messages/sent — sentbox list
router.get(
  '/sent',
  requireAuth,
  validateQuery(messageListQuerySchema),
  authHandler(async (req, res) => {
    const { page } = parsedQuery<MessageListQueryInput>(res);
    const result = await listSentbox(req.user.id, page);
    res.json(result);
  })
);

// POST /api/messages/bulk — bulk action on multiple conversations
router.post(
  '/bulk',
  requireAuth,
  validate(bulkMessageActionSchema),
  authHandler(async (req, res) => {
    const { ids, action } = parsedBody<BulkMessageActionInput>(res);
    await bulkUpdateConversations(req.user.id, ids, action);
    res.status(204).send();
  })
);

// POST /api/messages — compose new conversation
router.post(
  '/',
  requireAuth,
  sendLimiter,
  validate(composeMessageSchema),
  authHandler(async (req, res) => {
    const { toUserId, toUsername, subject, body } =
      parsedBody<ComposeMessageInput>(res);

    let targetId = toUserId;
    if (!targetId && toUsername) {
      const normalized = toUsername.trim();
      const target = await prisma.user.findFirst({
        where: { username: { equals: normalized, mode: 'insensitive' } },
        select: { id: true }
      });
      if (!target) return res.status(404).json({ msg: 'recipient_not_found' });
      targetId = target.id;
    }

    const result = await sendMessage(req.user.id, targetId!, subject, body);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        self_message: 400,
        recipient_not_found: 404,
        recipient_disabled: 422,
        recipient_pm_disabled: 422
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(201).json(result.conversation);
  })
);

// GET /api/messages/tickets — list my support tickets
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

// POST /api/messages/tickets — create support ticket
router.post(
  '/tickets',
  requireAuth,
  validate(createTicketSchema),
  authHandler(async (req, res) => {
    const { subject, body } = parsedBody<CreateTicketInput>(res);
    const conversation = await createTicket(req.user.id, subject, body);
    res.status(201).json(conversation);
  })
);

// GET /api/messages/ticket-queue — staff view of all tickets
router.get(
  '/ticket-queue',
  ...requirePermission('staff', 'admin'),
  validateQuery(ticketQueueQuerySchema),
  authHandler(async (req, res) => {
    const { page, status, assignedToMe, unassigned } =
      parsedQuery<TicketQueueQueryInput>(res);
    const result = await listTicketQueue({
      page,
      status: status as Parameters<typeof listTicketQueue>[0]['status'],
      assignedToMe,
      unassigned,
      staffUserId: req.user.id
    });
    res.json(result);
  })
);

// GET /api/messages/ticket-unread-count — count of open tickets (staff)
router.get(
  '/ticket-unread-count',
  ...requirePermission('staff', 'admin'),
  authHandler(async (_req, res) => {
    const count = await getTicketUnreadCount();
    res.json({ count });
  })
);

// GET /api/messages/:id — view conversation (or ticket with staff access)
router.get(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isStaff = await isModerator(req, res);
    const result = await viewConversation(id, req.user.id, isStaff);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.json(result.conversation);
  })
);

// POST /api/messages/:id/reply — reply to conversation or ticket
router.post(
  '/:id/reply',
  requireAuth,
  sendLimiter,
  validateParams(conversationIdSchema),
  validate(replyMessageSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { body } = parsedBody<ReplyMessageInput>(res);
    const isStaff = await isModerator(req, res);
    const result = await replyToConversation(id, req.user.id, body, isStaff);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_participant: 403
      };
      return res
        .status(statusMap[result.reason] ?? 400)
        .json({ msg: result.reason });
    }
    res.status(201).json(result.message);
  })
);

// POST /api/messages/:id/resolve — resolve ticket
router.post(
  '/:id/resolve',
  requireAuth,
  validateParams(conversationIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const isStaff = await isModerator(req, res);
    const result = await resolveTicket(id, req.user.id, isStaff);
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

// POST /api/messages/:id/unresolve — unresolve ticket (staff only)
router.post(
  '/:id/unresolve',
  ...requirePermission('staff', 'admin'),
  validateParams(conversationIdSchema),
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

// POST /api/messages/:id/assign — assign ticket (staff only)
router.post(
  '/:id/assign',
  ...requirePermission('staff', 'admin'),
  validateParams(conversationIdSchema),
  validate(assignTicketSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { assignedUserId, assignedUsername } =
      parsedBody<AssignTicketInput>(res);

    let targetId = assignedUserId ?? null;
    if (targetId === null && assignedUsername) {
      const normalized = assignedUsername.trim();
      const target = await prisma.user.findFirst({
        where: { username: { equals: normalized, mode: 'insensitive' } },
        select: { id: true }
      });
      if (!target) return res.status(404).json({ msg: 'assignee_not_found' });
      targetId = target.id;
    }

    const result = await assignTicket(id, targetId);
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

// POST /api/messages/bulk-resolve — bulk resolve tickets (staff)
router.post(
  '/bulk-resolve',
  ...requirePermission('staff', 'admin'),
  validate(z.object({ ids: z.array(z.number().int().positive()).min(1) })),
  authHandler(async (req, res) => {
    const { ids } = parsedBody<{ ids: number[] }>(res);
    const result = await bulkResolveTickets(ids);
    res.json(result);
  })
);

// PATCH /api/messages/:id — update flags (sticky, read)
router.patch(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  validate(updateConversationSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const flags = parsedBody<UpdateConversationInput>(res);
    const result = await updateConversationFlags(id, req.user.id, flags);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.status(204).send();
  })
);

// DELETE /api/messages/:id — soft delete conversation for this user
router.delete(
  '/:id',
  requireAuth,
  validateParams(conversationIdSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const result = await deleteConversation(id, req.user.id);
    if (!result.ok)
      return res.status(404).json({ msg: 'Conversation not found' });
    res.status(204).send();
  })
);

export default router;
